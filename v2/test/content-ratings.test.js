import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {AGE_TIERS,RATING_AXES,DEFAULT_RATING_RULES,normalizeRatingRules,
 assessContentRatings,summarizeSpiderBackground} from '../core/content-ratings.js';

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


test('public-interest alert in Report is a signed label, not an unintended all-ages/spider rating',async()=>{
 const publisher=await generateIdentity(),a=await generateIdentity(),
  b=await generateIdentity(),subject=await post(publisher);
 const alert=await signEvent(a,{kind:'label',body:{
  target:subject.id,tag:'public-interest-censorship-pressure',
  reason:'Detailed public-interest reporting faces active censorship pressure'}});
 assert.equal(await verifyEvent(alert),true);
 const onlyAlert=assessContentRatings([alert],subject.id,{
  trustAuthors:[a.author],rules:{...DEFAULT_RATING_RULES,active:true,blurVotes:1,hideVotes:2}
 });
 assert.equal(onlyAlert.publicInterestAlerts,1);
 assert.equal(onlyAlert.allSignedCount,0);
 assert.equal(onlyAlert.qualifiedCount,0);
 assert.equal(onlyAlert.ages.reduce((a,b)=>a+b,0),0);
 assert.equal(onlyAlert.action,'clear');
 const rich=await rating(a,subject.id,3,{
  axes:{democraticUrgency:5,intellectualImportance:4}});
 const alert2=await signEvent(b,{kind:'label',body:{
  target:subject.id,tag:'public-interest-censorship-pressure',
  reason:'Relevant independent evidence of public-interest urgency'}});
 const combined=assessContentRatings([alert,alert2,rich],subject.id,{
  trustAuthors:[a.author,b.author]});
 assert.equal(combined.publicInterestAlerts,2,'one author cannot inflate alerts by also rating');
 assert.equal(combined.qualifiedCount,1,'alert-only signer has no age classification');
 assert.equal(combined.textFirst,true);
 const untrusted=assessContentRatings([alert,alert2,rich],subject.id,{
  trustAuthors:[a.author]});
 assert.equal(untrusted.publicInterestAlerts,1);
 assert.equal(untrusted.textFirst,false,'one trusted alert cannot force democratic promotion');
});


test('spider background summarizes ALL OTHER signed authors, even untrusted, without hiding authority',async()=>{
 const owner=await generateIdentity(),foreign=await generateIdentity(),third=await generateIdentity();
 const subject=await post(owner),unrelated=await post(third);
 const own=await rating(owner,subject.id,1,{time:1000,axes:{controversy:0,democraticUrgency:0}});
 const a=await rating(foreign,subject.id,4,{time:1000,axes:{controversy:5,democraticUrgency:4}});
 const latest=await rating(foreign,subject.id,6,{time:1002,axes:{
   controversy:3,democraticUrgency:2,intellectualImportance:5,spamLikelihood:0}});
 const earlier=await rating(third,subject.id,2,{time:1001,axes:{
   controversy:1,democraticUrgency:4,intellectualImportance:3,spamLikelihood:4}});
 const otherPost=await rating(third,unrelated.id,5,{time:1000});
 const records=[own,a,latest,earlier,otherPost];
 const summary=summarizeSpiderBackground(records,subject.id,{viewerAuthor:owner.author});
 assert.equal(summary.count,2,'one other signer is one vote, latest event wins');
 assert.equal(summary.scope,'all-signed');
 assert.deepEqual(summary.signerIds.sort(),[foreign.author,third.author].sort());
 assert.equal(summary.age,4,'median of 6 and 2, owner age 1 excluded');
 assert.deepEqual(summary.axes,{controversy:2,democraticUrgency:3,
   intellectualImportance:4,spamLikelihood:2});
 assert.equal(summary.informationalOnly,true);
 const decision=assessContentRatings(records,subject.id,{
   selfAuthor:owner.author,rules:{...DEFAULT_RATING_RULES,active:true,blurVotes:1,hideVotes:2}});
 assert.equal(decision.qualifiedCount,1,'untrusted other ratings cannot hide content');
 assert.equal(decision.action,'clear','other-rater background has no enforcement power');
 const sameOtherViewer=summarizeSpiderBackground(records,subject.id,{viewerAuthor:foreign.author});
 assert.equal(sameOtherViewer.count,2);
 assert.equal(sameOtherViewer.age,1.5,'excluded identity changes with browser');
});
test('future federation view accepts only preverified signer keys, never a claimed group',async()=>{
 const publisher=await generateIdentity(),a=await generateIdentity(),b=await generateIdentity();
 const group='sha256:'+'d'.repeat(64),p=await post(publisher);
 const accepted=await rating(a,p.id,4,{group,time:1000});
 const outsider=await rating(b,p.id,6,{group,time:1001});
 const records=[accepted,outsider];
 assert.equal(summarizeSpiderBackground(records,p.id,{
   viewerAuthor:publisher.author}).count,2,'default is everyone signed, independent of group claim');
 const restricted=summarizeSpiderBackground(records,p.id,{
   viewerAuthor:publisher.author,mode:'approved-authors',approvedAuthors:[a.author]});
 assert.equal(restricted.count,1);
 assert.equal(restricted.age,4);
 assert.equal(summarizeSpiderBackground(records,p.id,{
   viewerAuthor:publisher.author,mode:'approved-authors',approvedAuthors:[]}).count,0);
 assert.throws(()=>summarizeSpiderBackground(records,p.id,{mode:'federation-by-label'}),
   /scope/);
});
