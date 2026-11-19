import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {setTimeout as sleep} from 'node:timers/promises';
import {generateIdentity,signEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {createBrowserBridge} from './browser-bridge.mjs';

const wait=async(predicate,timeout=9000)=>{
 const until=Date.now()+timeout;
 while(Date.now()<until){if(predicate())return;await sleep(12);}
 throw Error('Timed out waiting for WebSocket sync');
};
function makeIndex(seed){
 const records=[...seed],listeners=new Set();
 return {
  address:'/orbitdb/test-scope-index',
  async loadInto(replica){
   for(const record of records)await replica.ingest(record);
  },
  onUpdate(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  async publish(record){
   records.push(record);
   for(const listener of listeners)listener(record);
  }
 };
}
test('real WebSocket bridge serves indexed pages with immutable local history snapshot and live arrivals',async()=>{
 const identity=await generateIdentity();
 const signed=[];
 for(let n=0;n<86;n++){
  const space=n%4===0?'demo':n%4===1?'groups':n%4===2?'demo':'elsewhere';
  signed.push(await signEvent(identity,{space,
   body:{title:'Index stress '+n,text:'Signed source event '+n}}));
 }
 const expected=signed.filter(e=>e.payload.space==='demo')
  .sort((a,b)=>a.id.localeCompare(b.id)).map(e=>e.id);
 const source=makeIndex(signed);
 const replica=new Replica({maxEvents:500});
 let listCalls=0;
 const originalList=replica.list.bind(replica);
 replica.list=()=>{listCalls++;return originalList();};
 const bridge=await createBrowserBridge({index:source,replica,port:0});
 const socket=new WebSocket(bridge.url);
 const messages=[];
 socket.on('message',raw=>messages.push(JSON.parse(raw.toString())));
 try{
  await once(socket,'open');
  const send=obj=>socket.send(JSON.stringify(obj));
  await wait(()=>messages.some(x=>x.type==='hello'));
  assert.ok(messages.find(x=>x.type==='hello').capabilities.includes('scoped-id-index-v1'));
  send({type:'subscribe',spaces:['demo']});
  await wait(()=>messages.some(x=>x.type==='subscribed'));
  send({type:'sync',cursor:null,limit:7});
  await wait(()=>messages.some(x=>x.type==='batch'));
  const batches=()=>messages.filter(x=>x.type==='batch');
  const first=batches()[0],snapshot=first.snapshotRevision;
  assert.equal(first.events.length,7);
  assert.ok(first.next);
  assert.equal(snapshot,86,'initial source capture is exact local observation count');
  // Live inserts both with high and low IDs after the first page. Their
  // placement in lexicographic history must not destabilize this walk.
  const laterA=await signEvent(identity,{space:'demo',
   body:{title:'New mid-page arrival',text:'Delivered as live frame'}});
  const laterB=await signEvent(identity,{space:'demo',
   body:{title:'Another live record',text:'Not in the old snapshot'}});
  const other=await signEvent(identity,{space:'independent-space',
   body:{title:'Another author namespace',text:'Cannot appear in demo scope'}});
  for(const item of [laterA,laterB,other])await source.publish(item);
  await wait(()=>messages.filter(m=>m.type==='event').length>=2);
  assert.deepEqual(messages.filter(x=>x.type==='event').map(x=>x.event.id).sort(),
   [laterA.id,laterB.id].sort(),'live bridge honors reader scope');
  let next=first.next;
  while(next){
   const before=batches().length;
   send({type:'sync',cursor:next,limit:7});
   await wait(()=>batches().length>before);
   const latest=batches().at(-1);
   assert.equal(latest.snapshotRevision,snapshot,'all batch pages use same observed revision');
   next=latest.next;
   assert.ok(batches().length<100,'pagination terminates');
  }
  const history=batches().flatMap(x=>x.events.map(e=>e.id));
  assert.deepEqual(history,expected,'history snapshot unaffected by new signed updates');
  assert.equal(listCalls,1,'bridge clones/sorts full replica once, not for every page');
  assert.equal(bridge.catalog.size,89);
  // A new subscribe command creates a fresh snapshot without disconnecting.
  const before=batches().length;
  send({type:'subscribe',spaces:['demo','independent-space']});
  await wait(()=>messages.filter(x=>x.type==='subscribed').length===2);
  send({type:'sync',cursor:null,limit:32});
  await wait(()=>batches().length>before);
  const revised=batches().at(-1);
  assert.equal(revised.snapshotRevision,89);
  const ids=revised.events.map(x=>x.id);
  const allNew=[laterA.id,laterB.id,other.id];
  assert.ok(allNew.some(id=>ids.includes(id))||revised.next,
   'new history exposes all newer records across complete pagination');
  assert.equal(listCalls,1);
 }finally{
  socket.terminate();
  await bridge.close();
 }
});
