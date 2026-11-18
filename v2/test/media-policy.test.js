import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {decideMedia,enforceLocalPins} from '../core/media-policy.js';
import {DEFAULT_POLICY} from '../core/policy.js';
const CID='ipfs://bafybeigdyrzt3cu5z4z4bz3hyjipfxzabfqb4zl3nkrhuxuu7pn7efq3aa';
const second='ipfs://bafybeihgi6j7ehnwqwasc2n6gccodvz3ga4jfdtfwhknj7uckoar7oysv4';
const fake='sha256:'+'f'.repeat(64);
const post=async actor=>signEvent(actor,{body:{title:'image',text:'x',media:[CID]}});
const label=async actor,tag,target=CID=>signEvent(actor,{kind:'label',body:{tag,target,reason:'safety reviewer assertion'}});
test('media CID can be individually labeled without changing any post',async()=>{
  const reviewer=await generateIdentity();
  const e=await label(reviewer,'malware');assert.equal(e.payload.body.target,CID);
});
test('unfamiliar media never auto-downloads under default policy',async()=>{
  const viewer=await generateIdentity(),author=await generateIdentity(),event=await post(author);
  const d=decideMedia({cid:CID,post:event,events:[event],policy:{...DEFAULT_POLICY,followedSpaces:['commons']},viewer:viewer.author});
  assert.equal(d.fetch,false);assert.equal(d.keepPinned,true);
  assert.equal(d.reason,'manual media request required');
});
test('independent quorum required for automatic quarantine; one reviewer cannot multiply votes',async()=>{
  const a=await generateIdentity(),b=await generateIdentity(),author=await generateIdentity();
  const original=await post(author);
  const l1=await label(a,'malware'),l2=await label(a,'malware'),l3=await label(b,'malware');
  const policy={...DEFAULT_POLICY,reviewerWeights:{[a.author]:1,[b.author]:1},followedSpaces:['commons']};
  let d=decideMedia({cid:CID,post:original,events:[original,l1,l2],policy});
  assert.equal(d.reason,'manual media request required');
  d=decideMedia({cid:CID,post:original,events:[original,l1,l2,l3],policy});
  assert.equal(d.fetch,false);assert.equal(d.keepPinned,false);assert.equal(d.quarantine,true);
});
test('source post labels can block media references across that post only',async()=>{
  const reviewer=await generateIdentity(),author=await generateIdentity();
  const p=await post(author),f=await label(reviewer,'malware',p.id);
  const policy={...DEFAULT_POLICY,reviewerWeights:{[reviewer.author]:2}};
  const d=decideMedia({cid:CID,post:p,events:[p,f],policy});
  assert.equal(d.fetch,false);assert.equal(d.keepPinned,false);
});
test('operator controls unpin and no one else has remote deletion authority',async()=>{
  const reviewer=await generateIdentity(),bad=await label(reviewer,'malware');
  const policy={...DEFAULT_POLICY,reviewerWeights:{[reviewer.author]:2}};
  const unpinned=[];
  const opts={pinned:[CID,second],events:[bad],policy,mediaPolicy:{autoUnpin:true},unpin:async cid=>unpinned.push(cid)};
  const result=await enforceLocalPins(opts);
  assert.deepEqual(unpinned,[CID.slice(7)]);assert.equal(result.removed.length,1);
  assert.deepEqual(result.skipped,[second]);
  const noOp=await enforceLocalPins({...opts,mediaPolicy:{autoUnpin:false},unpin:async()=>{throw Error('should not run');}});
  assert.equal(noOp.removed.length,0);
});
test('arbitrary untrusted allegations are not local quarantine decisions',async()=>{
  const actor=await generateIdentity();
  const claim=await label(actor,'sexual-abuse-material');
  const d=decideMedia({cid:CID,events:[claim],policy:DEFAULT_POLICY,mediaPolicy:{autoUnpin:true}});
  assert.equal(d.keepPinned,true);
});
