// Node-only operator input-file verification for an optional, separately
// signed provenance receipt. NEVER serves local paths over the peer network.
// A matching digest proves WHICH bytes the operator reviewed, not that the
// provider's country, ASN or VPN classifications are factually correct.
import {open,readFile,lstat} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateSourceProvenanceBody} from './source-provenance.js';
import {CID} from 'multiformats/cid';

const MAX_BYTES=128*1024*1024;
const SHA=/^[0-9a-f]{64}$/;
const SHAPE=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===names.slice().sort().join(',');
export async function readVerifiedSourceSnapshots(manifestPath,{now=Date.now()}={}){
 if(typeof manifestPath!=='string'||!path.isAbsolute(manifestPath))
  throw Error('Source provenance manifest path must be absolute');
 const stat=await lstat(manifestPath);
 if(!stat.isFile()||stat.size>16000)
  throw Error('Local source manifest must be a bounded regular file');
 const input=JSON.parse(await readFile(manifestPath,'utf8'));
 if(!SHAPE(input,['transform','sources'])||!Array.isArray(input.sources)||
    input.sources.length<1||input.sources.length>8)
  throw Error('Invalid source dataset provenance manifest');
 const checked=[],seen=new Set();
 for(const item of input.sources){
  const keys=['category','uri','license','sha256','bytes','retrievedAt',
      'file',...(item?.archiveCid!==undefined?['archiveCid']:[])];
  if(!SHAPE(item,keys)||
     typeof item.file!=='string'||!path.isAbsolute(item.file)||
     !SHA.test(item.sha256)||
     !Number.isSafeInteger(item.bytes)||item.bytes<1||
      item.bytes>MAX_BYTES)
   throw Error('Missing or invalid source file hash pin');
  if(item.archiveCid!==undefined){
   const cid=CID.parse(item.archiveCid);
   if(cid.version!==1||!['bafy','bafk'].some(prefix=>item.archiveCid.startsWith(prefix)))
     throw Error('IPFS archive must be a canonical base32 CIDv1');
  }
  const key=item.category+'|'+item.uri;
  if(seen.has(key))throw Error('Duplicate source dataset provenance');
  seen.add(key);
  const fd=await open(item.file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  let total=0;
  const hash=createHash('sha256');
  try{
   const s=await fd.stat();
   if(!s.isFile()||s.size!==item.bytes||s.size>MAX_BYTES)
    throw Error('Pinned source dataset size differs from local snapshot');
   for await(const bytes of fd.createReadStream({autoClose:false})){
    total+=bytes.byteLength;
    if(total>MAX_BYTES)throw Error('Source dataset exceeds hard cap');
    hash.update(bytes);
   }
  }finally{await fd.close();}
  if(total!==item.bytes||hash.digest('hex')!==item.sha256)
   throw Error('Pinned source dataset SHA-256 differs from local snapshot');
  const {file,...publicItem}=item;
  checked.push(publicItem);
 }
 // Validating a temporary skeleton here ensures source URLs, license
 // claims, timestamps and byte budgets conform before we sign a record.
 validateSourceProvenanceBody({version:1,revision:1,
   feedDigest:'0'.repeat(64),previousFeedDigest:null,
   rulesSha256:'0'.repeat(64),rulesCount:1,
   createdAt:now,expiresAt:now+3600000,
   sources:checked,transform:input.transform});
 return {sources:checked,transform:input.transform};
}
