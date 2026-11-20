// Optional accepting-peer identity and independently signed IP intelligence.
// The raw source IP is read only from a real accepted socket, never from a
// WEB9000 post or untrusted X-Forwarded-For. Operator's signer file remains
// private and MUST NOT be served by a website or replicated through OrbitDB.
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {importOperatorSigningKey} from './operator-proof-service.mjs';
import {verifySourceFeedDocument} from './source-feed-bundle.js';
import {verifySourceProvenance,digestRules} from './source-provenance.js';

export async function loadPeerSourceObserver(file){
 if(typeof file!=='string'||!path.isAbsolute(file))
  throw Error('Operator source config needs an absolute private path');
 const stat=await lstat(file);
 if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size<1||stat.size>12*1024*1024)
  throw Error('Operator source config must be a regular 0600 private file');
 const raw=JSON.parse(await readFile(file,'utf8'));
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
   Object.keys(raw).some(key=>!['issuer','pkcs8','feed','trustedProxyAddress','provenance'].includes(key))||
   !raw.issuer||!raw.pkcs8||!raw.feed)
  throw Error('Invalid operator source configuration');
 const signer=await importOperatorSigningKey(raw);
 if((raw.feed.manifest?.issuer||raw.feed.issuer)!==signer.author)
  throw Error('Source feed must be independently signed by the pinned observer');
 if(raw.trustedProxyAddress!==undefined &&
    !isIP(raw.trustedProxyAddress))
  throw Error('Trusted proxy MUST be one exact IP socket address, not a wildcard');
 const verified=await verifySourceFeedDocument(raw.feed,{expectedIssuer:signer.author});
 if(!verified.valid)throw Error('Rejected unverified/expired source list: '+verified.reason);
 if(raw.provenance){
   const valid=await verifySourceProvenance(raw.provenance,{
     expectedIssuer:signer.author,feedDigest:verified.digest,
     revision:verified.revision
   });
   if(!valid.valid||valid.rulesSha256!==await digestRules(verified.rules)||
      valid.rulesCount!==verified.rules.length)
     throw Error('Signed provenance does not commit actual verified rule dataset');
 }
 return {signer,feed:raw.feed,feedIssuer:signer.author,
   ...(raw.provenance?{provenance:raw.provenance}:{}),
   ...(raw.trustedProxyAddress?{trustedProxyAddress:raw.trustedProxyAddress}:{})};
}
