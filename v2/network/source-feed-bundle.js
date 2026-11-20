// Browser/Node shared multipart, operator-signed IP intelligence.
// Signed envelope + individually signed v1 chunks. This is ONE advisory
// document, NOT additional OrbitDB databases, executable code, or authority.
// Browser requests bounded chunks individually over its chosen peer's WS.
import {canonical} from '../core/events.js';
import {signSourceFeed,verifySourceFeed,validateSourceFeedBody,normalizeNetworkCidr} from './source-feed.js';

const UTF8=new TextEncoder();
const DOMAIN='WEB9000/network-source-manifest/v2\n';
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
export const MAX_FEED_CHUNKS=64;
export const MAX_FEED_RULES=MAX_FEED_CHUNKS*2048;
// v1 already permits a 160 KiB canonical feed body. Keep the same bound
// per chunk so 2,048 compact CIDRs can fit and 64 chunks can truly reach
// the declared 131,072-rule maximum.
const MAX_CHUNK_BYTES=160*1024;
const MAX_MANIFEST_BYTES=16*1024;
const fields=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===names.slice().sort().join(',');
const bytesFromB64=s=>{
 if(typeof Buffer!=='undefined')return Uint8Array.from(Buffer.from(s,'base64url'));
 const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const b64FromBytes=b=>typeof Buffer!=='undefined'?
 Buffer.from(b).toString('base64url'):
 btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const digest=async data=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
 UTF8.encode(canonical(data)))));
function validateManifestBody(body){
 if(!fields(body,['version','revision','issuedAt','expiresAt','totalRules','chunks'])||
   body.version!==2||!Number.isSafeInteger(body.revision)||body.revision<1||
   !Number.isSafeInteger(body.issuedAt)||body.issuedAt<0||
   !Number.isSafeInteger(body.expiresAt)||body.expiresAt<=body.issuedAt||
   body.expiresAt-body.issuedAt>7*86400000||
   !Number.isSafeInteger(body.totalRules)||body.totalRules<1||
   body.totalRules>MAX_FEED_RULES||
   !Array.isArray(body.chunks)||body.chunks.length<2||
   body.chunks.length>MAX_FEED_CHUNKS)
  throw Error('Invalid signed network manifest metadata');
 let sum=0;
 for(const chunk of body.chunks){
  if(!fields(chunk,['digest','count'])||!DIGEST.test(chunk.digest)||
    !Number.isSafeInteger(chunk.count)||chunk.count<1||chunk.count>2048)
   throw Error('Invalid signed network manifest chunk');
  sum+=chunk.count;
 }
 if(sum!==body.totalRules||UTF8.encode(canonical(body)).length>MAX_MANIFEST_BYTES)
  throw Error('Signed network manifest total/range budget mismatch');
 return body;
}
async function signManifest(signer,body){
 validateManifestBody(body);
 if(!AUTHOR.test(signer?.author||'')||!signer.privateKey)
  throw Error('Pinned source feed signing key required');
 const hash=await digest(body);
 const sig=await crypto.subtle.sign('Ed25519',signer.privateKey,
   UTF8.encode(DOMAIN+hash));
 return {issuer:signer.author,body,signature:b64FromBytes(new Uint8Array(sig))};
}
export async function verifySourceFeedManifest(manifest,{
 expectedIssuer,minimumRevision=1,now=Date.now()
}={}){
 const fail=reason=>({valid:false,reason});
 if(!AUTHOR.test(expectedIssuer||'')||
    !Number.isSafeInteger(minimumRevision)||minimumRevision<1||
    !Number.isSafeInteger(now))throw Error('Pinned observer identity and valid local clock required');
 try{
  if(!fields(manifest,['issuer','body','signature'])||
     manifest.issuer!==expectedIssuer||!SIGNATURE.test(manifest.signature||''))
   return fail('untrusted-or-invalid-source-manifest');
  const body=validateManifestBody(manifest.body);
  if(body.revision<minimumRevision||body.issuedAt>now+30000||
     body.expiresAt<=now)return fail('expired-or-rollback-source-manifest');
  const pub=await crypto.subtle.importKey('raw',
    bytesFromB64(expectedIssuer.slice(8)),'Ed25519',false,['verify']);
  const hash=await digest(body);
  const ok=await crypto.subtle.verify('Ed25519',pub,
    bytesFromB64(manifest.signature),UTF8.encode(DOMAIN+hash));
  if(!ok)return fail('bad-source-manifest-signature');
  return {valid:true,issuer:expectedIssuer,revision:body.revision,digest:hash,
    expiresAt:body.expiresAt,chunks:body.chunks,totalRules:body.totalRules,
    issuedAt:body.issuedAt};
 }catch{return fail('invalid-source-manifest');}
}
export async function verifySourceFeedChunk(document,{
 manifest,index,now=Date.now()
}={}){
 if(!manifest?.valid||!Number.isSafeInteger(index)||
    index<0||index>=manifest.chunks.length)
  return {valid:false,reason:'no-verified-manifest-or-invalid-chunk-number'};
 const expected=manifest.chunks[index];
 const verified=await verifySourceFeed(document,{
   expectedIssuer:manifest.issuer,minimumRevision:manifest.revision,now
 });
 if(!verified.valid)return {valid:false,reason:'unverified-source-chunk'};
 if(verified.revision!==manifest.revision||
    verified.expiresAt!==manifest.expiresAt||
    document.body.issuedAt!==manifest.issuedAt||
    verified.digest!==expected.digest||verified.rules.length!==expected.count)
  return {valid:false,reason:'uncommitted-source-chunk'};
 return verified;
}
export function assembleSourceFeedBundle(manifest,verifiedChunks){
 if(!manifest?.valid||!Array.isArray(verifiedChunks)||
   verifiedChunks.length!==manifest.chunks.length)
  throw Error('Incomplete source feed');
 const seen=new Set(),rules=[];
 for(let i=0;i<verifiedChunks.length;i++){
  const chunk=verifiedChunks[i],expected=manifest.chunks[i];
  if(!chunk?.valid||chunk.digest!==expected.digest||
     chunk.rules?.length!==expected.count)
   throw Error('Manifest/chunk digest mismatch');
  for(const rule of chunk.rules){
   const key=normalizeNetworkCidr(rule.cidr);
   if(!key||seen.has(key))throw Error('Duplicate or invalid CIDR across source chunks');
   seen.add(key);
   rules.push(rule);
  }
 }
 if(rules.length!==manifest.totalRules)throw Error('Incomplete source rule list');
 return {valid:true,issuer:manifest.issuer,revision:manifest.revision,
  digest:manifest.digest,expiresAt:manifest.expiresAt,rules,
  format:'chunked-v2'};
}
export async function verifySourceFeedBundle(bundle,options={}){
 const fail=reason=>({valid:false,reason});
 if(!fields(bundle,['manifest','chunks'])||!Array.isArray(bundle.chunks))
  return fail('invalid-source-bundle');
 const manifest=await verifySourceFeedManifest(bundle.manifest,options);
 if(!manifest.valid)return manifest;
 if(bundle.chunks.length!==manifest.chunks.length)
  return fail('incomplete-source-bundle');
 const checked=[];
 for(let i=0;i<bundle.chunks.length;i++){
  const verified=await verifySourceFeedChunk(bundle.chunks[i],{
    manifest,index:i,now:options.now??Date.now()
  });
  if(!verified.valid)return fail(verified.reason);
  checked.push(verified);
 }
 try{return assembleSourceFeedBundle(manifest,checked);}
 catch{return fail('cross-chunk-source-prefix-conflict');}
}
export async function signSourceFeedBundle(signer,{
 revision,issuedAt,expiresAt,rules
}={}, {maxChunkBytes=MAX_CHUNK_BYTES}={}){
 if(!Array.isArray(rules)||rules.length<2||rules.length>MAX_FEED_RULES||
    !Number.isSafeInteger(revision)||revision<1||
    !Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(expiresAt)||
    !Number.isSafeInteger(maxChunkBytes)||maxChunkBytes<8192||
    maxChunkBytes>MAX_CHUNK_BYTES)
  throw Error('Invalid bounded source feed bundle');
 const chunks=[],bodies=[],seen=new Set();
 // Compute canonical JSON byte lengths once per rule. Re-serializing a
 // growing candidate array for every rule is quadratic and lets a large
 // operator dataset monopolize CPU before it can be signed.
 const headerBytes=UTF8.encode(canonical({
  version:1,revision,issuedAt,expiresAt,rules:[]
 })).length;
 let current=[],currentBytes=headerBytes;
 for(const rule of rules){
  const key=normalizeNetworkCidr(rule?.cidr);
  if(!key||seen.has(key))throw Error('Duplicate source network prefix across chunks');
  seen.add(key);
  const ruleBytes=UTF8.encode(canonical(rule)).length;
  const nextBytes=currentBytes+(current.length?1:0)+ruleBytes;
  if(current.length&&(current.length>=2048||nextBytes>maxChunkBytes)){
   bodies.push({version:1,revision,issuedAt,expiresAt,rules:current});
   current=[rule];
   currentBytes=headerBytes+ruleBytes;
  }else{
   current.push(rule);
   currentBytes=nextBytes;
  }
  if(currentBytes>maxChunkBytes)
   throw Error('One source CIDR rule exceeds the signed chunk byte cap');
  if(bodies.length>=MAX_FEED_CHUNKS)
   throw Error('Too many bounded source chunks');
 }
 if(current.length)bodies.push({version:1,revision,issuedAt,expiresAt,rules:current});
 if(bodies.length<2||bodies.length>MAX_FEED_CHUNKS)
  throw Error('Use signed v1 source feed for a single bounded chunk');
 const listed=[];
 for(const body of bodies){
  validateSourceFeedBody(body);
  const document=await signSourceFeed(signer,body);
  chunks.push(document);
  listed.push({digest:await digest(body),count:body.rules.length});
 }
 const manifest=await signManifest(signer,{
  version:2,revision,issuedAt,expiresAt,totalRules:rules.length,chunks:listed
 });
 return {manifest,chunks};
}

export async function verifySourceFeedDocument(document,options={}){
 return document?.manifest?
   verifySourceFeedBundle(document,options):
   verifySourceFeed(document,options);
}
