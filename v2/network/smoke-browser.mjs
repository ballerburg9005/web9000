// End-to-end: browser-compatible WebSocket clients on two independent P2P peers.
// This test exchanges real libp2p/OrbitDB events, not mocked storage.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {generateIdentity,signEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {BrowserPeerMesh} from './browser-mesh.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {openPublicIndex} from './orbit-index.js';

const directory=await mkdtemp(path.join(os.tmpdir(),'w9-websocket-'));
const peers=[],clients=[];
async function peer(name){
  const libp2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(directory,name,'blocks'))});
  const orbitdb=await createOrbitDB({ipfs,directory:path.join(directory,name,'orbitdb')});
  const result={libp2p,ipfs,orbitdb,index:null,bridge:null};peers.push(result);return result;
}
async function eventually(predicate,what,timeout=45000){
  const stop=Date.now()+timeout;
  while(Date.now()<stop){
    if(await predicate())return;
    await sleep(150);
  }
  throw Error('Timed out waiting for '+what);
}
const browser=()=>{
  const received=new Map(),acks=new Set(),errors=[];
  const mesh=new BrowserPeerMesh({
    WebSocketImpl:WebSocket,
    onEvent:async event=>{received.set(event.id,event);},
    onAck:id=>acks.add(id),
    onError:(url,error)=>errors.push(error)
  });
  clients.push(mesh);return {mesh,received,acks,errors};
};
try{
  const a=await peer('a'),b=await peer('b');
  a.index=await openPublicIndex(a.orbitdb,'w9-cross-site-experiment');
  const address=a.libp2p.getMultiaddrs().find(x=>x.toString().includes('/tcp/'));
  assert.ok(address,'peer TCP address');
  await b.libp2p.dial(address);
  b.index=await openPublicIndex(b.orbitdb,a.index.address);
  a.bridge=await createBrowserBridge({index:a.index,replica:new Replica(),port:0});
  b.bridge=await createBrowserBridge({index:b.index,replica:new Replica(),port:0});
  const alice=browser(),bob=browser();
  alice.mesh.connect([a.bridge.url]);bob.mesh.connect([b.bridge.url]);
  await eventually(()=>alice.mesh.connected===1&&bob.mesh.connected===1,'two WebSocket clients');
  const ia=await generateIdentity(),ib=await generateIdentity();
  const first=await signEvent(ia,{
    space:'a-rival-websites-name',body:{title:'No owner approval',text:'WEB9000 open namespace event'}
  });
  assert.equal(alice.mesh.publish(first),1);
  await eventually(()=>alice.acks.has(first.id),'Alice publish acknowledgment');
  await eventually(()=>bob.received.has(first.id),'Alice to Bob across independent libp2p peers');
  assert.equal(bob.received.get(first.id).payload.space,'a-rival-websites-name');
  const second=await signEvent(ib,{
    space:'a-rival-websites-name',body:{title:'Reply from another author',text:'Neither host can veto'}
  });
  assert.equal(bob.mesh.publish(second),1);
  await eventually(()=>alice.received.has(second.id),'Bob to Alice across independent libp2p peers');
  assert.equal(second.payload.author===first.payload.author,false);

  const tampered=JSON.parse(JSON.stringify(first));tampered.payload.body.title='Forged';
  alice.mesh.publish(tampered);
  await eventually(()=>alice.errors.some(x=>x.includes('bad signature')),'signed envelope rejection');
  assert.equal(bob.received.has(tampered.id)&&bob.received.get(tampered.id).payload.body.title==='Forged',false);

  // Reconnect a fresh instance with no cache; it must retrieve historical
  // signed records from a willing mirror without referencing the original host.
  const fresh=browser();fresh.mesh.connect([b.bridge.url]);
  await eventually(()=>fresh.received.has(first.id)&&fresh.received.has(second.id),'portable anti-entropy replay');
  console.log('PASS browser WebSocket clients publish into any space and sync through separate OrbitDB peers');
}finally{
  for(const client of clients)client.disconnect();
  for(const p of peers.reverse()){
    try{await p.bridge?.close();}catch(e){console.error('bridge',e);}
    try{await p.index?.close();}catch(e){console.error('index',e);}
    try{await p.orbitdb.stop();}catch(e){console.error('orbitdb',e);}
    try{await p.ipfs.stop();}catch(e){console.error('ipfs',e);}
  }
  await rm(directory,{recursive:true,force:true});
}
