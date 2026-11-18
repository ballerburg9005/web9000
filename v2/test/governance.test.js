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
test('a conflicting approve+reject signer cannot count twice',async()=>{
  const founder=await generateIdentity(),reviewer=await generateIdentity(),gen=await charter(founder);
  const p=await proposal(founder,gen.id,gen.id,{type:'appoint-reviewer',author:reviewer.author,weight:1});
  const a=await vote(founder,p.id,'approve'),b=await vote(founder,p.id,'reject');
  const s=await deriveGroup([gen,p,a,b],gen.id);
  assert.equal(s.pending.length,1);assert.equal(s.state.reviewers[reviewer.author],undefined);
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
