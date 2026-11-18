import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent,canonical} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {decide,resolveReviewers,DEFAULT_POLICY} from '../core/policy.js';
test('canonical objects stable',()=>assert.equal(canonical({z:1,a:{z:true,a:false}}),'{"a":{"a":false,"z":true},"z":1}'));
test('any identity can publish into any namespace, with no owner ACL',async()=>{
  const a=await generateIdentity(), b=await generateIdentity(), replica=new Replica();
  const first=await signEvent(a,{space:'another-persons-board',body:{title:'hello',text:'hello'}});
  const second=await signEvent(b,{space:'another-persons-board',body:{title:'different',text:'yes'}});
  assert.deepEqual(await replica.ingest(first),{accepted:true,duplicate:false});
  assert.equal((await replica.ingest(second)).accepted,true);
  assert.equal(replica.size,2);
  assert.equal(await verifyEvent({...first,payload:{...first.payload,body:{title:'spoofed',text:'hello'}}}),false);
  assert.equal((await replica.ingest({...first,signature:'garbage'})).accepted,false);
});
test('flags can hide for one policy without deleting anything',async()=>{
  const a=await generateIdentity(), reviewer=await generateIdentity(), replica=new Replica();
  const post=await signEvent(a,{body:{title:'test',text:'whatever'}});
  const label=await signEvent(reviewer,{kind:'label',body:{target:post.id,tag:'spam',reason:'flood'}});
  await replica.ingest(post);await replica.ingest(label);
  const allow={...DEFAULT_POLICY,showUnknown:true};
  const hide={...allow,reviewerWeights:{[reviewer.author]:1}};
  assert.equal(decide(post,replica.list(),allow).visible,true);
  assert.equal(decide(post,replica.list(),hide).visible,false);
  assert.ok(replica.get(post.id));
});
test('group delegation uses max reviewer weight and terminates cycles',async()=>{
  const r=await generateIdentity();
  const p={...DEFAULT_POLICY,subscriptions:['guild'],groups:{
    guild:{reviewers:{[r.author]:2},inherits:['federation']},
    federation:{reviewers:{[r.author]:9},inherits:['guild']}
  }};
  assert.equal(resolveReviewers(p).get(r.author),9);
});
test('a space-owner preference is only a local optional view',async()=>{
  const a=await generateIdentity(), b=await generateIdentity();
  const event=await signEvent(a,{space:'claimed-space',body:{title:'a',text:'b'}});
  const base={...DEFAULT_POLICY,followedSpaces:['claimed-space']};
  assert.equal(decide(event,[event],base).visible,true);
  assert.equal(decide(event,[event],{...base,ownerPreference:{'claimed-space':b.author}}).visible,false);
});
test('custom fields, no built-in post types',async()=>{
  const a=await generateIdentity();
  const e=await signEvent(a,{body:{title:'Offer',text:'Looking for participants',fields:{price:{currency:'USD',amount:12},event:{start:'2030-01-01'}}}});
  assert.equal(await verifyEvent(e),true);
});
