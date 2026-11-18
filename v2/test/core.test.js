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

test('repeat reports by the same reviewer do not inflate moderation weight',async()=>{
  const author=await generateIdentity(),reviewer=await generateIdentity();
  const post=await signEvent(author,{body:{title:'test',text:'text'}});
  const labels=[];
  for(let n=0;n<6;n++)labels.push(await signEvent(reviewer,{kind:'label',body:{target:post.id,tag:'spam',reason:'repeat'}}));
  const p={...DEFAULT_POLICY,reviewerWeights:{[reviewer.author]:1},minLabelWeight:2};
  assert.equal(decide(post,[post,...labels],p).visible,true);
});

test('a claimed dictator view can hide even trusted outsiders, never revoke their posts',async()=>{
 const siteOwner=await generateIdentity(),other=await generateIdentity(),post=await signEvent(other,{space:'their-site',body:{title:'outside',text:'allowed to publish'}});
 const ordinary={...DEFAULT_POLICY,followedSpaces:['their-site'],trustedAuthors:[other.author]};
 assert.equal(decide(post,[post],ordinary).visible,true);
 const preferred={...ordinary,ownerPreference:{'their-site':siteOwner.author}};
 assert.equal(decide(post,[post],preferred).visible,false);
 assert.equal(decide(post,[post],{...preferred,ownerAllowedAuthors:{'their-site':[other.author]}}).visible,true);
 assert.equal(await verifyEvent(post),true);
});

test('signed IPFS media attachments are references, not raw bytes',async()=>{
 const author=await generateIdentity();
 const ref='ipfs://bafybeigdyrzt3cu5z4z4bz3hyjipfxzabfqb4zl3nkrhuxuu7pn7efq3aa';
 const p=await signEvent(author,{body:{title:'image',text:'Safe metadata only',media:[ref]}});
 assert.equal(await verifyEvent(p),true);
 assert.deepEqual(p.payload.body.media,[ref]);
 await assert.rejects(signEvent(author,{body:{title:'bad',text:'x',media:['javascript:alert(1)']}}),/Media must be IPFS CIDs/);
});

test('signed reactions, tags and poll choices are portable independent events',async()=>{
 const a=await generateIdentity();
 const post=await signEvent(a,{body:{title:'one',text:'two',fields:{tags:['cats'],poll:{question:'yes?',options:['yes','no']}}}});
 for(const [kind,body] of [['reaction',{target:post.id,value:2}],['tag-vote',{target:post.id,tag:'cats',value:1}],['poll-choice',{target:post.id,option:0}]]){
  const e=await signEvent(a,{kind,body});
  assert.equal(await verifyEvent(e),true);
 }
 await assert.rejects(signEvent(a,{kind:'reaction',body:{target:post.id,value:100}}),/reaction/);
 await assert.rejects(signEvent(a,{kind:'tag-vote',body:{target:post.id,tag:'spam!!!',value:1}}),/tag vote/);
});


test('one locally ignored signed spam flag cannot erase the post or other labels',async()=>{
  const publisher=await generateIdentity(),reviewer=await generateIdentity(),replica=new Replica();
  const post=await signEvent(publisher,{space:'cats',body:{title:'visible',text:'anyone may post'}});
  const label=await signEvent(reviewer,{kind:'label',space:'cats',body:{target:post.id,tag:'spam',reason:'wrongful allegation'}});
  await replica.ingest(post);await replica.ingest(label);
  const policy={...DEFAULT_POLICY,followedSpaces:['cats'],reviewerWeights:{[reviewer.author]:1}};
  assert.equal(decide(post,replica.list(),policy).visible,false);
  assert.equal(decide(post,replica.list(),{...policy,ignoredLabelIds:[label.id]}).visible,true);
  assert.equal(replica.get(label.id)?.id,label.id,'local override must preserve flag evidence');
  assert.equal(replica.get(post.id)?.id,post.id,'local override does not alter publication');
});