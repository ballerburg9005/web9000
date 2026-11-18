// Optional media-only HTTP gateway for independent test peers.
//
// This stores a few manually submitted, size-limited raster images in Helia's
// IPFS blockstore. It is not a global IPFS takedown service and is NOT enabled
// by default. Media is never fetched merely while synchronizing text indexes.
// A local peer operator retains sole power to quarantine/delete its own blocks.
import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';

const MAX_UPLOAD=256*1024;
const DAILY_PER_IP=12;
const MAX_TOTAL=64*1024*1024;
const allowed={
  'image/jpeg':b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,
  'image/png':b=>b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v),
  'image/webp':b=>b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'
};
function send(res,status,body,headers={}){
  const data=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'access-control-allow-origin':'*',...headers});
  res.end(data);
}
async function readLimited(req,max){
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>max){const e=Error('Image exceeds test-peer size limit');e.status=413;throw e;}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,total);
}
export async function createImageGateway({
  ipfs,host='127.0.0.1',port=8788,manifestFile,
  uploadEnabled=false,maxTotal=MAX_TOTAL
}={}){
  if(!ipfs||typeof manifestFile!=='string')throw Error('Helia and manifest file required');
  // Small images use standard IPFS raw-codec blocks: CIDv1 + SHA-256.
  // This avoids a large UnixFS dependency for a <=256 KiB single-block demo.
  let manifest={};
  try{
    const parsed=JSON.parse(await readFile(manifestFile,'utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid image manifest');
    manifest=parsed;
  }catch(err){if(err.code!=='ENOENT')throw err;}
  const dayCounts=new Map();
  let totalBytes=Object.values(manifest).reduce((sum,item)=>sum+(item?.bytes||0),0);
  let writing=Promise.resolve();
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
        'access-control-allow-methods':'POST, GET, OPTIONS',
        'access-control-allow-headers':'content-type',
        'access-control-max-age':'300','cache-control':'no-store'});
      res.end();return;
    }
    if(req.method==='GET'&&url.pathname==='/health'){
      send(res,200,{service:'web9000-independent-image-peer',enabled:uploadEnabled,
        images:Object.keys(manifest).length,totalBytes,limit:MAX_UPLOAD});
      return;
    }
    if(req.method==='POST'&&url.pathname==='/upload'){
      if(!uploadEnabled)return send(res,403,{error:'Operator disabled media ingestion'});
      const type=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      if(!allowed[type])return send(res,415,{error:'Only JPEG, PNG, WebP raster images'});
      const len=Number(req.headers['content-length']);
      if(!Number.isSafeInteger(len)||len<1||len>MAX_UPLOAD)
        return send(res,413,{error:'Image must be 1..256 KiB with Content-Length'});
      const ip=String(req.headers['x-real-ip']||req.socket.remoteAddress||'unknown');
      const budgetKey=Math.floor(Date.now()/86400000)+'|'+ip;
      if((dayCounts.get(budgetKey)||0)>=DAILY_PER_IP)
        return send(res,429,{error:'Local independent test peer daily upload limit'});
      if(totalBytes+len>maxTotal)return send(res,507,{error:'Operator storage quota exceeded'});
      dayCounts.set(budgetKey,(dayCounts.get(budgetKey)||0)+1);
      try{
        const bytes=await readLimited(req,MAX_UPLOAD);
        if(bytes.length!==len||!allowed[type](bytes))
          return send(res,415,{error:'Image content does not match its declared format'});
        const digest=await sha256.digest(bytes);
        const cid=CID.createV1(raw.code,digest).toString();
        await ipfs.blockstore.put(CID.parse(cid),bytes);
        if(!manifest[cid]){
          manifest[cid]={type,bytes:bytes.length,time:Date.now()};
          totalBytes+=bytes.length;
          writing=writing.then(save);await writing;
        }
        send(res,201,{cid:'ipfs://'+cid,bytes:bytes.length,type});
      }catch(error){send(res,error.status||500,{error:'Media ingest failed'});}
      return;
    }
    const match=url.pathname.match(/^\/ipfs\/([A-Za-z0-9]{20,120})$/);
    if(req.method==='GET'&&match){
      const record=manifest[match[1]];
      if(!record)return send(res,404,{error:'No image retained by this peer'});
      // Human-initiated client image fetch; do not cache into intermediate CDNs.
      try{
        const cid=CID.parse(match[1]);
        if(cid.code!==raw.code)throw Error('Unsupported image block codec');
        const chunks=[];let size=0;
        // Helia's blockstore.get returns AsyncIterable<Uint8Array>, not a
        // single byte array. Enforce the cap during streaming retrieval.
        for await(const chunk of ipfs.blockstore.get(cid)){
          size+=chunk.byteLength;
          if(size>MAX_UPLOAD)throw Error('Stored image exceeds local size limit');
          chunks.push(Buffer.from(chunk));
        }
        const bytes=Buffer.concat(chunks,size);
        const digest=await sha256.digest(bytes);
        if(Buffer.compare(Buffer.from(digest.bytes),Buffer.from(cid.multihash.bytes))!==0)
          throw Error('Stored image failed CID checksum');
        if(bytes.length!==record.bytes||!allowed[record.type]?.(bytes))
          throw Error('Local image corrupted');
        res.writeHead(200,{'content-type':record.type,'content-length':bytes.length,
          'cache-control':'no-store','x-content-type-options':'nosniff',
          'cross-origin-resource-policy':'cross-origin','access-control-allow-origin':'*'});
        res.end(bytes);
      }catch{send(res,503,{error:'IPFS bytes not available on this peer'});}
      return;
    }
    send(res,404,{error:'Unknown media path'});
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(port,host,resolve);
  });
  return {
    host,port:server.address().port,uploadEnabled,
    get count(){return Object.keys(manifest).length;},
    get totalBytes(){return totalBytes;},
    async close(){await new Promise(resolve=>server.close(resolve));}
  };
}
