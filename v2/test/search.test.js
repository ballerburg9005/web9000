import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPosts,tagCloud,availableSpaces,postKind} from '../core/search.js';
const item=(id,fields={},body='')=>({event:{id,payload:{
  kind:'post',space:id.startsWith('demo')?'demo':'cats',author:'ed25519:sample',
  time:id.includes('old')?1:100,body:{title:'Cats '+id,text:body,fields}
}},decision:{visible:true}});
test('tag cloud and space listing derive from source signed-event fields',()=>{
 const posts=[item('demo1',{tags:['cats','fun','cats'],presentation:'image'}),
  item('demo2',{tags:['cats','art'],schedule:{start:'2030-01-01'}}),
  item('live-old',{tags:['fun'],presentation:'discussion'})];
 assert.deepEqual(tagCloud(posts),[
  {tag:'cats',count:2},{tag:'fun',count:2},{tag:'art',count:1}
 ]);
 assert.deepEqual(availableSpaces(posts.map(i=>i.event),['open']).map(x=>x.name),['demo','cats','open']);
});
test('typed, attribute-only, exclusion and qualified score filters all compose',()=>{
 const posts=[
  item('demo1',{tags:['cat','meme'],presentation:'image'},'hello'),
  item('demo2',{tags:['art','poll'],poll:{question:'which?',options:['a','b']}},'vote'),
  item('live-old',{tags:['cat'],schedule:{start:'2027-01-01',location:'Park'}},'hello')
 ];
 assert.equal(postKind(posts[1]),'poll');
 assert.equal(postKind(posts[2]),'event');
 assert.equal(searchPosts(posts,{query:'vote',attribute:'body'}).length,1);
 assert.equal(searchPosts(posts,{query:'Park',attribute:'location'}).length,1);
 assert.equal(searchPosts(posts,{includeTags:['cat'],excludeKinds:['event']}).length,1);
 assert.equal(searchPosts(posts,{excludeTags:['cat']}).length,1);
 assert.equal(searchPosts(posts,{minScore:10,scoreFor:()=>9}).length,0);
 assert.equal(searchPosts(posts,{minScore:10,scoreFor:()=>11}).length,3);
});
test('trash shows only filtered records, not merely unpopular ones',()=>{
 const visible=item('demo1'),hidden={...item('demo2'),decision:{visible:false,reason:'spam'}};
 assert.deepEqual(searchPosts([visible,hidden],{onlyFlagged:true}).map(x=>x.event.id),['demo2']);
 assert.deepEqual(searchPosts([visible,hidden]).map(x=>x.event.id),['demo1']);
});