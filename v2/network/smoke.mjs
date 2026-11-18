import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
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
import {openPublicIndex} from './orbit-index.js';

const base=await mkdtemp(path.join(os.tmpdir(),'web9000-peers-'));
const peers=[];
async function startPeer(label) {
  const libp2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const helia=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(base,label,'blocks'))});
  const orbitdb=await createOrbitDB({ipfs:helia,directory:path.join(base,label,'orbitdb')});
  const peer={libp2p,helia,orbitdb,index:null};
  peers.push(peer);
  return peer;
}
async function eventually(check,what){
  const until=Date.now()+45000;
  let error;
  while(Date.now()<until){
    try{if(await check())return;}catch(e){error=e;}
    await sleep(450);
  }
  throw Error('Timeout synchronizing '+what+(error?': '+error.message:''));
}
try {
  const a=await startPeer('a'),b=await startPeer('b');
  a.index=await openPublicIndex(a.orbitdb,'web9000-smoke-public');
  const addr=a.libp2p.getMultiaddrs().find(s=>s.toString().includes('/tcp/'));
  assert.ok(addr,'peer A must have a dialable TCP address');
  await b.libp2p.dial(addr);
  b.index=await openPublicIndex(b.orbitdb,a.index.address);
  const original=await generateIdentity(),replyAuthor=await generateIdentity();
  const first=await signEvent(original,{space:'no-one-owns-this-space',
    body:{title:'Hello from A',text:'A publication signed by an arbitrary author'}});
  await a.index.publish(first);
  const bReplica=new Replica();
  await eventually(async()=>{
    await b.index.loadInto(bReplica);
    return bReplica.get(first.id)!==null;
  },'A to B');
  const second=await signEvent(replyAuthor,{space:'no-one-owns-this-space',
    body:{title:'Hello from B',text:'Anyone can publish into the same claimed namespace'}});
  await b.index.publish(second);
  const aReplica=new Replica();
  await eventually(async()=>{
    await a.index.loadInto(aReplica);
    return aReplica.get(second.id)!==null;
  },'B to A');
  assert.notEqual(first.payload.author,second.payload.author);
  console.log('PASS two independent peers synchronized signed events both directions',a.index.address);
} finally {
  for(const p of peers.reverse()){
    try{if(p.index)await p.index.close();}catch(e){console.error('close index',e);}
    try{await p.orbitdb.stop();}catch(e){console.error('orbitdb stop',e);}
    try{await p.helia.stop();}catch(e){console.error('helia stop',e);}
  }
  await rm(base,{recursive:true,force:true});
}
