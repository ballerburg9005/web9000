import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {AGE_TIERS,RATING_AXES,DEFAULT_RATING_RULES,normalizeRatingRules,
 assessContentRatings} from '../core/content-ratings.js';

const axes=(overrides={})=>({
 controversy:1,democraticUrgency:2,intellectualImportance:2,spamLikelihood:1,
 ...overrides
});
const post=async who=>signEvent(who,{body:{title:'A controversial but newsworthy image',text:'Test coverage'}});
const rating=async (who,target,age,more={})=>signEvent(who,{
 kind:'content-rating',body:{target,age,axes:axes(more.axes),...(more.group?{group:more.group}:{})},
 time:more.time??Date.now()
});
test('signed content ratings support PG through extreme/gore/advisory legality with four independent axes',async()=>{
 const who=await generateIdentity(),p=await post(who);
 assert.equal(AGE_TIERS.length,7);
 assert.deepEqual(Object.keys(RATING_AXES),
  ['controversy','democraticUrgency','intellectualImportance','spamLikelihood']);
 for(let age=0;age<=6;age++){
  const e=await rating(who,p.id,age);
  assert.equal(await verifyEvent(e),true);
 }
 const bad=[
  {age:-1,axes:axes()},
  {age:7,axes:axes()},
  {age:3,axes:axes({democraticUrgency:6})},
  {age:3,axes:{controversy:1}},
  {age:3,axes:axes(),target:'sha256:xyz'},
  {age:3,axes:axes(),attacks:'another-groups-decision'}
 ];
 for(const b of bad){
  await assert.rejects(signEvent(who,{kind:'content-rating',
   body:{target:p.id,...b}}),/content rating/);
 }
 const forged=await rating(who,p.id,2);
 forged.payload.body.age=6;
 assert.equal(await verifyEvent(forged),false);
});
test('untrusted signed ratings are inspectable but cannot unilaterally blur or hide a post',async()=>{
 const author=await generateIdentity(),r=await generateIdentity(),p=await post(author);
 const e=await rating(r,p.id,6);
 const replica=new Replica();
 await replica.ingest(p);
 assert.equal((await replica.ingest(e)).accepted,true);
 const result=assessContentRatings(replica.list(),p.id,{rules:{...DEFAULT_RATING_RULES,active:true}});
 assert.equal(result.allSignedCount,1);
 assert.equal(result.qualifiedCount,0);
 assert.equal(result.untrustedCount,1);
 assert.equal(result.action,'clear');
 assert.equal(replica.get(e.id)?.id,e.id);
 assert.equal(replica.get(p.id)?.id,p.id);
});
test('latest signed opinion per public key counts once, popularity never becomes age authority',async()=>{
 const author=await generateIdentity(),r=await generateIdentity(),p=await post(author);
 const a=await rating(r,p.id,6,{time:1000});
 const b=await signEvent(r,{kind:'content-rating',time:2000,body:{target:p.id,age:1,publicInterestAlert:true,axes:axes({intellectualImportance:5,democraticUrgency:5})}});
 const c=await rating(r,p.id,6,{time:500});
 const results=assessContentRatings([a,b,c],p.id,{
  trustAuthors:[r.author],rules:{...DEFAULT_RATING_RULES,active:true,blurVotes:1,hideVotes:2}
 });
 assert.equal(results.allSignedCount,1);
 assert.equal(results.high,0);
 assert.equal(results.ages[1],1);
 assert.equal(results.action,'clear');
 assert.equal(results.textFirst,false,'one urgent self-flag does not auto-promote a post');
 assert.equal(results.axes.intellectualImportance,5);
});
test('10 trusted high ratings versus 2 independently trusted low ratings prevent automatic censorship',async()=>{
 const publisher=await generateIdentity(),p=await post(publisher);
 const members=await Promise.all(Array.from({length:12},()=>generateIdentity()));
 const groupA='sha256:'+'a'.repeat(64),groupB='sha256:'+'b'.repeat(64);
 const records=[];
 for(let n=0;n<12;n++)records.push(await rating(members[n],p.id,n<10?3:1,{
  group:n<10?groupA:groupB,
  axes:{controversy:5,democraticUrgency:5,intellectualImportance:4,spamLikelihood:0}
 }));
 const trustedGroups=new Map([
  [groupA,new Set(members.slice(0,10).map(x=>x.author))],
  [groupB,new Set(members.slice(10).map(x=>x.author))]
 ]);
 const rules={...DEFAULT_RATING_RULES,active:true};
 const result=assessContentRatings(records,p.id,{rules,
  subscribedGroups:[groupA,groupB],verifiedGroupReviewers:trustedGroups});
 assert.equal(result.qualifiedCount,12);
 assert.equal(result.high,10);
 assert.equal(result.low,2);
 assert.equal(result.disputed,true);
 assert.equal(result.action,'clear');
 assert.equal(result.axes.democraticUrgency,5);
 assert.deepEqual({...result.groupCounts},{[groupA]:10,[groupB]:2});
 assert.equal(result.groupComparisons[groupA].ageMedian,3);
 assert.equal(result.groupComparisons[groupB].ageMedian,1);
 assert.equal(result.groupComparisons[groupA].count,10);
 assert.equal(result.groupComparisons[groupB].count,2);
 const oneSide=assessContentRatings(records,p.id,{rules,
  subscribedGroups:[groupA],verifiedGroupReviewers:trustedGroups});
 assert.equal(oneSide.qualifiedCount,10);
 assert.equal(oneSide.disputed,false);
 assert.equal(oneSide.action,'hide');
 const onlyOneDissent=assessContentRatings(records,p.id,{rules:{...rules,dissentVotes:3},
  subscribedGroups:[groupA,groupB],verifiedGroupReviewers:trustedGroups});
 assert.equal(onlyOneDissent.action,'hide');
 assert.equal(assessContentRatings(records,p.id,{rules,
  subscribedGroups:[groupA,groupB],verifiedGroupReviewers:new Map()}).action,'clear',
  'group claims alone never grant author or moderator authority');
});
test('thresholds are reader-versioned, locally adjustable, with no silent automatic policy changes',()=>{
 const defaultRules=normalizeRatingRules();
 assert.equal(defaultRules.active,false);
 assert.equal(defaultRules.blurVotes,2);
 assert.equal(defaultRules.hideVotes,5);
 assert.equal(defaultRules.dissentVotes,2);
 assert.throws(()=>normalizeRatingRules({...defaultRules,blurVotes:6,hideVotes:4}),/threshold/);
 assert.throws(()=>normalizeRatingRules({...defaultRules,sourceMode:'untrusted-anyone'}),/threshold/);
 assert.throws(()=>normalizeRatingRules({...defaultRules,version:2}),/version/);
 assert.throws(()=>normalizeRatingRules({...defaultRules,secretBackdoor:1}),/threshold/);
 const custom=normalizeRatingRules({...defaultRules,active:true,blurVotes:3,hideVotes:8});
 assert.deepEqual(normalizeRatingRules(JSON.parse(JSON.stringify(custom))),custom);
});
test('separate group distrust and reviewer misconduct remain signed opinion/evidence, not authority',async()=>{
 const founder=await generateIdentity(),observer=await generateIdentity();
 const charter=await signEvent(founder,{kind:'group',space:'groups',
  body:{name:'An independent organization',quorum:{numerator:1,denominator:2}}});
 const ratingGroup=await signEvent(observer,{kind:'group-rating',space:'groups',
  body:{group:charter.id,value:-2,reason:'Repeated unreviewed flag campaigns'}});
 const review=await signEvent(observer,{kind:'reviewer-conduct',space:'groups',
  body:{group:charter.id,reviewer:founder.author,value:-1,
   reason:'This individual claimed reviewer authority without evidence',
   evidence:ratingGroup.id}});
 const self=await signEvent(founder,{kind:'reviewer-candidacy',space:'groups',
  body:{group:charter.id,action:'volunteer',reason:'Available to review spam claims'}});
 for(const item of [ratingGroup,review,self])assert.equal(await verifyEvent(item),true);
 await assert.rejects(signEvent(observer,{kind:'group-rating',
  body:{group:charter.id,value:500,reason:'fake'}}),/group reputation/);
 await assert.rejects(signEvent(observer,{kind:'reviewer-conduct',
  body:{group:charter.id,reviewer:founder.author,value:-1,reason:'ok',
   invalidates:ratingGroup.id}}),/reviewer conduct/);
 // Group formation and membership/vote rights are unaffected by these
 // signed personal opinions or self-nominations.
 assert.equal(self.payload.kind,'reviewer-candidacy');
 assert.equal(self.payload.author,founder.author);
});
