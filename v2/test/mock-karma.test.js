import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity} from '../core/events.js';
import {MockKarmaProvider,MOCK_KARMA_MIN_SCORE} from '../core/mock-karma.js';

test('mock provider assigns local identity scores, never proof of stake',async()=>{
 const a=await generateIdentity(),b=await generateIdentity(),p=new MockKarmaProvider();
 assert.equal(MOCK_KARMA_MIN_SCORE,10);
 assert.equal(p.scoreFor(a.author),0);
 assert.equal(p.isTestQualified(a.author),false);
 p.assign(a.author,9);assert.equal(p.isTestQualified(a.author),false);
 p.assign(a.author,10);assert.equal(p.isTestQualified(a.author),true);
 assert.equal(p.isTestQualified(b.author),false);
 const copy=new MockKarmaProvider(p.snapshot());
 assert.equal(copy.scoreFor(a.author),10);
 assert.equal(copy.assign(a.author,20).mode,'SIMULATION ONLY');
 copy.clear(a.author);assert.equal(copy.isTestQualified(a.author),false);
});
test('simulated scores reject malformed identities and invalid numbers',async()=>{
 const a=await generateIdentity(),p=new MockKarmaProvider();
 for(const invalid of [-1,101,0.1,Infinity,NaN,'10'])assert.throws(()=>p.assign(a.author,invalid),/integer/);
 assert.throws(()=>p.assign('cats',50),/ed25519/);
 assert.equal(Object.hasOwn(p.assign(a.author,30),'verification'),false);
 assert.throws(()=>new MockKarmaProvider({minimum:0}),/threshold/);
});
