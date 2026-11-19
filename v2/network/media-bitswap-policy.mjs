// Permissionless signed metadata and voluntary media need different IPFS
// serving rules. Helia's Bitswap ledger reads from its blockstore directly,
// bypassing the HTTP /ipfs and /have quarantine controls.
//
// This wraps ONLY Bitswap's outbound blockstore reads, not local Helia reads,
// OrbitDB content processing, user-approved media uploads, or HTTP serving.
// Raw UnixFS file leaves, DAG-PB ancestors, and standalone raw image blocks
// are all screened. Unknown raw/DAG-PB blocks are NOT offered for download.
//
// This is an operator-local refusal, not a network-wide deletion.
import {readFile} from 'node:fs/promises';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import * as dagPB from '@ipld/dag-pb';
import {bitswap,trustlessGateway} from '@helia/block-brokers';
import {readOperatorQuarantine} from './media-quarantine.mjs';

const MAX_MEDIA_BLOCKS=30000;
const MAX_MANIFEST=512*1024;
const MAX_BLOCK_BYTES=4*1024*1024;
const DAG_PB=0x70;

async function localBytes(store,cid){
 const chunks=[];let total=0;
 for await(const part of store.get(cid)){
  total+=part.byteLength;
  if(total>MAX_BLOCK_BYTES)throw Error('Media block exceeds P2P policy parser cap');
  chunks.push(Buffer.from(part));
 }
 return Buffer.concat(chunks,total);
}
export function createMediaBitswapPolicy({manifestFile,localBlockstore,quarantineFile}={}){
 if(typeof manifestFile!=='string'||!localBlockstore?.get)
  throw Error('P2P media serving policy needs manifest and direct local blockstore');
 const localQuarantine=quarantineFile||manifestFile+'.quarantine.json';
 let manifestBytes=null,rootsByBlock=new Map();
 async function refresh(){
  // Files are small metadata; byte-equality avoids stale mtime caches and
  // means an upload/manifest rewrite takes effect at the very next request.
  let text;
  try{text=await readFile(manifestFile,'utf8');}
  catch(e){if(e.code==='ENOENT')text='';else throw e;}
  if(text===manifestBytes)return;
  if(text.length>MAX_MANIFEST)throw Error('Media manifest exceeds P2P policy budget');
  let entries=[];
  if(text){
   const parsed=JSON.parse(text);
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
      Object.keys(parsed).length>10000)throw Error('Invalid media manifest');
   entries=Object.keys(parsed).map(key=>CID.parse(key));
  }
  const next=new Map();
  for(const root of entries){
   if(root.code!==raw.code&&root.code!==DAG_PB)
    throw Error('Non-raw and non-UnixFS media in manifest');
   const stack=[root],visited=new Set();
   while(stack.length){
    const cid=stack.pop(),id=cid.toString();
    if(visited.has(id))continue;
    visited.add(id);
    if(visited.size>MAX_MEDIA_BLOCKS||next.size>MAX_MEDIA_BLOCKS)
     throw Error('Media DAG too large for P2P policy');
    const owners=next.get(id)||new Set();
    owners.add(root.toString());
    next.set(id,owners);
    if(cid.code===DAG_PB){
     const bytes=await localBytes(localBlockstore,cid);
     const node=dagPB.decode(bytes);
     for(const link of node.Links)stack.push(link.Hash);
    }else if(cid.code!==raw.code)
     throw Error('Unsupported media DAG child codec');
   }
  }
  // A malformed/missing block MUST NOT partially promote an upload as
  // shareable. The previous known-good map stays in force only while
  // its old manifest applies; changed invalid manifest causes denial.
  rootsByBlock=next;
  manifestBytes=text;
 }
 async function maySend(cid){
  const id=cid.toString();
  // Protect raw images and raw UnixFS leaves, and DAG-PB file roots.
  // Other codecs are used for OrbitDB identity/index metadata and keep
  // their existing replication behavior.
  if(cid.code!==raw.code&&cid.code!==DAG_PB)return true;
  try{
   await refresh();
   const owners=rootsByBlock.get(id);
   if(!owners||owners.size===0)return false;
   const blocked=await readOperatorQuarantine(localQuarantine);
   for(const owner of owners)if(blocked.has(owner))return false;
   return true;
  }catch(error){
   // Never turn a corrupt/unreadable policy into an accidental offer.
   return false;
  }
 }
 function outboundOnlyBlockstore(original){
  return new Proxy(original,{
   get(target,key,receiver){
    if(key==='get')return async function* guardedGet(cid,options){
     if(!await maySend(cid))throw Error('Media block withheld by local P2P operator policy');
     yield* original.get(cid,options);
    };
    const value=Reflect.get(target,key,receiver);
    return typeof value==='function'?value.bind(target):value;
   }
  });
 }
 function broker(components){
  return bitswap()({...components,blockstore:outboundOnlyBlockstore(components.blockstore)});
 }
 return {
  maySend,
  blockBrokers:[trustlessGateway(),broker],
  // For tests and operator diagnostics; no media bytes are exposed here.
  async info(){
   try{await refresh();return {blocks:rootsByBlock.size,roots:new Set(
    [...rootsByBlock.values()].flatMap(v=>[...v])).size};}
   catch(e){return {error:e.message,failClosed:true};}
  }
 };
}
