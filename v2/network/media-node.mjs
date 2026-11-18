// Independently operated media peer. Only an explicit operator opt-in permits
// uploads, and a SECOND opt-in permits audio/video. Binary media is not
// replicated with signed text events. No universal removal authority exists.
import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import path from 'node:path';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';
import {unixfs} from '@helia/unixfs';
import {readOperatorQuarantine} from './media-quarantine.mjs';

const IMAGE_MAX=256*1024,RICH_MAX=10*1024*1024;
const AUDIO_MAX=RICH_MAX,VIDEO_MAX=RICH_MAX;
const MAX_TOTAL=64*1024*1024,DAILY_IMAGES=12,DAILY_RICH=2;
export const MEDIA_LIMITS=Object.freeze({
 'image/jpeg':IMAGE_MAX,'image/png':IMAGE_MAX,'image/webp':IMAGE_MAX,
 'audio/mpeg':AUDIO_MAX,'audio/ogg':AUDIO_MAX,'audio/wav':AUDIO_MAX,
 'video/mp4':VIDEO_MAX,'video/webm':VIDEO_MAX
});
const imageTypes=new Set(['image/jpeg','image/png','image/webp']);
const starts=(bytes,sig)=>bytes.length>=sig.length&&sig.every((v,i)=>bytes[i]===v);
const checks={
 'image/jpeg':b=>starts(b,[255,216,255]),
 'image/png':b=>starts(b,[137,80,78,71,13,10,26,10]),
 'image/webp':b=>b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP',
 'audio/mpeg':b=>starts(b,[73,68,51])||(b.length>=2&&b[0]===255&&(b[1]&224)===224),
 'audio/ogg':b=>starts(b,[79,103,103,83]),
 'audio/wav':b=>b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE',
 'video/mp4':b=>b.length>=12&&b.toString('ascii',4,8)==='ftyp',
 'video/webm':b=>starts(b,[26,69,223,163])
};
function send(res,status,body,headers={}){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'access-control-allow-origin':'*',...headers});
 res.end(JSON.stringify(body));
}
async function readLimited(req,max){
 const parts=[];let total=0;
 for await(const part of req){
  total+=part.length;
  if(total>max){const e=Error('Media exceeds peer limit');e.status=413;throw e;}
  parts.push(part);
 }
 return Buffer.concat(parts,total);
}
function parseRange(value,length){
 if(value===undefined)return {start:0,end:length-1,partial:false};
 const m=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!m||(!m[1]&&!m[2]))return null;
 let start,end;
 if(!m[1]){
  const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<=0)return null;
  start=Math.max(0,length-n);end=length-1;
 }else{
  start=Number(m[1]);end=m[2]?Number(m[2]):length-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=length||end<start)return null;
  end=Math.min(length-1,end);
 }
 return {start,end,partial:true};
}
export async function createImageGateway({
 ipfs,host='127.0.0.1',port=8788,manifestFile,uploadEnabled=false,
 richMediaEnabled=false,maxTotal=MAX_TOTAL,trustedProxyAddress=null,quarantineFile=null
}={}){
 if(!ipfs||typeof manifestFile!=='string')throw Error('Helia and manifest required');
 const localQuarantineFile=quarantineFile||manifestFile+'.quarantine.json';
 // Read the operator's own policy per request so additions and reversals
 // work without a restart. Invalid policy fails closed, not open.
 if(trustedProxyAddress!==null&&!isIP(trustedProxyAddress))
  throw Error('trustedProxyAddress must be a literal IPv4/IPv6 address');
 // Keep old entrypoint name for operator scripts and existing image CIDs.
 const fs=unixfs(ipfs);
 let manifest={};
 try{
  const parsed=JSON.parse(await readFile(manifestFile,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid manifest');
  manifest=parsed;
 }catch(err){if(err.code!=='ENOENT')throw err;}
 let totalBytes=Object.values(manifest).reduce((n,e)=>n+(e?.bytes||0),0),reserved=0;
 let writing=Promise.resolve(),quotaWriting=Promise.resolve();
 // Quotas survive restarts. A daily SHA-256 keyed counter avoids saving
 // client IPs in plain text. This only provides operator-local throttling,
 // not stake-based Sybil resistance.
 const quotaFile=manifestFile+'.quotas.json';
 let quotaDay=Math.floor(Date.now()/86400000);
 let daily=new Map();
 try{
  const persisted=JSON.parse(await readFile(quotaFile,'utf8'));
  if(persisted?.day===quotaDay&&Array.isArray(persisted.counts)){
   for(const pair of persisted.counts){
    if(Array.isArray(pair)&&typeof pair[0]==='string'&&
       Number.isSafeInteger(pair[1])&&pair[1]>=0)
      daily.set(pair[0],pair[1]);
   }
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 async function persistQuotas(){
  const snapshot={day:quotaDay,counts:[...daily]};
  const tmp=quotaFile+'.tmp';
  quotaWriting=quotaWriting.then(async()=>{
   await writeFile(tmp,JSON.stringify(snapshot),{mode:0o600});
   await rename(tmp,quotaFile);
  });
  await quotaWriting;
 }
 function rateClient(req){
  const fromSocket=String(req.socket.remoteAddress||'unknown');
  if(trustedProxyAddress&&fromSocket===trustedProxyAddress){
   // Nginx must unconditionally overwrite this header with $remote_addr.
   const supplied=String(req.headers['x-real-ip']||'');
   if(isIP(supplied))return supplied;
  }
  return fromSocket;
 }
 async function save(){
  const tmp=manifestFile+'.tmp';
  await mkdir(path.dirname(manifestFile),{recursive:true});
  await writeFile(tmp,JSON.stringify(manifest),{mode:0o600});
  await rename(tmp,manifestFile);
 }
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){
   res.writeHead(204,{'access-control-allow-origin':'*',
    'access-control-allow-methods':'POST,GET,HEAD,OPTIONS',
    'access-control-allow-headers':'content-type,range','access-control-max-age':'300',
    'cache-control':'no-store'});res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/health'){
   send(res,200,{service:'web9000-independent-media-peer',enabled:uploadEnabled,
    richMediaEnabled,storageLimit:maxTotal,remainingBytes:Math.max(0,maxTotal-totalBytes-reserved),
    richUploadsPerClientPerDay:DAILY_RICH,images:Object.values(manifest).filter(e=>imageTypes.has(e.type)).length,
    files:Object.keys(manifest).length,totalBytes,limit:IMAGE_MAX,
    imageLimit:IMAGE_MAX,audioLimit:AUDIO_MAX,videoLimit:VIDEO_MAX});
   return;
  }
  if(req.method==='POST'&&url.pathname==='/upload'){
   if(!uploadEnabled)return send(res,403,{error:'Operator disabled media ingestion'});
   const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(!Object.hasOwn(checks,type))return send(res,415,{error:'Unsupported media MIME type'});
   const rich=!imageTypes.has(type);
   if(rich&&!richMediaEnabled)return send(res,403,{error:'Operator disabled audio/video ingestion'});
   const cap=MEDIA_LIMITS[type],size=Number(req.headers['content-length']);
   if(!Number.isSafeInteger(size)||size<1||size>cap)
    return send(res,413,{error:'Media exceeds '+(rich?'10 MiB':'256 KiB')+' per-file limit'});
   // Remote address, not an attacker-provided X-Forwarded-For header.
   const day=Math.floor(Date.now()/86400000);
   if(day!==quotaDay){quotaDay=day;daily=new Map();}
   const key=createHash('sha256').update('WEB9000/upload/'+quotaDay+'/'+
    rateClient(req)+'/'+(rich?'rich':'image')).digest('hex');
   if((daily.get(key)||0)>=(rich?DAILY_RICH:DAILY_IMAGES))
    return send(res,429,{error:'Operator daily upload quota reached'});
   if(totalBytes+reserved+size>maxTotal)return send(res,507,{error:'Operator storage quota exceeded'});
   // Reserve atomically, before awaiting body bytes. Never trust raw
   // X-Forwarded-For headers supplied by clients.
   daily.set(key,(daily.get(key)||0)+1);
   reserved+=size;
   try{
    await readOperatorQuarantine(localQuarantineFile);
    await persistQuotas();
    const bytes=await readLimited(req,cap);
    if(bytes.length!==size||!checks[type](bytes))
     return send(res,415,{error:'Bytes do not match declared media type'});
    const cid=rich?await fs.addBytes(bytes):CID.createV1(raw.code,await sha256.digest(bytes));
    const id=cid.toString();
    // Operators can refuse to retain/serve any specific CID. For UnixFS the
    // DAG is constructed before its CID is known; an unpublished rejected DAG
    // might require subsequent local blockstore GC. No remote copy is touched.
    if((await readOperatorQuarantine(localQuarantineFile)).has(id))
     return send(res,403,{error:'Operator locally quarantines this CID'});
    if(!rich)await ipfs.blockstore.put(cid,bytes);
    if(manifest[id]&&manifest[id].type!==type)
     return send(res,409,{error:'Existing CID is already retained with a different MIME type'});
    if(!manifest[id]){
     manifest[id]={type,bytes:bytes.length,time:Date.now(),codec:rich?'unixfs':'raw',
      sha256:createHash('sha256').update(bytes).digest('hex')};
     totalBytes+=bytes.length;
     writing=writing.then(save);await writing;
    }
    send(res,201,{cid:'ipfs://'+id,type,bytes:bytes.length});
   }catch(e){send(res,e.status||500,{error:'Media storage failed'});}
   finally{reserved-=size;}
   return;
  }
  const match=url.pathname.match(/^\/ipfs\/([A-Za-z0-9]{20,120})$/);
  if(['GET','HEAD'].includes(req.method)&&match){
   const entry=manifest[match[1]];
   if(!entry)return send(res,404,{error:'Peer does not retain this CID'});
   // Serving quarantine is entirely local and revocable, unlike network-wide
   // deletion. GET and HEAD both follow the same operator policy.
   try{
    if((await readOperatorQuarantine(localQuarantineFile)).has(match[1]))
      return send(res,403,{error:'This media peer locally quarantines the CID'});
   }catch(error){
    console.error('Local media quarantine configuration:',error.message);
    return send(res,503,{error:'Media peer policy unavailable'});
   }
   if(!Object.hasOwn(checks,entry.type)||!Number.isSafeInteger(entry.bytes)||
    entry.bytes<1||entry.bytes>MEDIA_LIMITS[entry.type])
    return send(res,503,{error:'Invalid stored media metadata'});
   const range=parseRange(req.headers.range,entry.bytes);
   if(!range){
    res.writeHead(416,{'content-range':'bytes */'+entry.bytes,
     'cache-control':'no-store','access-control-allow-origin':'*'});res.end();return;
   }
   try{
    const cid=CID.parse(match[1]);
    const source=entry.codec==='unixfs'?fs.cat(cid.toString(),{offline:true}):
     cid.code===raw.code?ipfs.blockstore.get(cid):null;
    if(!source)throw Error('Unknown stored block codec');
    let n=0;const chunks=[];
    for await(const part of source){
     n+=part.byteLength;if(n>entry.bytes)throw Error('Oversized stored bytes');
     chunks.push(Buffer.from(part));
    }
    const full=Buffer.concat(chunks,n);
    if(n!==entry.bytes||!checks[entry.type](full))throw Error('Corrupt stored media');
    const sum=createHash('sha256').update(full).digest('hex');
    if(entry.sha256&&sum!==entry.sha256)throw Error('Incorrect stored checksum');
    if(!entry.sha256&&cid.code===raw.code){
     const hash=await sha256.digest(full);
     if(!Buffer.from(hash.bytes).equals(Buffer.from(cid.multihash.bytes)))
      throw Error('Incorrect raw CID');
    }
    const data=full.subarray(range.start,range.end+1);
    res.writeHead(range.partial?206:200,{
     'content-type':entry.type,'content-length':data.length,
     'accept-ranges':'bytes',
     ...(range.partial?{'content-range':'bytes '+range.start+'-'+range.end+'/'+entry.bytes}:{}),
     'cache-control':'no-store','x-content-type-options':'nosniff',
     'cross-origin-resource-policy':'cross-origin','access-control-allow-origin':'*',
     'access-control-expose-headers':'content-range,accept-ranges,content-length'
    });
    if(req.method==='HEAD')res.end();else res.end(data);
   }catch(error){console.error('Local media read failure:',error.message);send(res,503,{error:'Verified IPFS media unavailable on this peer'});}
   return;
  }
  send(res,404,{error:'Unknown media path'});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {host,port:server.address().port,uploadEnabled,richMediaEnabled,
  get count(){return Object.keys(manifest).length;},
  get totalBytes(){return totalBytes;},
  async close(){await new Promise(resolve=>server.close(resolve));}};
}