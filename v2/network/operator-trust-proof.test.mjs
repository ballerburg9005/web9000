import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {createGroupProof} from '../core/group-proof.js';
import {
  validateOperatorTrustPolicy,verifyOperatorTrustEvidence,issueVerifiedTrustCapability
} from './operator-trust-proof.mjs';
import {verifyIngressCapability} from './ingress-capability.mjs';

const mk=(who,kind,body,time=1000)=>signEvent(who,{kind,space:'commons',body,time});
const policy=(root,extra={})=>({
 roots:[root.author],scope:'commons',minInviteScore:30,ttlMs:30000,
 groupPins:[],...extra
});
test('mutually signed opt-in invitation path yields operator-local sponsored credential but never global trust',async()=>{
 const operator=await generateIdentity(),root=await generateIdentity(),
   invitee=await generateIdentity(),unrelated=await generateIdentity();
 const invitation=await mk(root,'invitation',{
   invitee:invitee.author,scope:'commons',expiresAt:5000
 });
 const acceptance=await mk(invitee,'accept',{
   invitation:invitation.id
 },2000);
 const p=policy(root);
 const qualified=await issueVerifiedTrustCapability({
   signer:operator,policy:p,subject:invitee.author,
   evidence:{kind:'bilateral-invitation',events:[invitation,acceptance]},now:3000
 });
 assert.equal(qualified.qualified,true,JSON.stringify(qualified));
 assert.equal(qualified.className,'sponsored');
 assert.ok(Math.abs(qualified.score-55)<1e-9);
 assert.equal(qualified.depth,1);
 assert.equal((await verifyIngressCapability(qualified.credential,{
   expectedIssuer:operator.author,now:3000,subject:invitee.author,
   className:'sponsored'
 })).valid,true);
 assert.equal((await verifyIngressCapability(qualified.credential,{
   expectedIssuer:operator.author,now:40000
 })).valid,false,'operator grant expires independently of signed invitation');
 const rejectEvidence=[
   {kind:'bilateral-invitation',events:[invitation]},
   {kind:'bilateral-invitation',events:[invitation,await mk(unrelated,'accept',{invitation:invitation.id},2000)]},
   {kind:'bilateral-invitation',events:[{...invitation,payload:{...invitation.payload,body:{...invitation.payload.body,scope:'other'}}},acceptance]},
   {kind:'bilateral-invitation',events:[invitation,acceptance,acceptance]},
   {kind:'claim-my-stake',wallet:'0x12345678',balance:1e9}
 ];
 for(const evidence of rejectEvidence){
   const response=await issueVerifiedTrustCapability({
     signer:operator,policy:p,subject:invitee.author,evidence,now:3000
   });
   assert.equal(response.qualified,false,JSON.stringify(response));
   assert.equal(response.credential,null);
 }
 const unrelatedPolicy=policy(unrelated);
 assert.equal((await verifyOperatorTrustEvidence({
   policy:unrelatedPolicy,subject:invitee.author,
   evidence:{kind:'bilateral-invitation',events:[invitation,acceptance]},now:3000
 })).qualified,false,'only operator-approved root legitimizes invitation chain');
 const afterExpiry=await verifyOperatorTrustEvidence({
   policy:p,subject:invitee.author,
   evidence:{kind:'bilateral-invitation',events:[invitation,acceptance]},now:8000
 });
 assert.equal(afterExpiry.qualified,true,'timely accepted invite persists after expiry');
 const lateAcceptance=await mk(invitee,'accept',{invitation:invitation.id},8000);
 assert.equal((await verifyOperatorTrustEvidence({
   policy:p,subject:invitee.author,
   evidence:{kind:'bilateral-invitation',events:[invitation,lateAcceptance]},now:9000
 })).qualified,false,'late acceptance cannot bootstrap');
});
test('operator pinned ratified signed group branch grants only voting members established access',async()=>{
 const operator=await generateIdentity(),founder=await generateIdentity(),
   member=await generateIdentity(),outsider=await generateIdentity();
 const charter=await mk(founder,'group',{
   name:'Voluntary space',description:'',
   quorum:{numerator:1,denominator:1}
 },1000);
 const propose=await mk(founder,'proposal',{group:charter.id,parent:charter.id,
   change:{type:'add-member',author:member.author}},1500);
 const vote=await mk(founder,'vote',{proposal:propose.id,choice:'approve'},1900);
 const bundle=await createGroupProof([charter,propose,vote],charter.id,{head:propose.id});
 const p=policy(founder,{roots:[],groupPins:[{
   groupId:charter.id,head:propose.id
 }]});
 const yes=await issueVerifiedTrustCapability({
   signer:operator,policy:p,subject:member.author,
   evidence:{kind:'pinned-group-membership',bundle},now:3000
 });
 assert.equal(yes.qualified,true,JSON.stringify(yes));
 assert.equal(yes.className,'established');
 assert.equal(yes.groupId,charter.id);
 assert.equal((await verifyIngressCapability(yes.credential,{
   expectedIssuer:operator.author,subject:member.author,
   className:'established',now:3100
 })).valid,true);
 const unauthorized=await verifyOperatorTrustEvidence({
   policy:p,subject:outsider.author,
   evidence:{kind:'pinned-group-membership',bundle},now:3000
 });
 assert.equal(unauthorized.qualified,false);
 const wrongBranch=policy(founder,{roots:[],groupPins:[{
   groupId:charter.id,head:charter.id
 }]});
 assert.equal((await verifyOperatorTrustEvidence({
   policy:wrongBranch,subject:member.author,
   evidence:{kind:'pinned-group-membership',bundle},now:3000
 })).qualified,false,'group branch must be explicitly pinned by local operator');
 const forged=structuredClone(bundle);
 forged.events.find(e=>e.id===vote.id).signature='not-signed';
 assert.equal((await verifyOperatorTrustEvidence({
   policy:p,subject:member.author,
   evidence:{kind:'pinned-group-membership',bundle:forged},now:3000
 })).qualified,false,'unsigned/unratified endorsements never confer a group tier');
 assert.equal((await verifyOperatorTrustEvidence({
   policy:p,subject:member.author,evidence:{kind:'stake-wallet-balance',
     wallet:'0x000',balance:100000},now:3000
 })).qualified,false);
});
test('malicious policies, oversized proofs, guessed roots and future-dated evidence fail closed',async()=>{
 const root=await generateIdentity(),outsider=await generateIdentity();
 for(const p of [
   {roots:[],scope:'commons',groupPins:[{groupId:'bad',head:'bad'}]},
   {roots:[root.author,root.author],scope:'commons'},
   {roots:[outsider.author],scope:''},
   {roots:[],scope:'commons',minInviteScore:-1},
   {roots:[],scope:'commons',ttlMs:300001},
   {roots:[],scope:'commons',groupPins:[],className:'established'}
 ])assert.throws(()=>validateOperatorTrustPolicy(p));
 const i=await mk(root,'invitation',{
   invitee:outsider.author,scope:'commons'
 },900000);
 const a=await mk(outsider,'accept',{invitation:i.id},900001);
 assert.equal((await verifyOperatorTrustEvidence({
   policy:policy(root),subject:outsider.author,
   evidence:{kind:'bilateral-invitation',events:[i,a]},now:800000
 })).qualified,false);
 assert.equal((await verifyOperatorTrustEvidence({
   policy:policy(root),subject:outsider.author,
   evidence:{kind:'bilateral-invitation',
     events:Array.from({length:37},(_,idx)=>({...i,id:i.id+idx}))},
   now:900002
 })).qualified,false);
});
