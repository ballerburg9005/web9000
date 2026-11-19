import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {openInventoryPeer,compareMirrorInventories,repairMirrorDifference} from './reconcile-mirrors.mjs';

function localIndex(seed,name){
 const records=[...seed],listeners=new Set();
 return {
  address:'/orbitdb/'+name,
  async loadInto(replica){for(const event of records)await replica.ingest(event);},
  onUpdate(cb){listeners.add(cb);return()=>listeners.delete(cb);},
  async publish(event){
   if(!records.some(e=>e.id===event.id))records.push(event);
   for(const cb of listeners)cb(event);
  },
  records
 };
}

test('independent peer inventories reveal omissions and allow only explicit signed metadata repair',async()=>{
 const identity=await generateIdentity();
 const make=(space,title)=>signEvent(identity,{space,body:{title,text:'Portable signed record'}});
 const common=await make('demo','shared');
 const onlyFirst=await make('demo','first only');
 const onlySecond=await make('demo','second only');
 const excluded=await make('private-looking-but-public','outside chosen scope');
 const sourceA=localIndex([common,onlyFirst,excluded],'first');
 const sourceB=localIndex([common,onlySecond],'second');
 const aBridge=await createBrowserBridge({index:sourceA,port:0});
 const bBridge=await createBrowserBridge({index:sourceB,port:0});
 let a,b;
 try{
  a=await openInventoryPeer(aBridge.url,['demo']);
  b=await openInventoryPeer(bBridge.url,['demo']);
  assert.ok((await a.request({type:'inventory',prefix:''},'inventory')).digest);
  const diff=await compareMirrorInventories(a,b);
  assert.deepEqual(diff.missingFromFirst,[onlySecond.id]);
  assert.deepEqual(diff.missingFromSecond,[onlyFirst.id]);
  assert.ok(!JSON.stringify(diff).includes(excluded.id),
   'other namespaces do not leak into scoped comparison');
  const escape=await a.request({type:'inventory-get',ids:[excluded.id]},'inventory-records');
  assert.deepEqual(escape.events,[],'cannot bypass scope by fetching known signed ID');
  await assert.rejects(a.request({type:'inventory',prefix:'!'},'inventory'),/invalid inventory prefix/);
  const outsidePrefix=common.id[7]==='a'?'b':'a';
  await assert.rejects(a.request({type:'inventory-ids',prefix:outsidePrefix,cursor:common.id},'inventory-ids'),
   /invalid inventory range/);
  await assert.rejects(repairMirrorDifference(a,b,diff,{}),/explicit target/);
  assert.equal(sourceB.records.length,2,'reading inventories is never a publication');
  assert.deepEqual(await repairMirrorDifference(a,b,diff,{to:'second'}),
   {toFirst:0,toSecond:1});
  assert.ok(sourceB.records.some(e=>e.id===onlyFirst.id),
   'copy preserves exact signed envelope and original author');
  // Existing snapshots correctly remain frozen even after a live update.
  assert.deepEqual((await compareMirrorInventories(a,b)).missingFromSecond,
   [onlyFirst.id]);
  await a.request({type:'subscribe',spaces:['demo']},'subscribed');
  await b.request({type:'subscribe',spaces:['demo']},'subscribed');
  const revised=await compareMirrorInventories(a,b);
  assert.deepEqual(revised.missingFromSecond,[]);
  assert.deepEqual(revised.missingFromFirst,[onlySecond.id]);
  await repairMirrorDifference(a,b,revised,{to:'first'});
  await a.request({type:'subscribe',spaces:['demo']},'subscribed');
  await b.request({type:'subscribe',spaces:['demo']},'subscribed');
  assert.deepEqual((await compareMirrorInventories(a,b)).missingFromFirst,[]);
  assert.deepEqual((await compareMirrorInventories(a,b)).missingFromSecond,[]);
  assert.ok(sourceA.records.some(e=>e.id===excluded.id),'unrelated data preserved');
 }finally{
  a?.close();b?.close();
  await aBridge.close();await bBridge.close();
 }
});
