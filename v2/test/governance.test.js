import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {deriveGroup,governancePolicy} from '../core/governance.js';
import {resolveReviewers,DEFAULT_POLICY} from '../core/policy.js';

const make=async(identity,kind,body,space='commons')=>signEvent(identity,{kind,body,space});
const charter=async(author,quorum={numerator:2,denominator:3})=>make(author,'group',{name:'Independent guild',quorum});
const proposal=async(author,group,parent,change)=>make(author,'proposal',{group,parent,change});
const vote=async(author,target,choice='approve')=>make(author,'vote',{proposal:target,choice});

test('group starts with its signer, a name is not a global authority',async()=>{
  const founder=await generateIdentity(),gen=await charter(founder);
  const s=await deriveGroup([gen],gen.id);
  assert.equal(s.found,true);assert.deepEqual(s.state.members,[founder.author]);
  assert.deepEqual(s.heads,[gen.id]);
});
test('only threshold-backed signed membership amendments change group voting rights',async()=>{
  const a=await generateIdentity(),b=await generateIdentity(),c=await generateIdentity();
  const gen=await charter(a),p=await proposal(a,gen.id,gen.id,{type:'add-member',author:b.author});
  let s=await deriveGroup([gen,p],gen.id);
  assert.deepEqual(s.state.members,[a.author]);assert.equal(s.pending.length,1);
  const v=await vote(a,p.id);s=await deriveGroup([gen,p,v],gen.id);
  assert.deepEqual(s.state.members,[a.author,b.author].sort());
  const p2=await proposal(b,gen.id,p.id,{type:'add-member',author:c.author});
  const bvote=await vote(b,p2.id);
  s=await deriveGroup([gen,p,v,p2,bvote],gen.id);
  assert.equal(s.pending.length,1);assert.equal(s.state.members.includes(c.author),false);
  const avote=await vote(a,p2.id);
  s=await deriveGroup([gen,p,v,p2,bvote,avote],gen.id);
  assert.equal(s.state.members.includes(c.author),true);
});
test('self-serving outsider proposals cannot become group policy',async()=>{
  const founder=await generateIdentity(),stranger=await generateIdentity(),gen=await charter(founder);
  const p=await proposal(stranger,gen.id,gen.id,{type:'appoint-reviewer',author:stranger.author,weight:100});
  const ballot=await vote(founder,p.id);
  const s=await deriveGroup([gen,p,ballot],gen.id);
  assert.equal(s.state.reviewers[stranger.author],undefined);assert.equal(s.pending.length,1);
});
test('signed group reviewer weight is usable ONLY after opt-in and quorum',async()=>{
  const founder=await generateIdentity(),reviewer=await generateIdentity(),gen=await charter(founder);
  const p=await proposal(founder,gen.id,gen.id,{type:'appoint-reviewer',author:reviewer.author,weight:3});
  const accepted=await vote(founder,p.id);
  const {policy}=await governancePolicy([gen,p,accepted],DEFAULT_POLICY,[{id:gen.id}]);
  assert.equal(resolveReviewers(policy).get(reviewer.author),3);
  assert.equal(resolveReviewers(DEFAULT_POLICY).get(reviewer.author),undefined);
});
test('conflicting ratified branches are exposed, never resolved by invented global latest',async()=>{
  const founder=await generateIdentity(),x=await generateIdentity(),y=await generateIdentity(),gen=await charter(founder);
  const p1=await proposal(founder,gen.id,gen.id,{type:'appoint-reviewer',author:x.author,weight:2});
  const p2=await proposal(founder,gen.id,gen.id,{type:'appoint-reviewer',author:y.author,weight:3});
  const v1=await vote(founder,p1.id),v2=await vote(founder,p2.id);
  const events=[gen,p1,p2,v1,v2];
  const s=await deriveGroup(events,gen.id);
  assert.equal(s.ambiguous,true);assert.equal(s.state.head,gen.id);assert.equal(s.heads.length,2);
  assert.equal(s.forks.length,1);
  const fork=await deriveGroup(events,gen.id,{selectedHead:p2.id});
  assert.equal(fork.ambiguous,false);assert.equal(fork.state.reviewers[y.author],3);
  assert.equal(fork.state.reviewers[x.author],undefined);
});
test('rejection cannot retroactively un-ratify and equivocation does not add approvals',async()=>{
  const founder=await generateIdentity(),member=await generateIdentity(),reviewer=await generateIdentity(),gen=await charter(founder);
  const add=await proposal(founder,gen.id,gen.id,{type:'add-member',author:member.author});
  const ratified=await vote(founder,add.id);
  const p=await proposal(founder,gen.id,add.id,{type:'appoint-reviewer',author:reviewer.author,weight:1});
  const yes=await vote(founder,p.id,'approve'),no=await vote(founder,p.id,'reject');
  let s=await deriveGroup([gen,add,ratified,p,yes,no],gen.id);
  assert.equal(s.pending.length,1); // 1 of 2 members; one author cannot count twice
  const second=await vote(member,p.id);
  s=await deriveGroup([gen,add,ratified,p,yes,no,second],gen.id);
  assert.equal(s.state.reviewers[reviewer.author],1);
  assert.deepEqual(s.equivocations.find(x=>x.proposal===p.id).authors,[founder.author]);
  // The previous approval still counts, regardless of the later rejection.
  const withoutRejection=await deriveGroup([gen,add,ratified,p,yes,second],gen.id);
  assert.deepEqual(s.state.reviewers,withoutRejection.state.reviewers);
});
test('tampered votes and unknown parents do not grant any authority',async()=>{
  const founder=await generateIdentity(),reviewer=await generateIdentity(),gen=await charter(founder);
  const p=await proposal(founder,gen.id,'sha256:'+'0'.repeat(64),{type:'appoint-reviewer',author:reviewer.author,weight:1});
  const forged=await vote(founder,p.id);forged.payload.body.choice='approve-x';
  const s=await deriveGroup([gen,p,forged],gen.id);
  assert.deepEqual(s.state.reviewers,{});
});
test('different groups may grant conflicting authority independently',async()=>{
  const x=await generateIdentity(),y=await generateIdentity(),r=await generateIdentity();
  const gx=await charter(x),gy=await charter(y);
  const px=await proposal(x,gx.id,gx.id,{type:'appoint-reviewer',author:r.author,weight:1});
  const py=await proposal(y,gy.id,gy.id,{type:'appoint-reviewer',author:r.author,weight:9});
  const events=[gx,gy,px,py,await vote(x,px.id),await vote(y,py.id)];
  const a=await governancePolicy(events,DEFAULT_POLICY,[{id:gx.id}]);
  const b=await governancePolicy(events,DEFAULT_POLICY,[{id:gy.id}]);
  assert.equal(resolveReviewers(a.policy).get(r.author),1);
  assert.equal(resolveReviewers(b.policy).get(r.author),9);
});


test('timed advisory motions close after 7 days using participating voters, never change membership',async()=>{
 const t=Date.UTC(2026,10,1,10);
 const [a,b,c,d,e]=await Promise.all(Array.from({length:5},()=>generateIdentity()));
 const all=[a,b,c,d,e];
 const events=[];
 const sign=(author,kind,body,time=t)=>signEvent(author,{kind,space:'groups',body,time});
 const genesis=await sign(a,'group',{name:'Open Discussion Guild',
  quorum:{numerator:1,denominator:2},decisionPolicy:{mode:'timed-v1'}});
 events.push(genesis);
 let head=genesis.id;
 for(let i=1;i<all.length;i++){
   const p=await sign(a,'proposal',{group:genesis.id,parent:head,
     change:{type:'add-member',author:all[i].author}});
   events.push(p);
   const required=Math.ceil(i*2/3);
   for(const voter of all.slice(0,required))
     events.push(await sign(voter,'vote',{proposal:p.id,choice:'approve'},t+1000));
   head=p.id;
 }
 const status=await deriveGroup(events,genesis.id,{now:t+2000});
 assert.equal(status.state.members.length,5,'membership amendments meet 2/3 founder/member threshold');
 const motion=await sign(b,'proposal',{group:genesis.id,parent:head,
   change:{type:'resolution',title:'Try a public discussion project',
     text:'Nonbinding community preference; no administrative permissions'}},t+3000);
 const yes=await sign(a,'vote',{proposal:motion.id,choice:'approve'},t+4000);
 const yes2=await sign(b,'vote',{proposal:motion.id,choice:'approve'},t+5000);
 const after=[...events,motion,yes];
 const during=await deriveGroup(after,genesis.id,{now:t+DAY(3)});
 assert.equal(during.motions[0].status,'open');
 const tooFew=await deriveGroup(after,genesis.id,{now:t+DAY(8)});
 assert.equal(tooFew.motions[0].status,'insufficient-turnout',
   'no automatic passage for one of five registered members');
 const closed=await deriveGroup([...after,yes2],genesis.id,{now:t+DAY(8)});
 assert.equal(closed.motions[0].status,'supported');
 assert.equal(closed.motions[0].required,2);
 assert.equal(closed.motions[0].yes,2);
 assert.deepEqual(closed.state.members,status.state.members,
   'a timeboxed advisory vote cannot change charter authority');
 const change=await sign(b,'vote',{proposal:motion.id,choice:'reject'},t+DAY(4));
 const switched=await deriveGroup([...after,yes2,change],genesis.id,{now:t+DAY(8)});
 assert.equal(switched.motions[0].status,'rejected',
  'the latest signed participating ballot matters, not duplicate signer count');
 const late=await sign(c,'vote',{proposal:motion.id,choice:'approve'},t+DAY(8));
 const ignored=await deriveGroup([...after,yes2,change,late],genesis.id,{now:t+DAY(9)});
 assert.equal(ignored.motions[0].status,'rejected');
 function DAY(n){return n*86400000;}
});
test('timed charter authority cannot be captured by a low-turnout vote or mock karma',async()=>{
 const t=Date.UTC(2026,10,2,10),DAY=86400000;
 const [a,b,c,d]=await Promise.all(Array.from({length:4},()=>generateIdentity()));
 const sign=(author,kind,body,time=t)=>signEvent(author,{kind,space:'groups',body,time});
 const gen=await sign(a,'group',{name:'Protected',description:'Original',
   quorum:{numerator:1,denominator:2},decisionPolicy:{mode:'timed-v1'}});
 const addB=await sign(a,'proposal',{group:gen.id,parent:gen.id,
   change:{type:'add-member',author:b.author}});
 const addC=await sign(a,'proposal',{group:gen.id,parent:addB.id,
   change:{type:'add-member',author:c.author}});
 const addD=await sign(a,'proposal',{group:gen.id,parent:addC.id,
   change:{type:'add-member',author:d.author}});
 const before=[gen,addB,await sign(a,'vote',{proposal:addB.id,choice:'approve'}),
   addC,await sign(a,'vote',{proposal:addC.id,choice:'approve'}),
   await sign(b,'vote',{proposal:addC.id,choice:'approve'}),
   addD,...await Promise.all([a,b].map(x=>sign(x,'vote',{proposal:addD.id,choice:'approve'})))];
 const third=await sign(c,'vote',{proposal:addD.id,choice:'approve'});
 const events=[...before,third];
 const base=await deriveGroup(events,gen.id,{now:t+2000});
 assert.equal(base.state.members.length,4);
 const info=await sign(a,'proposal',{group:gen.id,parent:addD.id,
   change:{type:'set-group-info',name:'Claimed group',description:'Capture attempt',
     recommendedSpaces:['attacker']}},t+3000);
 const onlyA=await sign(a,'vote',{proposal:info.id,choice:'approve'},t+4000);
 let result=await deriveGroup([...events,info,onlyA],gen.id,{now:t+8*DAY});
 assert.equal(result.state.name,'Protected','one active member cannot overwrite group information');
 const onlyB=await sign(b,'vote',{proposal:info.id,choice:'approve'},t+5000);
 result=await deriveGroup([...events,info,onlyA,onlyB],gen.id,{now:t+8*DAY});
 assert.equal(result.state.name,'Protected',
   'legacy-configured 1/2 quorum is still stricter than a timed absolute majority');
 const thirdInfo=await sign(c,'vote',{proposal:info.id,choice:'approve'},t+6000);
 result=await deriveGroup([...events,info,onlyA,onlyB,thirdInfo],gen.id,{now:t+8*DAY});
 assert.equal(result.state.name,'Claimed group');
 assert.equal(result.ratifications.find(x=>x.proposal===info.id).required,3);
 const afterDeadline=await sign(d,'vote',{proposal:info.id,choice:'approve'},t+8*DAY);
 result=await deriveGroup([...events,info,onlyA,onlyB,afterDeadline],gen.id,{now:t+9*DAY});
 assert.equal(result.state.name,'Protected','late signatures cannot bypass a timed amendment window');
 const promotion=await sign(a,'proposal',{group:gen.id,parent:addD.id,
   change:{type:'set-quorum',numerator:1,denominator:100}},t+10000);
 const attempts=[await sign(a,'vote',{proposal:promotion.id,choice:'approve'},t+11000),
   await sign(b,'vote',{proposal:promotion.id,choice:'approve'},t+12000)];
 result=await deriveGroup([...events,promotion,...attempts],gen.id,{now:t+15*DAY});
 assert.equal(result.state.quorum.numerator,1);
 assert.equal(result.state.quorum.denominator,2,
  '2 of 4 cannot cut constitutional quorum even if they are the only active members');
 assert.equal(result.pending.find(x=>x.id===promotion.id).reason,
   'expired without required member signatures');
});
