// Independently operated media peer. Only an explicit operator opt-in permits
// uploads, and a SECOND opt-in permits audio/video. Binary media is not
// replicated with signed text events. No universal removal authority exists.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {once} from 'node:events';
import {readFile,writeFile,rename,mkdir,mkdtemp,open,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import path from 'node:path';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';
import {unixfs} from '@helia/unixfs';
import {readOperatorQuarantine} from './media-quarantine.mjs';
import {MEDIA_BASE_LIMITS,MEDIA_PHYSICAL_LIMITS,mediaPriority,
 mediaLimitText,KiB,MiB} from '../core/media-resource-policy.js';
import {verifyMediaStakeGrant} from './media-stake-grant.mjs';
import {createMediaLanes} from './media-lanes.mjs';

const IMAGE_MAX=MEDIA_BASE_LIMITS['image/png'];
const AUDIO_MAX=MEDIA_BASE_LIMITS['audio/mpeg'];
const VIDEO_MAX=MEDIA_BASE_LIMITS['video/mp4'];
const MAX_TOTAL=64*MiB,DAILY_IMAGES=12,DAILY_RICH=2;
export const MEDIA_LIMITS=MEDIA_BASE_LIMITS;
// This is a defensive *storage/legacy serving* maximum, not an anonymous
// upload allowance. Signed file-specific grants alone can raise admission.
export const MEDIA_STORAGE_LIMITS=MEDIA_PHYSICAL_LIMITS;
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
async function readLimited(req,max,take=async()=>{}){
 const parts=[];let total=0;
 for await(const part of req){
  total+=part.length;
  if(total>max){const e=Error('Media exceeds peer limit');e.status=413;throw e;}
  await take(part.length);
  parts.push(part);
 }
 return Buffer.concat(parts,total);
}
async function spoolMedia(req,expected,manifestFile,take=async()=>{}){
 // Large uploads are streamed to an isolated, uniquely named 0700 folder
 // next to the operator's writable media manifest. Never buffer 100 MiB
 // in Node heap, trust a client checksum, or leave partial files on failure.
 await mkdir(path.dirname(manifestFile),{recursive:true,mode:0o700});
 const dir=await mkdtemp(manifestFile+'.upload-');
 const filename=path.join(dir,'body');
 let file=null,complete=false;
 try{
  file=await open(filename,'wx',0o600);
  const hash=createHash('sha256');
  let total=0,prefix=Buffer.alloc(0);
  for await(const part of req){
   total+=part.length;
   if(total>expected){const e=Error('Media exceeds declared length');e.status=413;throw e;}
   if(prefix.length<16)
    prefix=Buffer.concat([prefix,part.subarray(0,16-prefix.length)]);
   await take(part.length);
   hash.update(part);
   await file.writeFile(part);
  }
  if(total!==expected){const e=Error('Incomplete uploaded file');e.status=415;throw e;}
  await file.sync();
  await file.close();file=null;
  complete=true;
  return {filename,bytes:total,prefix,digest:hash.digest('hex'),
   cleanup:()=>rm(dir,{recursive:true,force:true})};
 }finally{
  await file?.close().catch(()=>{});
  if(!complete)await rm(dir,{recursive:true,force:true});
 }
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
 richMediaEnabled=false,maxTotal=MAX_TOTAL,trustedProxyAddress=null,
 quarantineFile=null,stakeGrantIssuer=null,stakeGrantAudience='web9000-media-peer',
 transferLanes=null
}={}){
 if(!ipfs||typeof manifestFile!=='string')throw Error('Helia and manifest required');
 const localQuarantineFile=quarantineFile||manifestFile+'.quarantine.json';
 // Read the operator's own policy per request so additions and reversals
 // work without a restart. Invalid policy fails closed, not open.
 if(trustedProxyAddress!==null&&!isIP(trustedProxyAddress))
  throw Error('trustedProxyAddress must be a literal IPv4/IPv6 address');
 if(stakeGrantIssuer!==null&&
    (!/^ed25519:[A-Za-z0-9_-]{43}$/.test(stakeGrantIssuer)||
     !/^[a-z0-9][a-z0-9-]{2,80}$/.test(stakeGrantAudience)))
  throw Error('Pinned media stake issuer and audience must be explicit');
 if(!Number.isSafeInteger(maxTotal)||maxTotal<1||maxTotal>4096*MiB)
  throw Error('Invalid operator media storage budget');
 const lanes=transferLanes||createMediaLanes();
 if(typeof lanes.acquire!=='function'||typeof lanes.run!=='function'||
    typeof lanes.takeBytes!=='function')
  throw Error('Media transfer scheduler must be verified local lane policy');
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
    'access-control-allow-headers':'content-type,range,x-web9000-media-grant','access-control-max-age':'300',
    'cache-control':'no-store'});res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/health'){
   send(res,200,{service:'web9000-independent-media-peer',enabled:uploadEnabled,
    richMediaEnabled,storageLimit:maxTotal,remainingBytes:Math.max(0,maxTotal-totalBytes-reserved),
    richUploadsPerClientPerDay:DAILY_RICH,images:Object.values(manifest).filter(e=>imageTypes.has(e.type)).length,
    files:Object.keys(manifest).length,totalBytes,limit:IMAGE_MAX,
    imageLimit:IMAGE_MAX,audioLimit:AUDIO_MAX,videoLimit:VIDEO_MAX,
    imageStakeLimit:MiB,videoStake100Limit:20*MiB,
    videoStake1000Limit:100*MiB,stakeAdmissionEnabled:!!stakeGrantIssuer,
    priorityLanes:lanes.stats()});
   return;
  }
  // Lightweight, per-CID availability hint. This is a local-manifest claim,
  // not a network-wide registry, cryptographic proof of retained blocks, or
  // an instruction for clients to fetch/replicate content.
  const have=url.pathname.match(/^\/have\/([A-Za-z0-9]{20,120})$/);
  if(req.method==='GET'&&have){
   let entry=manifest[have[1]];
   try{
    if((await readOperatorQuarantine(localQuarantineFile)).has(have[1]))entry=null;
   }catch(err){
    console.error('Local availability policy:',err.message);
    return send(res,503,{error:'Media peer policy unavailable'});
   }
   if(!entry)return send(res,404,{available:false});
   return send(res,200,{available:true,cid:'ipfs://'+have[1],
    type:entry.type,bytes:entry.bytes,
    priority:mediaPriority(entry.type,entry.bytes)?.name||'unknown'});
  }
  if(req.method==='POST'&&url.pathname==='/upload'){
   if(!uploadEnabled)return send(res,403,{error:'Operator disabled media ingestion'});
   const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(!Object.hasOwn(checks,type))return send(res,415,{error:'Unsupported media MIME type'});
   const rich=!imageTypes.has(type);
   if(rich&&!richMediaEnabled)return send(res,403,{error:'Operator disabled audio/video ingestion'});
   const size=Number(req.headers['content-length']);
   if(!Number.isSafeInteger(size)||size<1||
      size>MEDIA_PHYSICAL_LIMITS[type])
    return send(res,413,{error:'Outside physical '+mediaLimitText(type,MEDIA_PHYSICAL_LIMITS[type])+' cap'});
   let stake=null;
   if(size>MEDIA_BASE_LIMITS[type]){
    if(!stakeGrantIssuer)
     return send(res,403,{error:'Extended media requires an independently verified, operator-signed Stake4Karma entitlement'});
    stake=await verifyMediaStakeGrant(req.headers['x-web9000-media-grant'],{
      expectedIssuer:stakeGrantIssuer,audience:stakeGrantAudience,type,bytes:size
    });
    if(!stake.valid)return send(res,403,{error:'Invalid media stake grant: '+stake.reason});
   }
   const priority=mediaPriority(type,size);
   if(!priority)return send(res,413,{error:'No permitted size priority'});
   const day=Math.floor(Date.now()/86400000);
   if(day!==quotaDay){quotaDay=day;daily=new Map();}
   // Separate small images from heavy uploads in both rate and transfer
   // pools. A video flood cannot spend the small-image allowance.
   const quotaClass=imageTypes.has(type)?
     (size<=100*KiB?'image-small':size<=512*KiB?'image-normal':'image-staked'):
     type.startsWith('audio/')?'audio':
     size>4*MiB?'video-staked':'video-ordinary';
   const quotaLimit=quotaClass==='image-small'?DAILY_IMAGES:
     quotaClass==='image-normal'?DAILY_IMAGES:
     quotaClass==='video-staked'||quotaClass==='image-staked'?1:DAILY_RICH;
   const key=createHash('sha256').update('WEB9000/upload/'+day+'/'+
      rateClient(req)+'/'+quotaClass).digest('hex');
   if((daily.get(key)||0)>=quotaLimit)
     return send(res,429,{error:'Operator daily quota reached for '+quotaClass});
   // Do not let one accepted giant video consume the last 2 MiB that
   // otherwise allow meaningful <=100 KiB images to keep publishing.
   // Respect small standalone testing budgets with a proportional reserve.
   const reserveForTiny=priority.lane==='tiny'||priority.lane==='small'?0:
     Math.min(2*MiB,Math.floor(maxTotal/4));
   if(totalBytes+reserved+size+reserveForTiny>maxTotal)
     return send(res,507,{error:'Operator storage quota exceeded (small-image reserve protected)'});
   daily.set(key,(daily.get(key)||0)+1);
   reserved+=size;
   let started=false;
   try{
    await lanes.run(priority.lane,priority.rank,async()=>{
     started=true;
     let staged=null;
     try{
      await readOperatorQuarantine(localQuarantineFile);
      await persistQuotas();
      let bytes=null,actualHash,signature;
      if(size>4*MiB){
       staged=await spoolMedia(req,size,manifestFile,
        n=>lanes.takeBytes(priority.lane,n,{direction:'in'}));
       signature=staged.prefix;actualHash=staged.digest;
      }else{
       bytes=await readLimited(req,size,
        n=>lanes.takeBytes(priority.lane,n,{direction:'in'}));
       if(bytes.length!==size)return send(res,415,{error:'Incomplete media upload'});
       signature=bytes;
       actualHash=createHash('sha256').update(bytes).digest('hex');
      }
      if(!checks[type](signature))
       return send(res,415,{error:'Bytes do not match declared media MIME type'});
      if(stake&&actualHash!==stake.sha256)
       return send(res,403,{error:'Signed grant is bound to different media bytes'});
      const cid=rich?
        staged?await fs.addByteStream(createReadStream(staged.filename)):
        await fs.addBytes(bytes):
        CID.createV1(raw.code,await sha256.digest(bytes));
      const id=cid.toString();
      if((await readOperatorQuarantine(localQuarantineFile)).has(id))
       return send(res,403,{error:'Operator locally quarantines this CID'});
      if(!rich)await ipfs.blockstore.put(cid,bytes);
      if(manifest[id]&&manifest[id].type!==type)
       return send(res,409,{error:'CID already stored with different MIME type'});
      if(!manifest[id]){
       manifest[id]={type,bytes:size,time:Date.now(),
        codec:rich?'unixfs':'raw',sha256:actualHash,
        priority:priority.name,
        ...(stake?{stakeGrantEvidence:stake.evidenceSha256,
          stakeUsdTier:stake.usdCents>=100000?1000:100}:{})};
       totalBytes+=size;
       writing=writing.then(save);await writing;
      }
      send(res,201,{cid:'ipfs://'+id,type,bytes:size,
       priority:priority.name,deliveryLane:priority.lane});
     }catch(error){
      if(!res.headersSent)send(res,error.status||500,{
        error:error.status?'Media ingress rejected':'Media storage failed'});
      else res.destroy(error);
     }finally{
      reserved-=size;
      await staged?.cleanup().catch(()=>{});
     }
    });
   }catch(error){
    if(!started){
      reserved-=size;
      daily.set(key,Math.max(0,(daily.get(key)||1)-1));
    }
    if(!res.headersSent)send(res,error.status||503,{
      error:error.status?'Media lane saturated':'Media admission unavailable'});
   }
   return;
  }
  const match=url.pathname.match(/^\/ipfs\/([A-Za-z0-9]{20,120})$/);
  if(['GET','HEAD'].includes(req.method)&&match){
   const entry=manifest[match[1]];
   if(!entry)return send(res,404,{error:'Peer does not retain this CID'});
   try{
    if((await readOperatorQuarantine(localQuarantineFile)).has(match[1]))
     return send(res,403,{error:'This media peer locally quarantines the CID'});
   }catch(error){
    return send(res,503,{error:'Media peer quarantine unavailable'});
   }
   // Historical 10 MiB video uploaded before this policy stays readable.
   // New anonymous admission limits do NOT revoke existing signed CIDs.
   if(!Object.hasOwn(MEDIA_PHYSICAL_LIMITS,entry.type)||
     !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
     entry.bytes>MEDIA_PHYSICAL_LIMITS[entry.type])
    return send(res,503,{error:'Invalid stored media metadata'});
   const range=parseRange(req.headers.range,entry.bytes);
   if(!range){
    res.writeHead(416,{'content-range':'bytes */'+entry.bytes,
     'cache-control':'no-store','access-control-allow-origin':'*'});
    res.end();return;
   }
   const priority=mediaPriority(entry.type,entry.bytes);
   try{
    await lanes.run(priority.lane,priority.rank,async()=>{
     try{
      const cid=CID.parse(match[1]);
      const source=entry.codec==='unixfs'?fs.cat(cid.toString(),{offline:true}):
       cid.code===raw.code?ipfs.blockstore.get(cid):null;
      if(!source)throw Error('Unknown stored block codec');
      const small=entry.bytes<=4*MiB;
      let total=0,prefix=Buffer.alloc(0);
      const hasher=createHash('sha256'),chunks=small?[]:null;
      for await(const part of source){
       total+=part.byteLength;
       if(total>entry.bytes)throw Error('Stored media exceeded manifest size');
       const buf=Buffer.from(part);
       if(prefix.length<16)
        prefix=Buffer.concat([prefix,buf.subarray(0,16-prefix.length)]);
       hasher.update(buf);
       if(small)chunks.push(buf);
      }
      if(total!==entry.bytes||!checks[entry.type](prefix))
       throw Error('Invalid stored media bytes/header');
      const digest=hasher.digest('hex');
      if(entry.sha256&&digest!==entry.sha256)
       throw Error('Stored media hash differs from operator manifest');
      if(!entry.sha256&&cid.code===raw.code){
       const rawHash=await sha256.digest(Buffer.concat(chunks,total));
       if(!Buffer.from(rawHash.bytes).equals(Buffer.from(cid.multihash.bytes)))
        throw Error('Incorrect raw CID');
      }
      res.writeHead(range.partial?206:200,{
       'content-type':entry.type,
       'content-length':range.end-range.start+1,
       'accept-ranges':'bytes',
       ...(range.partial?{'content-range':'bytes '+range.start+'-'+range.end+'/'+entry.bytes}:{}),
       'cache-control':'no-store',
       'x-content-type-options':'nosniff',
       'cross-origin-resource-policy':'cross-origin',
       'access-control-allow-origin':'*',
       'access-control-expose-headers':'content-range,accept-ranges,content-length'
      });
      if(req.method==='HEAD'){res.end();return;}
      if(small){
       const full=Buffer.concat(chunks,total);
       const requested=full.subarray(range.start,range.end+1);
       // The first 50/100 KiB images bypass pacing. A 2-4 MiB video
       // still occupies the HEAVY lane and MUST be bandwidth-paced
       // even though its body fits in our small in-memory read buffer.
       if(priority.lane==='tiny'||priority.lane==='small'){
        res.end(requested);return;
       }
       for(let offset=0;offset<requested.length;offset+=64*KiB){
        const piece=requested.subarray(offset,offset+64*KiB);
        await lanes.takeBytes(priority.lane,piece.length);
        if(!res.write(piece)){
         if(res.destroyed)throw Error('Media reader disconnected');
         await once(res,'drain',{signal:AbortSignal.timeout(20000)});
        }
       }
       res.end();return;
      }
      // Second pass streams at most one HEAVY response at a time. The
      // first pass fully verified content bytes and the complete SHA256
      // BEFORE any response headers were sent. A separate small-image
      // lane remains available throughout this multi-MiB transfer.
      let offset=0,sent=0;
      for await(const part of fs.cat(cid.toString(),{offline:true})){
       const start=Math.max(0,range.start-offset);
       const end=Math.min(part.length,range.end+1-offset);
       if(end>start){
        const piece=part.subarray(start,end);
        sent+=piece.length;
        await lanes.takeBytes(priority.lane,piece.length);
        if(!res.write(piece)){
         if(res.destroyed)throw Error('Media reader disconnected');
         await once(res,'drain',{signal:AbortSignal.timeout(20000)});
        }
       }
       offset+=part.length;
       if(offset>range.end)break;
      }
      if(sent!==range.end-range.start+1)
       throw Error('Stored UnixFS body was truncated after verification');
      res.end();
     }catch(error){
      console.error('Local media read failure:',error.message);
      if(res.headersSent)res.destroy(error);
      else send(res,503,{error:'Verified IPFS media unavailable on this peer'});
     }
    });
   }catch(error){
    if(!res.headersSent)send(res,error.status||503,{
     error:error.status?'Media transfer lane saturated':'Media delivery unavailable'});
    else res.destroy(error);
   }
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