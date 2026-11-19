import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ScopedEventCatalog} from './scoped-event-catalog.mjs';

const id=n=>'sha256:'+n.toString(16).padStart(64,'0');
const item=(n,space)=>({id:id(n),payload:{space}});
const walk=(catalog,snapshot,limit=32)=>{
 const all=[];let cursor=null;let pages=0;
 do{
  const result=catalog.page(snapshot,{cursor,limit});
  all.push(...result.ids);
  pages++;
  if(!result.next)return {ids:all,pages};
  assert.ok(!cursor||result.next>cursor,'cursor advances lexicographically');
  cursor=result.next;
  assert.ok(pages<=1000,'finite pagination');
 }while(true);
};
test('local namespace catalog indexes arbitrary public spaces and never grants authorship authority',()=>{
 const catalog=new ScopedEventCatalog([
  item(9,'demo'),item(1,'other'),item(7,'demo'),item(3,'a,b;c d'),
  item(8,'groups'),item(2,'other'),item(4,'demo')
 ]);
 assert.deepEqual(walk(catalog,catalog.capture(['*']),2).ids,
  [1,2,3,4,7,8,9].map(id));
 assert.deepEqual(walk(catalog,catalog.capture(['demo']),2).ids,
  [4,7,9].map(id));
 assert.deepEqual(walk(catalog,catalog.capture(['other','demo','demo']),2).ids,
  [1,2,4,7,9].map(id));
 assert.deepEqual(walk(catalog,catalog.capture(['a,b;c d'])).ids,[id(3)]);
 assert.deepEqual(walk(catalog,catalog.capture(['*','other'])).ids,
  [1,2,3,4,7,8,9].map(id));
 assert.equal(catalog.add(item(9,'demo')),false,'duplicate ID does not create a second entry');
 assert.throws(()=>catalog.add(item(9,'altered')),/Conflicting/);
 assert.throws(()=>catalog.page(catalog.capture(['*']),{limit:33}),/Invalid history page/);
 assert.throws(()=>catalog.capture([]),/Invalid namespace scopes/);
 assert.throws(()=>catalog.capture(['invalid\nspace']),/Invalid namespace scopes/);
 assert.throws(()=>catalog.page(catalog.capture(['*']),{cursor:'invalid'}),/Invalid history cursor/);
 assert.deepEqual(catalog.counts().spaces,
  {'demo':3,'other':2,'a,b;c d':1,'groups':1});
});
test('fixed local snapshot pages remain exact while new records arrive between pages',()=>{
 const catalog=new ScopedEventCatalog([
  item(10,'commons'),item(30,'commons'),item(50,'commons'),
  item(70,'commons'),item(90,'commons'),item(20,'elsewhere')
 ]);
 const snapshot=catalog.capture(['commons']);
 const first=catalog.page(snapshot,{limit:2});
 assert.deepEqual(first.ids,[id(10),id(30)]);
 assert.equal(first.next,id(30));
 // An arrival lower than the cursor and one higher than the end are live
 // notifications, not part of the original frozen history snapshot.
 catalog.add(item(15,'commons'));
 catalog.add(item(60,'commons'));
 catalog.add(item(110,'commons'));
 catalog.add(item(80,'elsewhere'));
 assert.deepEqual(walk(catalog,snapshot,2).ids,[10,30,50,70,90].map(id));
 assert.deepEqual(walk(catalog,catalog.capture(['commons']),2).ids,
  [10,15,30,50,60,70,90,110].map(id));
 assert.equal(snapshot.revision,6);
 assert.equal(catalog.revision,10);
});
test('large scoped history returns bounded pages in sorted order without scanning unrelated namespaces',()=>{
 const catalog=new ScopedEventCatalog();
 const total=9000;
 const names=Array.from({length:24},(_,i)=>'public-scope-'+i);
 for(let n=0;n<total;n++){
  // Deterministic permutation of sorted IDs exercises sorted-array
  // insertion as well as subsequent log-style updates.
  const k=(n*7919)%total;
  assert.equal(catalog.add(item(k,names[k%24])),true);
 }
 const scoped=catalog.capture([names[1],names[3],names[21]]);
 const pageCount=walk(catalog,scoped);
 const expected=Array.from({length:total},(_,i)=>i)
  .filter(i=>[1,3,21].includes(i%24)).map(id);
 assert.deepEqual(pageCount.ids,expected);
 assert.ok(pageCount.pages<=Math.ceil(expected.length/32));
 assert.equal(catalog.size,total);
 assert.equal(walk(catalog,catalog.capture(['missing-public-space'])).ids.length,0);
});

test('bounded prefix reconciliation exposes exact scoped IDs, snapshot-stable fingerprints and no unrelated records',()=>{
 const padded=(prefix,n)=>'sha256:'+prefix+n.toString(16).padStart(64-prefix.length,'0');
 const make=(prefix,n,space)=>({id:padded(prefix,n),payload:{space}});
 const a=make('a',3,'demo'),b=make('a',5,'other'),c=make('b',8,'demo');
 const catalog=new ScopedEventCatalog([a,b,c]);
 const shot=catalog.capture(['demo']);
 const expected=createHash('sha256').update(a.id+'\\n').digest('hex');
 assert.deepEqual(catalog.fingerprint(shot,{prefix:'a'}),{
  prefix:'a',count:1,digest:expected,revision:3});
 assert.deepEqual(catalog.page(shot,{prefix:'a',limit:1}).ids,[a.id]);
 assert.deepEqual(catalog.page(shot,{prefix:'b',limit:1}).ids,[c.id]);
 assert.equal(catalog.inSnapshot(shot,b.id),false,'unselected namespace cannot be fetched');
 assert.equal(catalog.inSnapshot(shot,a.id),true);
 const newcomer=make('a',9,'demo');
 catalog.add(newcomer);
 assert.deepEqual(catalog.page(shot,{prefix:'a'}).ids,[a.id],
  'new live arrival is excluded from previous inventory');
 assert.deepEqual(catalog.page(catalog.capture(['demo']),{prefix:'a'}).ids,[a.id,newcomer.id]);
 assert.throws(()=>catalog.fingerprint(shot,{prefix:'!'}),/prefix/);
 assert.throws(()=>catalog.page(shot,{prefix:'a',cursor:c.id}),/outside inventory prefix/);
 assert.throws(()=>catalog.page(shot,{prefix:'a'.repeat(9)}),/prefix/);
});
