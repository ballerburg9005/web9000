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
import {signSourceFeedBundle} from './source-feed-bundle.js';
import {importOperatorSigningKey} from './operator-proof-service.mjs';

const [mode,file,rulesPath]=process.argv.slice(2);
if(!['init','update'].includes(mode)||!file||!rulesPath||
   !isAbsolute(file)||!isAbsolute(rulesPath)||resolve(file)!==file)
 throw Error('Usage: source-feed-operator.mjs init|update /absolute/private-observer.json /absolute/rules.json');
const raw=await readFile(rulesPath,'utf8');
if(Buffer.byteLength(raw)>12*1024*1024)
 throw Error('Rules file exceeds bounded source intelligence size');
const rules=JSON.parse(raw);
if(!Array.isArray(rules))throw Error('Expected a JSON array of CIDR rules');
let signer,pkcs8,revision,trustedProxyAddress;
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
const object={issuer:signer.author,pkcs8,feed,
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
 chunks:feed.manifest?.body?.chunks.length||1,file,
 notice:'Never publish private observer config; distribute only the signed feed document'}));
