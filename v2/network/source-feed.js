// Browser/Node shared, vendor-neutral network intelligence list format.
// A signed list is a source's opinion about IP prefixes, never proof of
// author nationality, human identity or a universal permission to speak.
//
// No built-in geographical or VPN blocklist, no remote URL auto-fetch,
// no client-supplied classification trusted at any server boundary.
import {canonical} from '../core/events.js';
const DOMAIN='WEB9000/network-source-feed/v1\n';
const B64=/^[A-Za-z0-9_-]+$/;
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const TYPES=new Set(['residential','mobile','vpn','proxy','tor','datacenter','hosting','relay','unknown']);
const encoder=new TextEncoder();
const fromB64=x=>{
 if(typeof x!=='string'||!B64.test(x))throw Error('Invalid base64url');
 if(typeof Buffer!=='undefined')return Uint8Array.from(Buffer.from(x,'base64url'));
 const raw=atob(x.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-x.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const toB64=x=>typeof Buffer!=='undefined'?Buffer.from(x).toString('base64url'):
 btoa(String.fromCharCode(...x)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hex=x=>Array.from(x,b=>b.toString(16).padStart(2,'0')).join('');
function v4(ip){
 if(!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip))return null;
 const octets=ip.split('.').map(Number);
 if(octets.some(x=>x>255))return null;
 return octets;
}
function v6(ip){
 if(typeof ip!=='string'||ip.length>45||!/^[0-9a-fA-F:]+$/.test(ip))return null;
 if(ip.includes(':::')||ip.split('::').length>2)return null;
 const parts=ip.split('::');
 const left=parts[0]?parts[0].split(':'):[];
 const right=parts.length===2&&parts[1]?parts[1].split(':'):[];
 if([...left,...right].some(x=>!/^[0-9a-fA-F]{1,4}$/.test(x)))return null;
 const count=left.length+right.length;
 if(parts.length===1&&count!==8 || parts.length===2&&count>=8)return null;
 const groups=[...left,...Array(parts.length===2?8-count:0).fill('0'),...right].map(x=>parseInt(x,16));
 if(groups.length!==8)return null;
 return groups.flatMap(n=>[n>>>8,n&255]);
}
export function parseNetworkIp(ip){
 if(typeof ip!=='string')return null;
 // Reverse proxies can surface IPv4-mapped sockets. Normalize only the
 // exact mapped form, never arbitrary forwarded headers.
 const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
 const addr=mapped?mapped[1]:ip;
 const v=v4(addr);
 if(v)return {version:4,bytes:v};
 const six=v6(addr);
 return six?{version:6,bytes:six}:null;
}
function rangeCidr(value){
 if(typeof value!=='string'||value.length>64)return null;
 const slash=value.lastIndexOf('/');
 if(slash<0||! /^\d{1,3}$/.test(value.slice(slash+1)))return null;
 const ip=parseNetworkIp(value.slice(0,slash)),bits=Number(value.slice(slash+1));
 if(!ip||bits>(ip.version===4?32:128))return null;
 const bytes=ip.bytes.slice();
 for(let j=0;j<bytes.length;j++){
  const width=Math.max(0,Math.min(8,bits-j*8));
  const mask=width===0?0:255<<(8-width)&255;
  if(bytes[j]!== (bytes[j]&mask))return null;
 }
 return {version:ip.version,bytes,bits};
}
// Portable canonical key for detecting overlapping textual representations
// of an identical IP prefix across independently transferred feed chunks.
export function normalizeNetworkCidr(cidr){
 const parsed=rangeCidr(cidr);
 if(!parsed)return null;
 return parsed.version+'|'+parsed.bits+'|'+
  parsed.bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
}
function strictShape(input,keys){
 return input&&typeof input==='object'&&!Array.isArray(input)&&
  Object.keys(input).sort().join(',')===keys.slice().sort().join(',');
}
export function validateSourceFeedBody(body){
 if(!strictShape(body,['version','revision','issuedAt','expiresAt','rules'])||
   body.version!==1||!Number.isSafeInteger(body.revision)||body.revision<1||
   !Number.isSafeInteger(body.issuedAt)||body.issuedAt<0||
   !Number.isSafeInteger(body.expiresAt)||body.expiresAt<=body.issuedAt||
   body.expiresAt-body.issuedAt>7*86400000||
   !Array.isArray(body.rules)||body.rules.length>2048)
  throw Error('Invalid bounded source feed metadata');
 const seen=new Set();
 for(const r of body.rules){
  const network=rangeCidr(r?.cidr);
  // Equivalent IPv6 spellings of the SAME CIDR must not supply
  // contradictory classifications or bypass the unique-prefix bound.
  const normalized=network?network.version+'|'+network.bits+'|'+
    network.bytes.map(b=>b.toString(16).padStart(2,'0')).join(''):null;
  if(!strictShape(r,['cidr','networkKind','country','asn'])||
   !network||
   network.bits>(network.version===4?24:48)||
   !TYPES.has(r.networkKind)||
   !/^[A-Z]{2}$/.test(r.country)||
   !/^AS(?:0|[1-9][0-9]{0,9})$/.test(r.asn)||
   Number(r.asn.slice(2))>4294967295||seen.has(normalized))
    throw Error('Invalid or conflicting source prefix rule');
  seen.add(normalized);
 }
 if(encoder.encode(canonical(body)).length>160*1024)
  throw Error('Source feed exceeds local verification budget');
 return body;
}
export async function signSourceFeed(signer,body){
 validateSourceFeedBody(body);
 if(!AUTHOR.test(signer?.author||'')||!signer.privateKey)
  throw Error('Feed signer required');
 const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonical(body)))));
 const signature=toB64(new Uint8Array(await crypto.subtle.sign('Ed25519',signer.privateKey,
  encoder.encode(DOMAIN+digest))));
 return {issuer:signer.author,body,signature};
}
export async function verifySourceFeed(document,{expectedIssuer,now=Date.now(),minimumRevision=1}={}){
 if(!AUTHOR.test(expectedIssuer||'')||!Number.isSafeInteger(now)||
   !Number.isSafeInteger(minimumRevision)||minimumRevision<1)
  throw Error('Pinned feed identity and local clock required');
 try{
  if(!strictShape(document,['issuer','body','signature'])||
    document.issuer!==expectedIssuer||
    !B64.test(document.signature||''))return {valid:false,reason:'unsigned-or-unpinned-source-feed'};
  validateSourceFeedBody(document.body);
  const b=document.body;
  if(b.revision<minimumRevision||b.issuedAt>now+30000||b.expiresAt<=now)
   return {valid:false,reason:'stale-or-unavailable-source-feed'};
  const pub=fromB64(expectedIssuer.slice(8)),sig=fromB64(document.signature);
  if(pub.length!==32||sig.length!==64)return {valid:false,reason:'invalid-source-feed-signature'};
  const key=await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);
  const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
   encoder.encode(canonical(b)))));
  if(!await crypto.subtle.verify('Ed25519',key,sig,encoder.encode(DOMAIN+digest)))
   return {valid:false,reason:'invalid-source-feed-signature'};
  return {valid:true,issuer:expectedIssuer,revision:b.revision,digest,
   expiresAt:b.expiresAt,rules:b.rules};
 }catch{return {valid:false,reason:'invalid-source-feed'};}
}
// Pre-index prefixes once per independently verified source revision.
// Avoid re-scanning and re-parsing tens of thousands of CIDRs per socket.
const prefixIndexes=new WeakMap();
function prefixKey(version,bits,bytes){
 const normalized=[];
 for(let i=0;i<bytes.length;i++){
  const width=Math.max(0,Math.min(8,bits-i*8));
  const mask=width===0?0:(255<<(8-width))&255;
  normalized.push((bytes[i]&mask).toString(16).padStart(2,'0'));
 }
 return version+'|'+bits+'|'+normalized.join('');
}
function indexedRules(feed){
 let index=prefixIndexes.get(feed);
 if(index)return index;
 index={4:new Map(),6:new Map()};
 for(const rule of feed.rules){
  const net=rangeCidr(rule.cidr);
  if(net)index[net.version].set(prefixKey(net.version,net.bits,net.bytes),rule);
 }
 prefixIndexes.set(feed,index);
 return index;
}
export function classifyObservedIp(ip,verifiedFeed){
 if(!verifiedFeed?.valid||!Array.isArray(verifiedFeed.rules))
  return {networkKind:'unknown',country:'ZZ',asn:'AS0',matched:false,
   reason:'no-verified-source-feed'};
 const addr=parseNetworkIp(ip);
 if(!addr)return {networkKind:'unknown',country:'ZZ',asn:'AS0',matched:false,
  reason:'source-address-unavailable'};
 const index=indexedRules(verifiedFeed)[addr.version];
 const bitsLimit=addr.version===4?24:48;
 let first=null,kind=null,country=null,asn=null;
 for(let bits=bitsLimit;bits>=0;bits--){
  const rule=index.get(prefixKey(addr.version,bits,addr.bytes));
  if(!rule)continue;
  first??=rule;
  // ASN/country intelligence can describe a more-specific prefix while
  // an independent broader VPN/datacenter rule describes its resource type.
  // A more-specific explicitly labeled type still overrides broad labels.
  if(!kind&&rule.networkKind!=='unknown')kind=rule;
  if(!country&&rule.country!=='ZZ')country=rule;
  if(!asn&&rule.asn!=='AS0')asn=rule;
  if(kind&&country&&asn)break;
 }
 if(!first)return {networkKind:'unknown',country:'ZZ',asn:'AS0',
  matched:false,reason:'no-matching-prefix'};
 return {networkKind:kind?.networkKind||first.networkKind,
  country:country?.country||first.country,
  asn:asn?.asn||first.asn,matched:true,
  reason:'verified-operator-source-feed'};
}
