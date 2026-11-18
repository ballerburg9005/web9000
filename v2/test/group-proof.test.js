import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {deriveGroup} from '../core/governance.js';
import {createGroupProof,verifyGroupProof} from '../core/group-proof.js';

const sign=(identity,kind,body)=>signEvent(identity,{kind,space:'groups',body});
const proposal=(identity,group,parent,change)=>sign(identity,'proposal',{group,parent,change});
const ballot=(identity,target,choice='approve')=>sign(identity,'vote',{proposal:target,choice});
const info=(name,description,spaces=['commons'])=>({
  type:'set-group-info',name,description,recommendedSpaces:spaces
});

test('two of three independently signed members certify updated group information',async()=>{
 const [a,b,c,outsider]=await Promise.all(Array.from({length:4},()=>generateIdentity()));
 const charter=await sign(a,'group',{name:'Old name',description:'Founder initially',
  quorum:{numerator:2,denominator:3},recommendedSpaces:['old']});
 const addB=await proposal(a,charter.id,charter.id,{type:'add-member',author:b.author});
 const voteAddB=await ballot(a,addB.id);
 const addC=await proposal(a,charter.id,addB.id,{type:'add-member',author:c.author});
 const votesAddC=[await ballot(a,addC.id),await ballot(b,addC.id)];
 const update=await proposal(c,charter.id,addC.id,info('Cooperative','Ratified public description',['activism','ideas']));
 const voteByA=await ballot(a,update.id),voteByB=await ballot(b,update.id);
 const outsiderVote=await ballot(outsider,update.id);
 const foundation=[charter,addB,voteAddB,addC,...votesAddC,update,outsiderVote,voteByA];
 let derived=await deriveGroup(foundation,charter.id);
 assert.equal(derived.state.name,'Old name','single signer does not change metadata at 2-of-3 quorum');
 assert.equal(derived.pending.some(x=>x.id===update.id),true);
 derived=await deriveGroup([...foundation,voteByB],charter.id);
 assert.equal(derived.state.name,'Cooperative');
 assert.equal(derived.state.description,'Ratified public description');
 assert.deepEqual(derived.state.recommendedSpaces,['activism','ideas']);
 const certificate=derived.ratifications.find(x=>x.proposal===update.id);
 assert.equal(certificate.required,2);
 assert.equal(certificate.approved,2);
 assert.equal(certificate.eligibleMembers.length,3);
 assert.deepEqual(certificate.approvals.map(x=>x.author).sort(),[a.author,b.author].sort());
 assert.ok(certificate.approvals.every(x=>x.signature&&x.eventId));
 assert.equal(derived.state.infoRevision,update.id);
 const bundle=await createGroupProof([...foundation,voteByB],charter.id);
 const verified=await verifyGroupProof(JSON.parse(JSON.stringify(bundle)));
 assert.equal(verified.valid,true,JSON.stringify(verified));
 assert.deepEqual(verified.information,{
   name:'Cooperative',description:'Ratified public description',
   recommendedSpaces:['activism','ideas'],revision:update.id
 });
 assert.equal(verified.foundingSigner,a.author);
 assert.equal(verified.ratifications.length,3);
 assert.ok(bundle.events.length>=7);
 // Offline verification must not require access to a live node, key store,
 // official domain or any group's preferred index.
 const missing=JSON.parse(JSON.stringify(bundle));
 missing.events=missing.events.filter(e=>e.id!==voteByA.id);
 assert.equal((await verifyGroupProof(missing)).valid,false);
 const duplicate=JSON.parse(JSON.stringify(bundle));
 duplicate.events.push(JSON.parse(JSON.stringify(duplicate.events[0])));
 assert.equal((await verifyGroupProof(duplicate)).valid,false,
   'duplicates must not weaken offline proof validation');
 const forged=JSON.parse(JSON.stringify(bundle));
 forged.events.find(e=>e.id===voteByB.id).signature='not-real';
 assert.equal((await verifyGroupProof(forged)).valid,false);
 const rewrite=JSON.parse(JSON.stringify(bundle));
 rewrite.events.find(e=>e.id===update.id).payload.body.change.name='Forged community';
 assert.equal((await verifyGroupProof(rewrite)).valid,false);
});

test('branch proofs cannot claim another group, a missing quorum or an unratified fork',async()=>{
 const founder=await generateIdentity(),member=await generateIdentity();
 const charter=await sign(founder,'group',{name:'Original',description:'',quorum:{numerator:1,denominator:1}});
 const pending=await proposal(founder,charter.id,charter.id,info('Unapproved','Not an official statement'));
 await assert.rejects(createGroupProof([charter,pending],charter.id,{head:pending.id}),/ratified/);
 const original=await createGroupProof([charter,pending],charter.id);
 assert.equal((await verifyGroupProof(original)).valid,true);
 const approval=await ballot(founder,pending.id);
 const accepted=await createGroupProof([charter,pending,approval],charter.id);
 assert.equal((await verifyGroupProof({...accepted,groupId:'sha256:'+'0'.repeat(64)})).valid,false);
 assert.equal((await verifyGroupProof({...accepted,head:charter.id})).valid,true,
   'author may independently choose historical founding charter rather than newer info');
 assert.equal((await verifyGroupProof(accepted)).valid,true);
 const fork=await proposal(founder,charter.id,charter.id,info('Conflicting story','Alternative branch'));
 const otherVote=await ballot(founder,fork.id);
 await assert.rejects(createGroupProof([charter,pending,approval,fork,otherVote],charter.id),
  /Choose a governance branch/);
 const selected=await createGroupProof([charter,pending,approval,fork,otherVote],charter.id,{head:fork.id});
 assert.equal((await verifyGroupProof(selected)).valid,true);
 assert.equal((await verifyGroupProof(selected)).information.name,'Conflicting story');
 assert.notEqual((await verifyGroupProof(selected)).information.name,
  (await verifyGroupProof(accepted)).information.name);
 // Membership and unrelated second signers cannot be smuggled into quorum.
 const stranger=await ballot(member,fork.id);
 const result=await deriveGroup([charter,fork,stranger],charter.id);
 assert.equal(result.state.name,'Original');
});
test('invalid group info amendments cannot be signed at all',async()=>{
 const a=await generateIdentity(),group='sha256:'+'0'.repeat(64);
 for(const change of [
  {...info('','empty')}, {...info('a'.repeat(81),'oversize')},
  {...info('okay','x'.repeat(2001))}, {...info('okay','good'),recommendedSpaces:['x','x']},
  {...info('okay','good'),recommendedSpaces:['\n']},
  {...info('okay','good'),recommendedSpaces:Array(21).fill('x')}
 ])await assert.rejects(sign(a,'proposal',{group,parent:group,change}),/group information/);
});
