import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {generateIdentity,signEvent} from '../core/events.js';
import {BrowserPeerMesh,parseSyncSpaces,normalizeSyncSpaces} from './browser-mesh.js';

test('namespace subscriptions are canonical, explicit and bounded',()=>{
 assert.deepEqual(parseSyncSpaces('*'),['*']);
 assert.deepEqual(parseSyncSpaces(''),['*']);
 assert.deepEqual(parseSyncSpaces('commons\ndemo\ngroups\ncommons'),['commons','demo','groups']);
 assert.deepEqual(parseSyncSpaces('unusual,name;still one space'),['unusual,name;still one space']);
 assert.deepEqual(parseSyncSpaces('commons\n*\ndemo'),['*']);
 assert.deepEqual(normalizeSyncSpaces(['groups','groups','demo']),['groups','demo']);
 assert.throws(()=>parseSyncSpaces('d'.repeat(181)),/Invalid namespace/);
 assert.throws(()=>parseSyncSpaces('valid\u0000bad'),/Invalid namespace/);
 assert.throws(()=>normalizeSyncSpaces(Array.from({length:65},(_,i)=>'space-'+i)),/Invalid namespace/);
});
test('a malicious WebSocket bridge cannot inject valid out-of-scope events into a scoped browser',async()=>{
 const author=await generateIdentity();
 const yes=await signEvent(author,{space:'demo',body:{title:'Allowed',text:'Scoped record'}});
 const no=await signEvent(author,{space:'unselected',body:{title:'Not allowed',text:'No local receipt'}});
 const seen=[],packets=[],subscribed=[],errors=[];
 const server=new WebSocketServer({host:'127.0.0.1',port:0,perMessageDeflate:false});
 await new Promise(resolve=>server.once('listening',resolve));
 server.on('connection',ws=>{
  ws.on('message',raw=>{
   const m=JSON.parse(raw.toString());
   if(m.type==='subscribe'){
    subscribed.push(m.spaces);
    // Test two independent code paths: batch replication and unsolicited
    // event push. The remote bridge is intentionally misbehaving.
    ws.send(JSON.stringify({type:'subscribed',spaces:m.spaces}));
    ws.send(JSON.stringify({type:'batch',events:[no,yes],next:null}));
    ws.send(JSON.stringify({type:'event',event:no}));
   }
  });
 });
 const mesh=new BrowserPeerMesh({WebSocketImpl:WebSocket,
  onEvent:async e=>{seen.push(e);},onError:(_,err)=>errors.push(err),
  onPacket:p=>packets.push(p)});
 try{
  const url='ws://127.0.0.1:'+server.address().port+'/';
  mesh.connect([url],{spaces:['demo']});
  const until=Date.now()+6000;
  while(Date.now()<until&&(seen.length<1||packets.filter(p=>p.direction==='scope-drop').length<2))
    await sleep(30);
  assert.deepEqual(subscribed[0],['demo']);
  assert.deepEqual(seen.map(e=>e.id),[yes.id]);
  assert.equal(packets.filter(p=>p.direction==='scope-drop').length,2);
  assert.deepEqual(errors,[]);
  mesh.connect([url],{spaces:['*']});
  const untilAll=Date.now()+6000;
  while(Date.now()<untilAll&&!seen.some(e=>e.id===no.id))await sleep(30);
  assert.ok(seen.some(e=>e.id===no.id),'wildcard may accept all independently signed public events');
 }finally{
  mesh.disconnect();
  for(const ws of server.clients)ws.terminate();
  await new Promise(resolve=>server.close(resolve));
 }
});
