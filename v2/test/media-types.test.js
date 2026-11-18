import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaItems,primaryMedia,choosePrimaryMediaIndex,validateLocalUploads} from '../core/media.js';
import {generateIdentity,signEvent} from '../core/events.js';
import {postKind} from '../core/search.js';
const cid='ipfs://bafkreigh2akiscaildc6a4p7gkprmjv6xnw3rc5fnmrm5bnwve76jx2uqq';
test('ordered MIME and primary type keep older image-only signed posts compatible',()=>{
 const old={media:[cid,cid],fields:{tags:['cat']}};
 assert.deepEqual(mediaItems(old).map(x=>x.kind),['image','image']);
 assert.equal(primaryMedia(old).index,0);
 const mixed={media:[cid,cid,cid],fields:{mediaTypes:['audio/mpeg','image/png','video/mp4']}};
 assert.equal(primaryMedia(mixed).index,1,'default image preview beats sound and video');
 mixed.fields.primaryMediaIndex=2;
 assert.deepEqual([primaryMedia(mixed).index,primaryMedia(mixed).kind],[2,'video']);
 assert.equal(choosePrimaryMediaIndex(['audio/mpeg','video/mp4']),1);
});
test('mixed formats are classified by the selected primary item',()=>{
 const body={title:'test',text:'',media:[cid,cid],
   fields:{presentation:'image',mediaTypes:['audio/mpeg','video/mp4'],primaryMediaIndex:0}};
 const item={event:{payload:{body}}};
 assert.equal(postKind(item),'audio');
 body.fields.primaryMediaIndex=1;
 assert.equal(postKind(item),'video');
});
test('local mixed file limits and signed metadata are constrained',async()=>{
 const user=await generateIdentity();
 const media=[cid,cid];
 const good=await signEvent(user,{space:'cats',body:{title:'Mix',text:'',media,
   fields:{mediaTypes:['audio/mpeg','video/mp4'],primaryMediaIndex:1}}});
 assert.equal(good.payload.body.fields.mediaTypes.length,2);
 await assert.rejects(signEvent(user,{space:'cats',body:{title:'X',text:'',media,
   fields:{mediaTypes:['text/html','video/mp4']}}}),/MIME/);
 await assert.rejects(signEvent(user,{space:'cats',body:{title:'X',text:'',media,
   fields:{mediaTypes:['video/mp4']}}}),/MIME/);
 await assert.rejects(signEvent(user,{space:'cats',body:{title:'X',text:'',media,
   fields:{primaryMediaIndex:3}}}),/primary/);
 assert.doesNotThrow(()=>validateLocalUploads([
   {name:'a.mp3',type:'audio/mpeg',size:2048},{name:'b.mp4',type:'video/mp4',size:13000}]));
 assert.throws(()=>validateLocalUploads([{name:'x.html',type:'text/html',size:200}]));
 assert.throws(()=>validateLocalUploads(Array.from({length:7},()=>({
   name:'x.png',type:'image/png',size:100}))));
});
test('binary MiB caps apply equally to every audio/video format',()=>{
 for(const type of ['audio/mpeg','audio/ogg','audio/wav','video/mp4','video/webm']){
  const exact={name:'exact',type,size:10*1024*1024};
  const tooLarge={name:'too-large',type,size:10*1024*1024+1};
  assert.doesNotThrow(()=>validateLocalUploads([exact]),type+' accepts exactly 10 MiB');
  assert.throws(()=>validateLocalUploads([tooLarge]),/size limit/,type+' rejects a single byte over 10 MiB');
 }
});