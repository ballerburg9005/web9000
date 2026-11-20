// Browser-compatible, domain-separated operator source-data provenance receipt.
// This attests what bytes the operator CLAIMS to have used. Independently
// compare the listed source SHA-256 against source data from its publisher;
// a signed operator statement alone cannot establish geographic truth.
import {canonical} from '../core/events.js';

const UTF8=new TextEncoder();
const DOMAIN='WEB9000/source-data-provenance/v1\n';
const SHA=/^[0-9a-f]{64}$/;
const PUB=/^ed25519:[A-Za-z0-9_-]{43}$/;
const URL_MAX=1024;
const bytes=s=>{
 if(typeof Buffer!=='undefined')return Uint8Array.from(Buffer.from(s,'base64url'));
 const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const encoded=b=>typeof Buffer!=='undefined'?Buffer.from(b).toString('base64url'):
 btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const asUrl=value=>{
 if(typeof value!=='string'||value.length>URL_MAX)return false;
 try{const u=new URL(value);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;
 }catch{return false;}
};
export const sourceCategories=Object.freeze([
 'iptoasn','vpn','datacenter','proxy','tor','other'
]);
export function validateSourceProvenanceBody(body){
 if(!shape(body,['version','revision','feedDigest','previousFeedDigest','rulesSha256',
    'rulesCount','createdAt','expiresAt','sources','transform'])||
   body.version!==1||!Number.isSafeInteger(body.revision)||body.revision<1||
   !SHA.test(body.feedDigest)||!SHA.test(body.rulesSha256)||
   !(body.revision===1?body.previousFeedDigest===null:
     SHA.test(body.previousFeedDigest))||
   !Number.isSafeInteger(body.rulesCount)||body.rulesCount<1||body.rulesCount>131072||
   !Number.isSafeInteger(body.createdAt)||body.createdAt<0||
   !Number.isSafeInteger(body.expiresAt)||body.expiresAt<=body.createdAt||
   body.expiresAt-body.createdAt>7*86400000||
   !Array.isArray(body.sources)||body.sources.length<1||body.sources.length>8||
   typeof body.transform!=='string'||body.transform.length<1||
   body.transform.length>128)
  throw Error('Invalid bounded source provenance fields');
 const used=new Set();
 for(const entry of body.sources){
  if(!shape(entry,['category','uri','license','sha256','bytes','retrievedAt'])||
    !sourceCategories.includes(entry.category)||
    !asUrl(entry.uri)||
    typeof entry.license!=='string'||entry.license.length<1||
    entry.license.length>160||
    !SHA.test(entry.sha256)||
    !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
    entry.bytes>128*1024*1024||
    !Number.isSafeInteger(entry.retrievedAt)||entry.retrievedAt<0||
    entry.retrievedAt>body.createdAt+30000||
    entry.retrievedAt<body.createdAt-30*86400000||
    used.has(entry.category+'|'+entry.uri))
   throw Error('Invalid/duplicate source provenance evidence');
  used.add(entry.category+'|'+entry.uri);
 }
 if(UTF8.encode(canonical(body)).length>12*1024)
  throw Error('Source provenance record exceeds bounded verification size');
 return body;
}
export async function digestRules(rules){
 if(!Array.isArray(rules)||rules.length>131072)throw Error('Invalid source rule set');
 const b=await crypto.subtle.digest('SHA-256',UTF8.encode(canonical(rules)));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function signSourceProvenance(signer,body){
 validateSourceProvenanceBody(body);
 if(!PUB.test(signer?.author||'')||!signer.privateKey)
  throw Error('Source feed operator signing identity required');
 const signature=new Uint8Array(await crypto.subtle.sign('Ed25519',
  signer.privateKey,UTF8.encode(DOMAIN+canonical(body))));
 return {issuer:signer.author,body,signature:encoded(signature)};
}
export async function verifySourceProvenance(record,{
 expectedIssuer,feedDigest,revision,now=Date.now()
}={}){
 const fail=reason=>({valid:false,reason});
 if(!PUB.test(expectedIssuer||'')||!SHA.test(feedDigest||'')||
    !Number.isSafeInteger(revision)||revision<1||
    !Number.isSafeInteger(now))throw Error('Pinned source observer and feed required');
 try{
  if(!shape(record,['issuer','body','signature'])||
    record.issuer!==expectedIssuer||
    !/^[A-Za-z0-9_-]{86}$/.test(record.signature||''))
   return fail('untrusted-source-provenance');
  const body=validateSourceProvenanceBody(record.body);
  if(body.feedDigest!==feedDigest||body.revision!==revision)
   return fail('source-provenance-does-not-match-feed');
  if(body.createdAt>now+30000||body.expiresAt<=now)
   return fail('expired-or-future-source-provenance');
  const pub=bytes(expectedIssuer.slice(8)),sig=bytes(record.signature);
  if(pub.length!==32||sig.length!==64)
   return fail('invalid-source-provenance-signature');
  const key=await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);
  const good=await crypto.subtle.verify('Ed25519',key,sig,
   UTF8.encode(DOMAIN+canonical(body)));
  if(!good)return fail('invalid-source-provenance-signature');
  return {valid:true,issuer:record.issuer,revision,feedDigest,
   rulesSha256:body.rulesSha256,rulesCount:body.rulesCount,
   previousFeedDigest:body.previousFeedDigest,
   transform:body.transform,sources:body.sources,createdAt:body.createdAt,
   expiresAt:body.expiresAt,
   // Preserve the exact original signed document for independent export.
   document:record};
 }catch{return fail('invalid-source-provenance-record');}
}
