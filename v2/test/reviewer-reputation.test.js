import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {groupReputation,reviewerConduct} from '../core/reviewer-reputation.js';
const group='sha256:'+'a'.repeat(64);
test('group reputation includes signed outsider distrust without authority over group users',async()=>{
 const observer=await generateIdentity(),other=await generateIdentity();
 const a=await signEvent(observer,{kind:'group-rating',time:1000,body:{
  group,value:-2,reason:'Unfair handling of critical stories'}});
 const b=await signEvent(other,{kind:'group-rating',time:1001,body:{
  group,value:1,reason:'Helpful spam screening'}});
 const newer=await signEvent(observer,{kind:'group-rating',time:1002,body:{
  group,value:-1,reason:'Moderation improved slightly'}});
 const snap=groupReputation([a,b,newer],group);
 assert.equal(snap.count,2);
 assert.equal(snap.counts.distrust,1);
 assert.equal(snap.counts.trust,1);
 assert.equal(snap.score,0);
 assert.deepEqual(snap.opinions.map(x=>x.id).sort(),[b.id,newer.id].sort());
 assert.equal(await verifyEvent(newer),true);
});
test('self-candidacy remains provisional and does not count as ratified authority',async()=>{
 const reviewer=await generateIdentity();
 const volunteer=await signEvent(reviewer,{kind:'reviewer-candidacy',time:1000,
  body:{group,action:'volunteer',reason:'Willing to help'}});
 const leave=await signEvent(reviewer,{kind:'reviewer-candidacy',time:1100,
  body:{group,action:'withdraw'}});
 assert.equal(groupReputation([volunteer],group).candidates.length,1);
 assert.equal(groupReputation([volunteer,leave],group).candidates.length,0);
});
test('readable reviewer audit is independent of group judgment and dedupes reporter signals',async()=>{
 const observer=await generateIdentity(),reviewer=await generateIdentity();
 const original=await signEvent(reviewer,{kind:'content-rating',time:1000,
  body:{target:'sha256:'+'b'.repeat(64),age:3,
   axes:{controversy:5,democraticUrgency:4,intellectualImportance:4,spamLikelihood:1}}});
 const wrong=await signEvent(observer,{kind:'reviewer-conduct',time:1100,
  body:{group,reviewer:reviewer.author,value:-1,
   reason:'Frequently misses important context',evidence:original.id}});
 const corrected=await signEvent(observer,{kind:'reviewer-conduct',time:1200,
  body:{group,reviewer:reviewer.author,value:1,
   reason:'Reviewer corrected a previous mistake'}});
 const audit=reviewerConduct([original,wrong,corrected],reviewer.author);
 assert.equal(audit.activity.length,1);
 assert.equal(audit.opinions.length,1);
 assert.equal(audit.concerns,0);
 assert.equal(audit.commendations,1);
 assert.equal(audit.opinions[0].id,corrected.id);
});
