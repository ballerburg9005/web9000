import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {setRelation,normalizeRelations,relationFor} from '../core/social-relations.js';
import {discussionRecords,filterDebugEntries,summarizeSignedEvents,DebugTrace} from '../core/debug-console.js';

test('friend and foe are mutually exclusive local, removable labels with no derived trust',async()=>{
 const alice=await generateIdentity(),bob=await generateIdentity(),c=await generateIdentity();
 let relations=setRelation({},alice.author,bob.author,'friend');
 assert.equal(relationFor(relations,bob.author),'friend');
 relations=setRelation(relations,alice.author,bob.author,'foe');
 assert.equal(relationFor(relations,bob.author),'foe');
 relations=setRelation(relations,alice.author,c.author,'friend');
 relations=setRelation(relations,alice.author,bob.author,null);
 assert.equal(relationFor(relations,bob.author),null);
 assert.equal(relationFor(relations,c.author),'friend');
 assert.throws(()=>setRelation(relations,alice.author,alice.author,'friend'),/own key/);
 assert.throws(()=>setRelation(relations,alice.author,bob.author,'admin'),/friend, foe/);
 assert.equal(Object.keys(normalizeRelations({[c.author]:'foe',__proto__:'friend',foo:'friend'},alice.author)).length,1);
 assert.throws(()=>setRelation(relations,alice.author,bob.author,'foe',{limit:1}),/full/);
});
test('debug thread dump includes entire nested reply chain and response metadata, no unrelated post',async()=>{
 const alice=await generateIdentity(),other=await generateIdentity();
 const sign=(who,kind,body)=>signEvent(who,{kind,space:'demo',body});
 const post=await sign(alice,'post',{title:'Root',text:'Content'});
 const unrelated=await sign(alice,'post',{title:'Unrelated',text:'Other'});
 const a=await sign(other,'reply',{parent:post.id,title:'',text:'One'});
 const b=await sign(alice,'reply',{parent:a.id,title:'',text:'Two'});
 const unrelatedReply=await sign(other,'reply',{parent:unrelated.id,title:'',text:'Not included'});
 const vote=await sign(alice,'reaction',{target:a.id,value:1});
 const events=[b,unrelatedReply,unrelated,post,vote,a];
 const info=discussionRecords(events,post.id);
 assert.equal(info.replyCount,2);
 assert.deepEqual(new Set(info.events.map(e=>e.id)),new Set([a.id,b.id,vote.id]));
 assert.equal(summarizeSignedEvents(events).kinds.reply,3);
 const list=events.map(event=>({kind:event.payload.kind,space:event.payload.space,author:event.payload.author,event}));
 assert.equal(filterDebugEntries(list,{kind:'reply',author:other.author}).length,2);
 assert.equal(filterDebugEntries(list,{query:'Not included'}).length,1);
 assert.equal(filterDebugEntries(list,{space:'foo'}).length,0);
});
test('debug trace bounded, raw frames preserved except explicit truncation; no signing secrets',()=>{
 const trace=new DebugTrace({limit:2,bytesPerPacket:512});
 trace.push({direction:'out',peer:'wss://peer.test',type:'subscribe',packet:'{"type":"subscribe"}'});
 trace.push({direction:'in',type:'event',packet:'x'.repeat(900)});
 trace.push({direction:'error',type:'failure',message:'peer closed'});
 assert.equal(trace.entries.length,2);
 assert.equal(trace.entries[0].raw.length,512);
 assert.equal(trace.entries[0].truncated,true);
 assert.equal(trace.entries[0].originalCharacters,900);
 const saved=JSON.parse(JSON.stringify(trace.entries));
 const restored=new DebugTrace({limit:2,bytesPerPacket:512});
 assert.equal(restored.restore(saved),2,'recent trace restores from untrusted session data');
 assert.deepEqual(restored.entries,saved);
 restored.push({direction:'in',type:'new',packet:'fresh'});
 assert.ok(restored.entries[1].seq>saved[1].seq,
   'stable packet IDs cannot collide across same-tab reload');
 assert.equal(restored.restore([{raw:'bad',seq:'bad'},null]),0,
   'invalid persisted traffic is ignored rather than rendered or executed');
 trace.clear();assert.deepEqual(trace.entries,[]);
});
