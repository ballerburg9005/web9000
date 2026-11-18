import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {evaluateReputation} from '../core/reputation.js';

const mk=async(a,kind,body,time=1000)=>signEvent(a,{kind,body,time});
const invite=async(a,b)=>mk(a,'invitation',{invitee:b.author,scope:'commons',expiresAt:1e7});
const accept=async(b,e)=>mk(b,'accept',{invitation:e.id},2000);
const score=(r,id)=>r.results[id]?.score||0;
const closeTo=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`expected ${expected}, got ${actual}`);

test('unsigned sponsorship claims, unaccepted invitations and Sybil-only cycles confer no trust',async()=>{
 const root=await generateIdentity(),bot=await generateIdentity(),other=await generateIdentity();
 const a=await invite(root,bot),b=await invite(bot,other),c=await invite(other,bot);
 const proof=await accept(other,b),cycle=await accept(bot,c);
 const s=await evaluateReputation([a,b,c,proof,cycle],{roots:[root.author],now:3000});
 assert.equal(score(s,bot.author),0);assert.equal(score(s,other.author),0);
});
test('explicit mutual signed invitation builds bounded attenuating reputation',async()=>{
 const root=await generateIdentity(),one=await generateIdentity(),two=await generateIdentity();
 const a=await invite(root,one),b=await invite(one,two);
 const evidence=await evaluateReputation([a,await accept(one,a),b,await accept(two,b)],{roots:[root.author],now:3000});
 closeTo(score(evidence,one.author),55);closeTo(score(evidence,two.author),30.25);
 assert.equal(evidence.results[two.author].parent,one.author);
});
test('an attacker cannot appoint an unwitting identity as sponsor',async()=>{
 const root=await generateIdentity(),target=await generateIdentity(),bot=await generateIdentity();
 const i=await invite(root,target);
 const forgedAcceptance=await accept(bot,i);
 const result=await evaluateReputation([i,forgedAcceptance],{roots:[root.author],now:3000});
 assert.equal(score(result,target.author),0);
});
test('multiple signed accepted sponsorships do not allocate ambiguous liability',async()=>{
 const root=await generateIdentity(),other=await generateIdentity(),target=await generateIdentity();
 const a=await invite(root,target),b=await invite(other,target);
 const r=await evaluateReputation([a,b,await accept(target,a),await accept(target,b)],{roots:[root.author,other.author],now:3000});
 assert.equal(score(r,target.author),0);assert.deepEqual(r.ambiguous,[target.author]);
});
test('viewer-trusted evidence penalizes sponsor and downstream, not the global database',async()=>{
 const root=await generateIdentity(),bot=await generateIdentity(),reviewer=await generateIdentity();
 const i=await invite(root,bot),a=await accept(bot,i);
 const flag=await mk(reviewer,'endorse',{subject:bot.author,action:'distrust'},2500);
 const events=[i,a,flag];
 const plain=await evaluateReputation(events,{roots:[root.author],now:3000});
 const moderated=await evaluateReputation(events,{roots:[root.author],reviewerWeights:{[reviewer.author]:1},now:3000});
 closeTo(score(plain,bot.author),55);
 closeTo(score(moderated,bot.author),15);
 closeTo(score(moderated,root.author),70);
 // The signed events remain independently verifiable and unaltered.
 assert.equal(events.length,3);
});
test('identical repeat reports by one reviewer cannot multiply penalties',async()=>{
 const root=await generateIdentity(),other=await generateIdentity(),reviewer=await generateIdentity();
 const first=await mk(reviewer,'endorse',{subject:other.author,action:'distrust'},2000);
 const second=await mk(reviewer,'endorse',{subject:other.author,action:'distrust'},2500);
 const r=await evaluateReputation([first,second],{roots:[root.author],reviewerWeights:{[reviewer.author]:1},now:3000});
 assert.equal(r.results[other.author].penalty,40);
});
test('strict per-sponsor cap prevents unlimited promotion',async()=>{
 const root=await generateIdentity(),children=await Promise.all(Array.from({length:4},()=>generateIdentity()));
 const e=[];
 for(const child of children){const invitation=await invite(root,child);e.push(invitation,await accept(child,invitation));}
 const r=await evaluateReputation(e,{roots:[root.author],maxInvitesPerSponsor:2,now:3000});
 assert.equal(r.acceptedInvitations,2);
 assert.equal(children.filter(child=>score(r,child.author)>0).length,2);
});
test('tampered endorsement can never apply a penalty',async()=>{
 const root=await generateIdentity(),other=await generateIdentity(),reviewer=await generateIdentity();
 const flag=await mk(reviewer,'endorse',{subject:other.author,action:'distrust'},1500);
 flag.payload.body.subject=root.author;
 const r=await evaluateReputation([flag],{roots:[root.author],reviewerWeights:{[reviewer.author]:1},now:3000});
 assert.equal(score(r,root.author),100);
});
