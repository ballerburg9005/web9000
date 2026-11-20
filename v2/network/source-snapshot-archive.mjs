// Optional Node-only source snapshot archiver. Copies verified input bytes
// into independent UnixFS CIDs. Nothing is published until explicit "serve".
// A separate Bitswap provider allowlists only offered UnixFS trees.
// Operator must respect underlying source redistribution licenses.
import {createReadStream} from 'node:fs';
import {mkdir,open,readFile,rm,lstat} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {CID} from 'multiformats/cid';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {unixfs} from '@helia/unixfs';
import {createMediaBitswapPolicy} from './media-bitswap-policy.mjs';
import {readVerifiedSourceSnapshots} from './source-provenance-files.mjs';

const PER_FILE=128*1024*1024;
const MAX_ARCHIVED=256*1024*1024;
const ROOTS='source-offers.json';
async function node(storeDir,{serve=false,host='127.0.0.1',port=0}={}){
 const localBlockstore=new LevelBlockstore(join(storeDir,'blocks'));
 // Reopening persisted UnixFS chunks after a separate prepare process
 // requires explicitly reopening LevelDB; Helia does not do that for us.
 await localBlockstore.open();
 const policy=serve?createMediaBitswapPolicy({
  manifestFile:join(storeDir,ROOTS),localBlockstore}):null;
 const libp2p=await createLibp2p({
  addresses:{listen:['/ip4/'+host+'/tcp/'+port]},
  transports:[tcp()],connectionEncrypters:[noise()],
  streamMuxers:[yamux()],services:{identify:identify()}
 });
 let ipfs;
 try{
  // While PREPARING an archive, disable all outbound block brokers:
  // no unsolicited Bitswap server may offer unreviewed source bytes.
  // Only a separate explicit serve action enables manifest-aware Bitswap.
  ipfs=await createHelia({libp2p,blockstore:localBlockstore,
   blockBrokers:policy?policy.blockBrokers:[]});
 }catch(e){await libp2p.stop().catch(()=>{});throw e;}
 return {ipfs,libp2p,policy,async stop(){try{await ipfs.stop();}finally{await localBlockstore.close();}}};
}
export async function prepareSourceArchives(sourcesFile,storeDir,outputFile){
 if(![sourcesFile,storeDir,outputFile].every(x=>
   typeof x==='string'&&isAbsolute(x)))
  throw Error('Absolute paths required for private source snapshots, new archive store and new source manifest');
 if(outputFile.startsWith(storeDir+'/')||storeDir===dirname(sourcesFile))
  throw Error('Do not place source manifest inside the public archive store');
 const checked=await readVerifiedSourceSnapshots(sourcesFile);
 const privateManifest=JSON.parse(await readFile(sourcesFile,'utf8'));
 if(privateManifest.sources.some(x=>x.archiveCid))
  throw Error('Already archived source manifest: use its existing CIDs and independently reverify');
 // Existing stores must never be overwritten. Independent operators may
 // already depend on their CIDs and archive persistence.
 await mkdir(storeDir,{mode:0o700,recursive:false});
 let instance,archived=0,stopped=false;
 try{
  instance=await node(storeDir);
  const fs=unixfs(instance.ipfs),roots={},entries=[];
  for(let i=0;i<privateManifest.sources.length;i++){
   const local=privateManifest.sources[i],committed=checked.sources[i];
   if(archived+committed.bytes>MAX_ARCHIVED)
    throw Error('Source snapshot archive exceeds total 256 MiB budget');
   const cid=await fs.addByteStream(createReadStream(local.file));
   const sha=createHash('sha256');let bytes=0;
   for await(const data of fs.cat(cid.toString(),{offline:true})){
    bytes+=data.byteLength;
    if(bytes>PER_FILE)throw Error('Archive exceeds 128 MiB verified source cap');
    sha.update(data);
   }
   if(bytes!==committed.bytes||sha.digest('hex')!==committed.sha256)
    throw Error('Locally stored IPFS UnixFS archive differs from source SHA-256');
   archived+=bytes;
   const id=cid.toString();
   roots[id]={type:'application/octet-stream',bytes,sha256:committed.sha256,
    codec:'unixfs',time:Date.now()};
   entries.push({...local,archiveCid:id});
  }
  const offer=await open(join(storeDir,ROOTS),'wx',0o600);
  try{await offer.writeFile(JSON.stringify(roots)+'\n');await offer.sync();}
  finally{await offer.close();}
  const result=await open(outputFile,'wx',0o600);
  try{await result.writeFile(JSON.stringify({
   transform:privateManifest.transform,sources:entries
  },null,2)+'\n');await result.sync();}
  finally{await result.close();}
  return {storeDir,outputFile,roots:Object.keys(roots),bytes:archived};
 }catch(error){
  await instance?.stop().catch(()=>{});stopped=true;
  // Only the NEW archive store created within this invocation is removed.
  await rm(storeDir,{recursive:true,force:true});
  throw error;
 }finally{if(!stopped)await instance?.stop().catch(()=>{});}
}
export async function startSourceArchivePeer(storeDir,{
 host='127.0.0.1',port=0
}={}){
 if(!isAbsolute(storeDir)||isIP(host)!==4||
   !Number.isSafeInteger(port)||port<0||port>65535)
  throw Error('Archive Bitswap peer requires an explicit IPv4 bind address');
 // Safe CLI default is loopback. Binding a public IPv4 address, including
 // 0.0.0.0, is a deliberate OPERATOR action exposing source snapshots
 // via direct libp2p. Browser use and original posts remain unchanged.
 const stat=await lstat(join(storeDir,ROOTS));
 if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>512*1024)
  throw Error('Source archive needs private 0600 root allowlist');
 const offer=JSON.parse(await readFile(join(storeDir,ROOTS),'utf8'));
 if(!offer||typeof offer!=='object'||Array.isArray(offer)||
   Object.keys(offer).length<1||Object.keys(offer).length>8)
  throw Error('Invalid source snapshot root allowlist');
 for(const [id,entry] of Object.entries(offer)){
  CID.parse(id);
  if(!entry||entry.codec!=='unixfs'||
    !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
    entry.bytes>PER_FILE||!/^[0-9a-f]{64}$/.test(entry.sha256))
   throw Error('Invalid archive CID or file metadata');
 }
 const instance=await node(storeDir,{serve:true,host,port});
 try{
  for(const cid of Object.keys(offer)){
   if(!await instance.policy.maySend(CID.parse(cid)))
    throw Error('Archive Bitswap policy does not authorize full UnixFS tree: '+JSON.stringify(await instance.policy.info()));
  }
  return {peerId:instance.libp2p.peerId.toString(),
   addrs:instance.libp2p.getMultiaddrs().map(x=>x.toString()),
   ...instance};
 }catch(error){await instance.stop();throw error;}
}
if(process.argv[1]&&/source-snapshot-archive\.mjs$/.test(process.argv[1])){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'&&args.length===3){
  const result=await prepareSourceArchives(...args);
  console.log(JSON.stringify({ok:true,...result,
   notice:'Archive prepared but NOT served. Starting a separate peer explicitly publishes source data and requires license review.'}));
 }else if(mode==='serve'&&(args.length>=1&&args.length<=3)){
  const active=await startSourceArchivePeer(args[0],{
   port:Number(args[1]??0),host:args[2]??'127.0.0.1'
  });
  console.log(JSON.stringify({serving:true,peerId:active.peerId,
   addrs:active.addrs,notice:'Explicit operator-bound Bitswap provider, no OrbitDB or automatic public gateway'}));
  const close=async()=>{await active.stop();process.exit(0);};
  process.once('SIGTERM',close);process.once('SIGINT',close);
 }else throw Error('Usage: source-snapshot-archive.mjs prepare /abs/private/sources.json /abs/NEW/store-dir /abs/NEW/sources-with-cids.json | serve /abs/store-dir [port] [explicit-ipv4-bind-address]');
}
