// Explicit, operator-invoked CID mirroring between independent media peers.
// Never called automatically by browser text synchronization. The operator
// supplies both endpoints and consents to storing the resulting bytes.
import {CID} from 'multiformats/cid';
import {pathToFileURL} from 'node:url';
import {MEDIA_LIMITS} from './media-node.mjs';

function endpoint(value){
 const url=new URL(value);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||
    url.search||url.hash)throw Error('Expected an explicit HTTP(S) media gateway base URL');
 return url.href.replace(/\/$/,'');
}
async function boundedBytes(response,max){
 const declared=Number(response.headers.get('content-length'));
 if(response.headers.has('content-length')&&(!Number.isSafeInteger(declared)||declared<1||declared>max))
   throw Error('Source content length exceeds allowed MiB limits');
 const reader=response.body?.getReader();
 if(!reader)throw Error('No media stream from source');
 const chunks=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>max)throw Error('Source media exceeds allowed MiB limits');
   chunks.push(value);
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 if(total<1||(response.headers.has('content-length')&&declared!==total))
   throw Error('Incomplete source media');
 return Buffer.concat(chunks,total);
}
export async function importMediaCID({cid,sourceBase,targetBase,fetchImpl=fetch}){
 if(typeof cid!=='string')throw Error('CID required');
 const wanted=CID.parse(cid.replace(/^ipfs:\/\//,'')).toString();
 const source=endpoint(sourceBase),target=endpoint(targetBase);
 if(source===target)throw Error('Source and destination must be independent media gateways');
 const read=await fetchImpl(source+'/ipfs/'+encodeURIComponent(wanted),{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)
 });
 if(!read.ok)throw Error('Source media peer refused CID (HTTP '+read.status+')');
 const type=String(read.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!Object.hasOwn(MEDIA_LIMITS,type))throw Error('Source MIME type unsupported');
 const bytes=await boundedBytes(read,MEDIA_LIMITS[type]);
 // Only the target operator decides whether to accept/pin these bytes.
 const upload=await fetchImpl(target+'/upload',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{'content-type':type},body:bytes
 });
 if(upload.status!==201)
  throw Error('Destination operator refused import (HTTP '+upload.status+')');
 const result=await upload.json();
 if(!result||typeof result.cid!=='string'||
    CID.parse(result.cid.replace(/^ipfs:\/\//,'')).toString()!==wanted)
   throw Error('CID mismatch: destination stored different content');
 return {cid:'ipfs://'+wanted,type,bytes:bytes.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cid,sourceBase,targetBase]=process.argv.slice(2);
 if(!cid||!sourceBase||!targetBase){
  console.error('Usage: node mirror-media.mjs <ipfs://CID> <source-media-base> <destination-media-base>');
  process.exitCode=2;
 }else{
  try{console.log(JSON.stringify(await importMediaCID({cid,sourceBase,targetBase})));}
  catch(error){console.error('Mirror refused:',error.message);process.exitCode=1;}
 }
}
