import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateIdentity} from '../core/events.js';
import {signMediaStakeGrant,verifyMediaStakeGrant} from './media-stake-grant.mjs';
import {MiB,KiB} from '../core/media-resource-policy.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
test('a signed dollar-tier media entitlement binds one file, one issuer and one operator audience',async()=>{
 const signer=await generateIdentity(),impostor=await generateIdentity();
 const subject=await generateIdentity(),now=Date.now();
 const request={signer,subject:subject.author,audience:'private-publisher-7',
  mediaType:'video/mp4',bytes:20*MiB,
  sha256:digest('verified video file'),
  stakeUsdCents:10000,evidenceSha256:digest('operator verified stake and price oracle'),
  now};
 const token=await signMediaStakeGrant(request);
 const check={expectedIssuer:signer.author,audience:request.audience,
  type:'video/mp4',bytes:20*MiB,now};
 const valid=await verifyMediaStakeGrant(token,check);
 assert.equal(valid.valid,true,valid.reason);
 assert.equal(valid.usdCents,10000);
 assert.equal(valid.sha256,request.sha256);
 for(const altered of [
  {...check,expectedIssuer:impostor.author},
  {...check,audience:'different-operator'},
  {...check,bytes:20*MiB-1},
  {...check,type:'audio/mpeg'},
  {...check,now:now+60001}
 ])assert.equal((await verifyMediaStakeGrant(token,altered)).valid,false);
 assert.equal((await verifyMediaStakeGrant('invalid self claimed USD',check)).valid,false);
 const raw=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));
 raw.body.stakeUsdCents=100000;
 assert.equal((await verifyMediaStakeGrant(
  Buffer.from(JSON.stringify(raw)).toString('base64url'),check)).valid,false);
});
test('$100 may not exceed 20 MiB and $1000 can authorize 100 MiB only with pinned issuer',async()=>{
 const signer=await generateIdentity(),subject=await generateIdentity();
 const base={signer,subject:subject.author,audience:'sponsor-publisher-1',
  mediaType:'video/mp4',bytes:21*MiB,sha256:digest('21 MiB file'),
  evidenceSha256:digest('operator stake evidence')};
 await assert.rejects(signMediaStakeGrant({...base,stakeUsdCents:10000}),
  /Invalid file-specific/);
 const token=await signMediaStakeGrant({...base,stakeUsdCents:100000,
  bytes:100*MiB});
 const v=await verifyMediaStakeGrant(token,{expectedIssuer:signer.author,
  audience:base.audience,type:'video/mp4',bytes:100*MiB});
 assert.equal(v.valid,true);
 await assert.rejects(signMediaStakeGrant({...base,stakeUsdCents:100000,
  bytes:100*MiB+1}),/Invalid file-specific/);
 await assert.rejects(signMediaStakeGrant({...base,stakeUsdCents:10000,
  mediaType:'image/png',bytes:MiB+1}),/Invalid file-specific/);
 const img=await signMediaStakeGrant({...base,stakeUsdCents:10000,
  mediaType:'image/png',bytes:MiB});
 assert.equal((await verifyMediaStakeGrant(img,{
  expectedIssuer:signer.author,audience:base.audience,type:'image/png',
  bytes:MiB})).valid,true);
});
