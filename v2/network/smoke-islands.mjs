// Two completely UNRELATED OrbitDB indexes, no libp2p connection between
// them. A voluntarily mirroring browser is the only bridge.
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {DEFAULT_POLICY} from '../core/policy.js';
import {BrowserPeerMesh} from './browser-mesh.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {mirrorDecision} from './mirror-policy.js';
import {Replica} from '../core/replica.js';
import {openPublicIndex} from './orbit-index.js';

const root=await mkdtemp(path.join(os.tmpdir(),'web9000-islands-'));
const peers=[],meshes=[];
async function independentPeer(name){
  const libp2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(root,name,'blocks'))});
  const orbitdb=await createOrbitDB({ipfs,directory:path.join(root,name,'orbitdb')});
  const record={libp2p,ipfs,orbitdb,index:null,bridge:null};
  peers.push(record);
  record.index=await openPublicIndex(orbitdb,'web9000-island-'+name);
  record.bridge=await createBrowserBridge({index:record.index,replica:new Replica(),port:0});
  return record;
}
const eventually=async (test,label,ms=30000)=>{
  const until=Date.now()+ms;
  while(Date.now()<until){
    if(await test())return;
    await sleep(150);
  }
  throw Error('Timed out: '+label);
};
try {
  const a=await independentPeer('a'),b=await independentPeer('b');
  assert.notEqual(a.index.address,b.index.address,'indexes must be independently created');
  const identity=await generateIdentity(),stranger=await generateIdentity();
  const observedA=new Map(),observedB=new Map(),observedBridge=new Map();
  const createClient=(urls,onEvent)=>{
    const mesh=new BrowserPeerMesh({WebSocketImpl:WebSocket,onEvent});
    meshes.push(mesh);mesh.connect(urls);return mesh;
  };
  const view={...DEFAULT_POLICY,followedSpaces:['shared-nobody-owns-it'],trustedAuthors:[identity.author]};
  const alice=createClient([a.bridge.url],async event=>observedA.set(event.id,event));
  const bob=createClient([b.bridge.url],async event=>observedB.set(event.id,event));
  let carrier;
  carrier=createClient([a.bridge.url,b.bridge.url],async(event,source)=>{
    if(observedBridge.has(event.id))return;
    observedBridge.set(event.id,event);
    const decision=mirrorDecision(event,[...observedBridge.values()],view,null,
      {enabled:true,spaces:['shared-nobody-owns-it']});
    if(decision.mirror)carrier.publish(event,carrier.urls.filter(url=>url!==source));
  });
  await eventually(()=>alice.connected===1&&bob.connected===1&&carrier.connected===2,'three active browsers');
  const signed=await signEvent(identity,{space:'shared-nobody-owns-it',
    body:{title:'This index does not own the namespace',text:'Record crosses indexes with no fixed server'}});
  assert.equal(alice.publish(signed),1);
  await eventually(()=>observedB.has(signed.id),'opt-in browser mirroring between separate indexes');
  assert.equal(await verifyEvent(observedB.get(signed.id)),true);

  const unwanted=await signEvent(stranger,{space:'shared-nobody-owns-it',body:{title:'Untrusted',text:'Do not auto mirror'}});
  alice.publish(unwanted);
  await eventually(()=>observedBridge.has(unwanted.id),'untrusted content discovered at original peer');
  assert.equal(mirrorDecision(unwanted,[unwanted],view,null,{enabled:true,spaces:['*']}).mirror,false);
  assert.equal(observedB.has(unwanted.id),false);
  console.log('PASS optional browser mirroring links independent OrbitDB indexes without granting namespace control');
}finally{
  for(const m of meshes)m.disconnect();
  for(const p of peers.reverse()){
    try{await p.bridge?.close();}catch(e){console.error('bridge',e);}
    try{await p.index?.close();}catch(e){console.error('index',e);}
    try{await p.orbitdb.stop();}catch(e){console.error('orbitdb',e);}
    try{await p.ipfs.stop();}catch(e){console.error('ipfs',e);}
  }
  await rm(root,{recursive:true,force:true});
}
