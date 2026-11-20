// Offline operator utility for signing versioned IP/ASN/VPN lists.
// Rules are supplied by the operator as JSON. NO hidden vendor feed,
// third-party network call, national blocklist or global authority.
//
//   node source-feed-operator.mjs init /private/observer.json /private/rules.json
//   node source-feed-operator.mjs update /private/observer.json /private/rules.json
//
// 0600 private observer key must NEVER be placed in a public web root.
import {readFile,open,lstat,rename,unlink} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {generateIdentity} from '../core/events.js';
import {signSourceFeed,validateSourceFeedBody} from './source-feed.js';
import {signSourceFeedBundle,verifySourceFeedDocument} from './source-feed-bundle.js';
import {digestRules,signSourceProvenance,verifySourceProvenance} from './source-provenance.js';
import {readVerifiedSourceSnapshots} from './source-provenance-files.mjs';
import {importOperatorSigningKey} from './operator-proof-service.mjs';

const [mode,file,rulesPath,sourcesFlag,sourcesPath]=process.argv.slice(2);
if(!['init','update'].includes(mode)||!file||!rulesPath||
   !isAbsolute(file)||!isAbsolute(rulesPath)||resolve(file)!==file||
   (sourcesFlag!==undefined&&
     (sourcesFlag!=='--sources'||!sourcesPath||!isAbsolute(sourcesPath)))||
   process.argv.length>(sourcesFlag?7:5))
 throw Error('Usage: source-feed-operator.mjs init|update /absolute/private-observer.json /absolute/rules.json [--sources /absolute/private-snapshots.json]');
const raw=await readFile(rulesPath,'utf8');
if(Buffer.byteLength(raw)>12*1024*1024)
 throw Error('Rules file exceeds bounded source intelligence size');
const rules=JSON.parse(raw);
if(!Array.isArray(rules))throw Error('Expected a JSON array of CIDR rules');
let signer,pkcs8,revision,trustedProxyAddress,previousFeedDigest=null;
if(mode==='init'){
 try{await lstat(file);throw Error('Refusing to overwrite existing operator key');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 signer=await generateIdentity({extractable:true});
 pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',signer.privateKey))
   .toString('base64');
 revision=1;
}else{
 const stat=await lstat(file);
 if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>12*1024*1024)
  throw Error('Existing observer private key file must be regular and 0600');
 const old=JSON.parse(await readFile(file,'utf8'));
 signer=await importOperatorSigningKey(old);
 if(old.provenance&&!sourcesPath)
   throw Error('An operator with signed source provenance must continue providing --sources on every update');
 // A source feed may have EXPIRED before its operator can renew it.
 // Historical signature+digest verification is still possible at the
 // document's original issue time. Refusing all expired predecessors would
 // permanently strand the same signing key after a one-week outage.
 const priorIssuedAt=old.feed?.manifest?.body?.issuedAt||
   old.feed?.body?.issuedAt;
 if(!Number.isSafeInteger(priorIssuedAt)||priorIssuedAt>Date.now()+30000)
   throw Error('Invalid historical operator source issue timestamp');
 const preceding=await verifySourceFeedDocument(old.feed,{
   expectedIssuer:signer.author,now:priorIssuedAt+1
 });
 if(!preceding.valid)throw Error('Previous operator source feed fails independent verification');
 if(old.provenance){
   const issued=old.provenance?.body?.createdAt;
   if(!Number.isSafeInteger(issued)||issued>Date.now()+30000)
     throw Error('Invalid historical signed provenance timestamp');
   const priorClaim=await verifySourceProvenance(old.provenance,{
     expectedIssuer:signer.author,feedDigest:preceding.digest,
     revision:preceding.revision,now:issued+1
   });
   if(!priorClaim.valid||priorClaim.rulesSha256!==await digestRules(preceding.rules)||
      priorClaim.rulesCount!==preceding.rules.length)
     throw Error('Refusing to update a mismatched previous operator source provenance');
 }
 previousFeedDigest=preceding.digest;
 pkcs8=old.pkcs8;revision=(old.feed?.manifest?.body?.revision||old.feed?.body?.revision)+1;
 if(!Number.isSafeInteger(revision)||revision<2)
  throw Error('Invalid persisted source list revision');
 trustedProxyAddress=old.trustedProxyAddress;
}
const now=Date.now();
const base={revision,issuedAt:now,expiresAt:now+7*86400000,rules};
let feed;
if(rules.length<=2048){
 const body={version:1,...base};
 try{feed=await signSourceFeed(signer,validateSourceFeedBody(body));}
 catch(error){
  if(!/Source feed exceeds local verification budget/.test(error.message))
   throw error;
 }
}
if(!feed)feed=await signSourceFeedBundle(signer,base);
const verified=await verifySourceFeedDocument(feed,{
 expectedIssuer:signer.author,now:now+1
});
if(!verified.valid)throw Error('Cannot independently verify newly signed source feed');
let provenance;
if(sourcesPath){
 const checked=await readVerifiedSourceSnapshots(sourcesPath,{now});
 provenance=await signSourceProvenance(signer,{
   version:1,revision,feedDigest:verified.digest,
   previousFeedDigest,rulesSha256:await digestRules(rules),
   rulesCount:rules.length,createdAt:now,expiresAt:base.expiresAt,
   sources:checked.sources,transform:checked.transform
 });
}
const object={issuer:signer.author,pkcs8,feed,
 ...(provenance?{provenance}:{}),
 ...(trustedProxyAddress?{trustedProxyAddress}:{})};
const serialized=JSON.stringify(object,null,2)+'\n';
if(mode==='init'){
 const h=await open(file,'wx',0o600);
 try{await h.writeFile(serialized);await h.sync();}finally{await h.close();}
}else{
 const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
 try{
  const h=await open(tmp,'wx',0o600);
  try{await h.writeFile(serialized);await h.sync();}finally{await h.close();}
  await rename(tmp,file);
  const parent=await open(dirname(file),'r');
  try{await parent.sync();}finally{await parent.close();}
 }catch(e){await unlink(tmp).catch(()=>{});throw e;}
}
console.log(JSON.stringify({ok:true,issuer:signer.author,revision,
 rules:rules.length,format:feed.manifest?'signed-multipart-v2':'signed-v1',
 chunks:feed.manifest?.body?.chunks.length||1,
 provenance:!!provenance,file,
 notice:'Never publish private observer config; distribute only the signed feed document'}));
