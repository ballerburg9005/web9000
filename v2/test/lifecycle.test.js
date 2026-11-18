import test from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {buildPostLifecycles} from '../core/lifecycle.js';

test("signed author's correction is a new immutable event, with the original preserved",async()=>{
 const alice=await generateIdentity(),r=new Replica();
 const original=await signEvent(alice,{space:'cats',kind:'post',body:{
   title:'First headline',text:'Original content',media:[],fields:{tags:['cat']}}});
 const correction=await signEvent(alice,{space:'cats',kind:'post',body:{
   title:'Corrected headline',text:'Updated content',media:[],
   fields:{revises:original.id,tags:['cats']}}});
 for(const e of [original,correction])assert.equal((await r.ingest(e)).accepted,true);
 const life=buildPostLifecycles(r.list());
 assert.equal(life.size,1);
 assert.equal(life.get(original.id).display.id,correction.id);
 assert.equal(life.get(original.id).revisions.length,2);
 assert.equal(r.get(original.id).payload.body.text,'Original content');
 assert.equal(await verifyEvent(correction),true);
});

test('another author cannot impersonate a correction or a withdrawal, even in an open namespace',async()=>{
 const a=await generateIdentity(),b=await generateIdentity(),r=new Replica();
 const root=await signEvent(a,{space:'cats',body:{title:'Public cats',text:'original'}});
 const strangerCorrection=await signEvent(b,{space:'cats',body:{
   title:'Spoofed edit',text:'hostile',fields:{revises:root.id}}});
 const strangerWithdrawal=await signEvent(b,{space:'cats',kind:'retraction',
   body:{target:root.id,action:'withdraw',reason:'I claim authority'}});
 for(const e of [root,strangerCorrection,strangerWithdrawal])
   assert.equal((await r.ingest(e)).accepted,true);
 const life=buildPostLifecycles(r.list());
 assert.equal(life.get(root.id).display.id,root.id);
 assert.equal(life.get(root.id).withdrawn,false);
 assert.equal(life.get(strangerCorrection.id).display.id,strangerCorrection.id,
   'invalid edit remains attributable to its actual signer');
 assert.equal(r.size,3,'no record or audit evidence was deleted');
});

test('only a same-key restore can undo an author withdrawal in local views',async()=>{
 const a=await generateIdentity(),r=new Replica();
 const root=await signEvent(a,{space:'ideas',body:{title:'Idea',text:'an idea'}});
 const withdraw=await signEvent(a,{space:'ideas',kind:'retraction',
   body:{target:root.id,action:'withdraw',reason:'Needs revision'},time:1000});
 const restore=await signEvent(a,{space:'ideas',kind:'retraction',
   body:{target:root.id,action:'restore',reason:'Clarified'},time:2000});
 for(const e of [root,withdraw])await r.ingest(e);
 assert.equal(buildPostLifecycles(r.list()).get(root.id).withdrawn,true);
 await r.ingest(restore);
 const life=buildPostLifecycles(r.list()).get(root.id);
 assert.equal(life.withdrawn,false);
 assert.equal(life.actions.length,2);
 assert.equal(r.get(withdraw.id)?.id,withdraw.id);
});

test('edits and withdrawal records validate mandatory target fields before signing',async()=>{
 const identity=await generateIdentity();
 await assert.rejects(signEvent(identity,{kind:'retraction',space:'x',
   body:{target:'invalid',action:'withdraw'}}),/withdrawal/);
 await assert.rejects(signEvent(identity,{kind:'retraction',space:'x',
   body:{target:'sha256:'+'a'.repeat(64),action:'destroy'}}),/withdrawal/);
 await assert.rejects(signEvent(identity,{kind:'post',space:'x',
   body:{title:'x',text:'',fields:{revises:'broken'}}}),/revision/);
});