// OPTIONAL operator-side acquisition helper. No browser/network runtime import.
// Fetches ONLY exact HTTPS origins from an operator-owned PRIVATE local plan,
// stages immutable source snapshot bytes with SHA-256, and produces the private
// hash manifest accepted by source-feed-operator.mjs --sources.
//
// It NEVER updates the running peer, signs, overwrites the current observer
// identity, rewrites an existing snapshot, or automatically trusts a vendor.
// Operator must inspect the staged files/rule diff and explicitly sign later.
import {readFile,lstat,mkdtemp,open,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {sourceCategories} from './source-provenance.js';

const MAX_SOURCES=8;
const MAX_FILE_BYTES=128*1024*1024;
const MAX_TOTAL_BYTES=256*1024*1024;
const FIELDS=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===fields.slice().sort().join(',');
const asHttps=value=>{
 if(typeof value!=='string'||value.length>1024)
  throw Error('Operator source URL must be an exact HTTPS URL');
 const u=new URL(value);
 if(u.protocol!=='https:'||!u.hostname||u.username||u.password||
    u.hash||u.port)
  throw Error('Only explicit HTTPS source URLs without credentials or redirects');
 return u.toString();
};
export function validateRefreshPlan(plan){
 if(!FIELDS(plan,['transform','sources'])||
    typeof plan.transform!=='string'||plan.transform.length<1||
    plan.transform.length>128||
    !Array.isArray(plan.sources)||plan.sources.length<1||
    plan.sources.length>MAX_SOURCES)
  throw Error('Invalid bounded source refresh plan');
 const seen=new Set(),sources=[];
 for(const entry of plan.sources){
  if(!FIELDS(entry,['category','uri','license'])||
    !sourceCategories.includes(entry.category)||
    typeof entry.license!=='string'||entry.license.length<1||
    entry.license.length>160)
   throw Error('Source refresh plan requires category, HTTPS URL and reviewed license');
  const uri=asHttps(entry.uri);
  const key=entry.category+'|'+uri;
  if(seen.has(key))throw Error('Duplicated source refresh URL/category');
  seen.add(key);
  sources.push({category:entry.category,uri,license:entry.license});
 }
 return {transform:plan.transform,sources};
}
export async function stageSourceRefresh(plan,baseDirectory,{
 fetchImpl=fetch,now=()=>Date.now()
}={}){
 const normalized=validateRefreshPlan(plan);
 if(!isAbsolute(baseDirectory))throw Error('Staging directory must be absolute');
 const root=await lstat(baseDirectory);
 if(!root.isDirectory()||(root.mode&0o077)!==0)
  throw Error('Source refresh parent must be an operator-private 0700 directory');
 const directory=await mkdtemp(join(baseDirectory,'source-refresh-'));
 let total=0;
 const sources=[];
 try{
  for(let i=0;i<normalized.sources.length;i++){
   const spec=normalized.sources[i];
   const response=await fetchImpl(spec.uri,{
    method:'GET',redirect:'error',
    headers:{'accept-encoding':'identity'},
    signal:AbortSignal.timeout(30000)
   });
   if(response.status!==200||!response.body)
    throw Error('Pinned source URL did not return an HTTP 200 body');
   const length=Number(response.headers.get('content-length'));
   if(response.headers.has('content-length')&&
      (!Number.isSafeInteger(length)||length<1||
       length>MAX_FILE_BYTES||total+length>MAX_TOTAL_BYTES))
    throw Error('Source content-length exceeds private staging budget');
   const suffix=new URL(spec.uri).pathname.endsWith('.gz')?'.tsv.gz':'.txt';
   const filename=join(directory,'source-'+i+suffix);
   const handle=await open(filename,'wx',0o600);
   const digest=createHash('sha256');
   let bytes=0;
   try{
    const stream=response.body.getReader();
    try{
     for(;;){
      const {done,value}=await stream.read();
      if(done)break;
      bytes+=value.byteLength;total+=value.byteLength;
      if(bytes>MAX_FILE_BYTES||total>MAX_TOTAL_BYTES)
       throw Error('Source exceeds private streaming budget');
      digest.update(value);
      await handle.writeFile(value);
     }
    }finally{await stream.cancel().catch(()=>{});}
    await handle.sync();
   }finally{await handle.close();}
   if(bytes<1)throw Error('Empty external source dataset');
   sources.push({...spec,file:filename,sha256:digest.digest('hex'),
    bytes,retrievedAt:now()});
  }
  const manifest={transform:normalized.transform,sources};
  const handle=await open(join(directory,'sources.json'),'wx',0o600);
  try{await handle.writeFile(JSON.stringify(manifest,null,2)+'\n');
   await handle.sync();}finally{await handle.close();}
  return {directory,sourcesFile:join(directory,'sources.json'),manifest};
 }catch(error){
  // Remove only the NEW directory created above. No live operator key,
  // existing data, running peer or other user file is ever modified.
  await rm(directory,{recursive:true,force:true});
  throw error;
 }
}
