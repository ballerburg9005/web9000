// Optional operator-issued, file-specific entitlement for a larger MEDIA
// file. The gateway only verifies a PINNED Ed25519 media issuer. It NEVER
// trusts client-declared USD, wallet balances, or self-issued stake receipts.
// A separate audited verifier + trusted USD pricing is REQUIRED before an
// operator can legitimately issue a $100/$1000 Stake4Karma grant.
// The existing Base Sepolia testnet verifier is NOT real USD collateral.
import {randomBytes} from 'node:crypto';
import {canonical} from '../core/events.js';
import {MEDIA_PHYSICAL_LIMITS,mediaMaxForStake} from '../core/media-resource-policy.js';

const DOMAIN='WEB9000/media-stake-grant/v1\n';
const PUB=/^ed25519:[A-Za-z0-9_-]{43}$/;
const HEX=/^[0-9a-f]{64}$/;
const B64=/^[A-Za-z0-9_-]{86}$/;
const encoder=new TextEncoder();
const shape=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
 Object.keys(object).sort().join(',')===keys.slice().sort().join(',');
const fields=['version','issuer','subject','audience','scope','mediaType','bytes',
 'sha256','stakeUsdCents','evidenceSha256','issuedAt','expiresAt','nonce'];
function validBody(b){
 return shape(b,fields)&&b.version===1&&PUB.test(b.issuer||'')&&
 PUB.test(b.subject||'')&&b.scope==='media-upload'&&
 typeof b.audience==='string'&&
 /^[a-z0-9][a-z0-9-]{2,80}$/.test(b.audience)&&
 Object.hasOwn(MEDIA_PHYSICAL_LIMITS,b.mediaType)&&
 Number.isSafeInteger(b.bytes)&&b.bytes>0&&
 b.bytes<=MEDIA_PHYSICAL_LIMITS[b.mediaType]&&HEX.test(b.sha256||'')&&
 HEX.test(b.evidenceSha256||'')&&
 Number.isSafeInteger(b.stakeUsdCents)&&b.stakeUsdCents>=10000&&
 b.stakeUsdCents<=100000000000&&
 b.bytes<=mediaMaxForStake(b.mediaType,b.stakeUsdCents)&&
 Number.isSafeInteger(b.issuedAt)&&b.issuedAt>0&&
 Number.isSafeInteger(b.expiresAt)&&b.expiresAt>b.issuedAt&&
 b.expiresAt-b.issuedAt<=300000&&
 /^[0-9a-f]{32}$/.test(b.nonce||'');
}
export async function signMediaStakeGrant({signer,subject,audience,mediaType,
 bytes,sha256,stakeUsdCents,evidenceSha256,now=Date.now(),ttlMs=60000}={}){
 if(!signer?.privateKey||!PUB.test(signer.author||'')||
    !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000)
  throw Error('Explicit independent operator signing key and short TTL required');
 const body={version:1,issuer:signer.author,subject,audience,
  scope:'media-upload',mediaType,bytes,sha256,stakeUsdCents,
  evidenceSha256,issuedAt:now,expiresAt:now+ttlMs,
  nonce:randomBytes(16).toString('hex')};
 if(!validBody(body))throw Error('Invalid file-specific operator stake grant');
 const sig=new Uint8Array(await crypto.subtle.sign('Ed25519',signer.privateKey,
  encoder.encode(DOMAIN+canonical(body))));
 return Buffer.from(JSON.stringify({
  body,signature:Buffer.from(sig).toString('base64url')
 })).toString('base64url');
}
export async function verifyMediaStakeGrant(token,{
 expectedIssuer,audience,type,bytes,now=Date.now()
}={}){
 const fail=reason=>({valid:false,reason});
 if(!PUB.test(expectedIssuer||'')||
    !/^[a-z0-9][a-z0-9-]{2,80}$/.test(audience||'')||
    !Object.hasOwn(MEDIA_PHYSICAL_LIMITS,type)||
    !Number.isSafeInteger(bytes)||bytes<1||
    !Number.isSafeInteger(now))return fail('invalid-verifier-configuration');
 if(typeof token!=='string'||token.length<1||token.length>2048||
    !/^[A-Za-z0-9_-]+$/.test(token))return fail('missing-or-oversized-stake-grant');
 try{
  const decoded=Buffer.from(token,'base64url');
  if(decoded.length>1536)return fail('oversized-stake-grant');
  const grant=JSON.parse(decoded.toString('utf8'));
  if(!shape(grant,['body','signature'])||!validBody(grant.body)||
     !B64.test(grant.signature||''))
   return fail('invalid-stake-grant-shape');
  const b=grant.body;
  if(b.issuer!==expectedIssuer||b.audience!==audience||
     b.mediaType!==type||b.bytes!==bytes||
     b.issuedAt>now+30000||b.expiresAt<=now)
   return fail('issuer-audience-file-or-expiry-mismatch');
  const pub=await crypto.subtle.importKey('raw',
   Buffer.from(expectedIssuer.slice(8),'base64url'),'Ed25519',false,['verify']);
  const authentic=await crypto.subtle.verify('Ed25519',pub,
   Buffer.from(grant.signature,'base64url'),
   encoder.encode(DOMAIN+canonical(b)));
  if(!authentic)return fail('invalid-stake-grant-signature');
  return {valid:true,subject:b.subject,mediaType:b.mediaType,bytes:b.bytes,
   sha256:b.sha256,usdCents:b.stakeUsdCents,
   evidenceSha256:b.evidenceSha256,expiresAt:b.expiresAt,
   issuer:b.issuer,audience:b.audience};
 }catch{return fail('invalid-stake-grant');}
}
