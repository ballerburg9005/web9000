import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket,WebSocketServer} from 'ws';
import {generateIdentity,signEvent} from '../core/events.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {compareApprovedPeerInventories} from './peer-inventory-client.js';

function makeIndex(records,label){
  let published=0;
  const listeners=new Set();
  return {
    address:'/orbitdb/'+label,
    async loadInto(replica){for(const event of records)await replica.ingest(event);},
    onUpdate(cb){listeners.add(cb);return()=>listeners.delete(cb);},
    async publish(event){
      published++;
      records.push(event);
      for(const listener of listeners)listener(event);
    },
    get published(){return published;}
  };
}

test('browser diagnostic compares two explicit independent peers without publishing or copying media',async()=>{
  const signer=await generateIdentity();
  const make=(name,space='demo')=>signEvent(signer,{space,body:{title:name,text:'Portable text'}});
  const shared=await make('shared'),firstOnly=await make('first'),secondOnly=await make('second');
  const unrelated=await make('not selected','outside');
  const indexA=makeIndex([shared,firstOnly,unrelated],'browser-diag-a');
  const indexB=makeIndex([shared,secondOnly],'browser-diag-b');
  const bridgeA=await createBrowserBridge({index:indexA,port:0});
  const bridgeB=await createBrowserBridge({index:indexB,port:0});
  try{
    const diff=await compareApprovedPeerInventories([bridgeA.url,bridgeB.url],['demo'],
      {WebSocketImpl:WebSocket,timeoutMs:6000});
    assert.equal(diff.status,'different-reported-ids');
    assert.deepEqual(diff.scopes,['demo']);
    assert.deepEqual(diff.missingFromFirst,[secondOnly.id]);
    assert.deepEqual(diff.missingFromSecond,[firstOnly.id]);
    assert.equal(diff.readOnly,true);
    assert.equal(indexA.published,0);
    assert.equal(indexB.published,0);
    assert.ok(!JSON.stringify(diff).includes(unrelated.id),
      'do not silently cross the reader-selected namespace boundary');

    const same=await compareApprovedPeerInventories([bridgeA.url,bridgeB.url],['empty-scope'],
      {WebSocketImpl:WebSocket,timeoutMs:6000});
    assert.equal(same.status,'same-reported-inventory');
    assert.deepEqual(same.missingFromFirst,[]);
    assert.deepEqual(same.missingFromSecond,[]);
    assert.match(same.note,/does not prove complete history/);
    await assert.rejects(compareApprovedPeerInventories([bridgeA.url,bridgeA.url],['demo'],
      {WebSocketImpl:WebSocket}),/different peers/);
    await assert.rejects(compareApprovedPeerInventories([bridgeA.url,bridgeB.url],['invalid\nspace'],
      {WebSocketImpl:WebSocket}),/namespace/);
    assert.equal(indexA.published,0);
    assert.equal(indexB.published,0);
  }finally{
    await bridgeA.close();await bridgeB.close();
  }
});

test('browser refuses inconsistent peer inventory reports instead of accepting forged differences',async()=>{
 const signer=await generateIdentity();
 const genuine=await signEvent(signer,{space:'demo',body:{title:'verified',text:'signed'}})
 const index=makeIndex([genuine],'verified-peer');
 const legitimate=await createBrowserBridge({index,port:0});
 const liar=new WebSocketServer({host:'127.0.0.1',port:0,perMessageDeflate:false});
 await new Promise(resolve=>liar.once('listening',resolve));
 liar.on('connection',ws=>ws.on('message',raw=>{
   const command=JSON.parse(raw.toString('utf8'));
   if(command.type==='subscribe')
     ws.send(JSON.stringify({type:'subscribed',spaces:command.spaces}));
   else if(command.type==='inventory')
     ws.send(JSON.stringify({type:'inventory',prefix:'',count:1,digest:'a'.repeat(64),revision:1}));
   else if(command.type==='inventory-ids')
     ws.send(JSON.stringify({type:'inventory-ids',prefix:'',ids:['sha256:'+'f'.repeat(64)],next:null,revision:1}));
 }));
 try{
  await assert.rejects(compareApprovedPeerInventories(
    ['ws://127.0.0.1:'+liar.address().port+'/',legitimate.url],['demo'],
    {WebSocketImpl:WebSocket,timeoutMs:5000}),/fingerprint/);
  assert.equal(index.published,0,'inconsistency cannot trigger a write');
 }finally{
  for(const ws of liar.clients)ws.terminate();
  await new Promise(resolve=>liar.close(resolve));
  await legitimate.close();
 }
});
