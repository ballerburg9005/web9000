// Operator-pinned, short-lived, subject-bound routing receipt.
// Experimental signed authorization for physical worker access.
// NOT an earned-karma, invitation, group, or Stake4Karma verifier.
// A credential authorizes routing ONLY for the signed subject; worker
// independently verifies the ORIGINAL authored event Ed25519 signature.
import {createHash,randomBytes} from 'node:crypto';
import {canonical} from '../core/events.js';

const DOMAIN='WEB9000/operator-ingress-capability/v1';
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const TIERS=new Set(['sponsored','established']);
const MAX_TTL=300000;
const MAX_TOKEN_BYTES=2048;
const encoder=new TextEncoder();
const hex=value=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
function exactKeys(o,names){
  return o&&typeof o==='object'&&!Array.isArray(o)&&
    Object.keys(o).sort().join(',')===names.sort().join(',');
}
export async function issueIngressCapability({
  signer,subject,className,now=Date.now(),ttlMs=60000
}={}){
  if(!signer?.privateKey||!AUTHOR.test(signer.author||'')||
     !AUTHOR.test(subject||'')||!TIERS.has(className)||
     !Number.isSafeInteger(now)||now<0||
     !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>MAX_TTL)
    throw Error('Operator-issued capability requires pinned signing identity, subject and bounded time');
  const body={version:1,issuer:signer.author,subject,
    className,scope:'metadata-publish',issuedAt:now,expiresAt:now+ttlMs,
    nonce:randomBytes(16).toString('hex')};
  const digest=hex(body);
  const signature=Buffer.from(await crypto.subtle.sign('Ed25519',
    signer.privateKey,encoder.encode(DOMAIN+'\n'+digest))).toString('base64url');
  return Buffer.from(JSON.stringify({body,signature})).toString('base64url');
}

export async function verifyIngressCapability(token,{
  expectedIssuer,now=Date.now(),subject=null,className=null
}={}){
  const fail=reason=>({valid:false,reason});
  if(!AUTHOR.test(expectedIssuer||'')||
     !Number.isSafeInteger(now)||now<0)
    throw Error('Pinned issuer and valid local clock required');
  if(typeof token!=='string'||token.length<1||
     token.length>MAX_TOKEN_BYTES||!/^[A-Za-z0-9_-]+$/.test(token))
    return fail('bad-credential-format');
  let obj;
  try{
    const bytes=Buffer.from(token,'base64url');
    if(bytes.length>MAX_TOKEN_BYTES)throw Error('too large');
    obj=JSON.parse(bytes.toString('utf8'));
  }catch{return fail('bad-credential-encoding');}
  if(!exactKeys(obj,['body','signature'])||
     !exactKeys(obj.body,['version','issuer','subject','className',
       'scope','issuedAt','expiresAt','nonce']))
    return fail('bad-credential-envelope');
  const b=obj.body;
  if(b.version!==1||b.issuer!==expectedIssuer||
    !AUTHOR.test(b.subject||'')||!TIERS.has(b.className)||
    b.scope!=='metadata-publish'||!/^[0-9a-f]{32}$/.test(b.nonce||'')||
    !Number.isSafeInteger(b.issuedAt)||!Number.isSafeInteger(b.expiresAt)||
    b.issuedAt>now+30000||b.expiresAt<=now||
    b.expiresAt-b.issuedAt<1000||b.expiresAt-b.issuedAt>MAX_TTL||
    (subject!==null&&subject!==b.subject)||
    (className!==null&&className!==b.className))
    return fail('issuer-subject-scope-or-time-mismatch');
  if(typeof obj.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(obj.signature))
    return fail('bad-credential-signature');
  try{
    const pub=await crypto.subtle.importKey('raw',
      Buffer.from(expectedIssuer.slice(8),'base64url'),
      'Ed25519',false,['verify']);
    const verified=await crypto.subtle.verify('Ed25519',pub,
      Buffer.from(obj.signature,'base64url'),
      encoder.encode(DOMAIN+'\n'+hex(b)));
    if(!verified)return fail('bad-credential-signature');
  }catch{return fail('bad-credential-signature');}
  return {valid:true,subject:b.subject,className:b.className,
    expiresAt:b.expiresAt,issuer:expectedIssuer};
}
