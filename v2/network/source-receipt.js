// Browser-safe, per-event TRANSIENT ingress-hop observation, separate from
// original signed publication. This never proves the author's physical IP
// or location: if the event was forwarded, it describes the last hop only.
// The node records no raw IP/prefix in the receipt, and the browser never
// treats unpinned observer keys as independent truth.
import {canonical} from '../core/events.js';
const DOMAIN='WEB9000/ingress-hop-observation/v1\n';
const utf8=new TextEncoder(),AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const ID=/^sha256:[0-9a-f]{64}$/;
const HASH=/^[0-9a-f]{64}$/;
const KIND=new Set(['residential','mobile','vpn','proxy','tor','datacenter','hosting','relay','unknown']);
const HOP=new Set(['direct-socket','trusted-proxy','unknown']);
const b64=x=>typeof Buffer!=='undefined'?Buffer.from(x).toString('base64url'):
 btoa(String.fromCharCode(...x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bytes=x=>{
 if(typeof x!=='string'||!/^[A-Za-z0-9_-]+$/.test(x))throw Error('Invalid base64');
 if(typeof Buffer!=='undefined')return Uint8Array.from(Buffer.from(x,'base64url'));
 const bin=atob(x.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-x.length%4)%4));
 return Uint8Array.from(bin,c=>c.charCodeAt(0));
};
const keyset=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
export function observationResourceClass(kind){
 return ['vpn','proxy','tor','datacenter','hosting','relay'].includes(kind)?
  'concentrated':['residential','mobile'].includes(kind)?'general':'unknown';
}
function validate(body){
 if(!keyset(body,['version','eventId','observedAt','expiresAt','hop',
  'networkKind','country','asn','feedDigest'])||
  body.version!==1||!ID.test(body.eventId)||
  !Number.isSafeInteger(body.observedAt)||body.observedAt<0||
  !Number.isSafeInteger(body.expiresAt)||
  body.expiresAt<=body.observedAt||
  body.expiresAt-body.observedAt>600000||
  !HOP.has(body.hop)||!KIND.has(body.networkKind)||
  !/^[A-Z]{2}$/.test(body.country)||
  !/^AS(?:0|[1-9][0-9]{0,9})$/.test(body.asn)||
  Number(body.asn.slice(2))>4294967295||
  !(body.feedDigest===null||HASH.test(body.feedDigest)))
  throw Error('Invalid signed source-hop observation');
 return body;
}
export async function signSourceReceipt(signer,{
 eventId,observedAt=Date.now(),hop='unknown',networkKind='unknown',
 country='ZZ',asn='AS0',feedDigest=null,ttlMs=120000
}={}){
 if(!AUTHOR.test(signer?.author||'')||!signer.privateKey||
  !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>600000)
  throw Error('Signed ingress observer required');
 const body=validate({version:1,eventId,observedAt,
  expiresAt:observedAt+ttlMs,hop,networkKind,country,asn,feedDigest});
 const signature=b64(new Uint8Array(await crypto.subtle.sign(
  'Ed25519',signer.privateKey,utf8.encode(DOMAIN+canonical(body)))));
 return {issuer:signer.author,body,signature};
}
export async function verifySourceReceipt(receipt,{
 expectedIssuer,eventId,now=Date.now()
}={}){
 if(!AUTHOR.test(expectedIssuer||'')||!ID.test(eventId||'')||
   !Number.isSafeInteger(now))throw Error('Pinned observer and event required');
 try{
  if(!keyset(receipt,['issuer','body','signature'])||
    receipt.issuer!==expectedIssuer||
    receipt.body?.eventId!==eventId)return {valid:false,reason:'untrusted-or-mismatched-observer'};
  const body=validate(receipt.body);
  if(body.expiresAt<=now||body.observedAt>now+30000)
   return {valid:false,reason:'stale-or-future-ingress-observation'};
  const pub=bytes(expectedIssuer.slice(8)),sig=bytes(receipt.signature);
  if(pub.length!==32||sig.length!==64)
   return {valid:false,reason:'invalid-source-observation-signature'};
  const key=await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,sig,utf8.encode(DOMAIN+canonical(body))))
   return {valid:false,reason:'invalid-source-observation-signature'};
  return {valid:true,issuer:expectedIssuer,eventId,
   networkKind:body.networkKind,country:body.country,asn:body.asn,
   hop:body.hop,resourceClass:observationResourceClass(body.networkKind),
   expiresAt:body.expiresAt,feedDigest:body.feedDigest};
 }catch{return {valid:false,reason:'invalid-source-observation'};}
}
