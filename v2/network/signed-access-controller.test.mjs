import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
import {openVerifiedPublicIndex,SIGNED_INDEX_CONTROLLER_TYPE} from './signed-access-controller.js';

const eventually=async(check,description,ms=35000)=>{
  const stop=Date.now()+ms;
  while(Date.now()<stop){
    if(await check())return;
    await sleep(220);
  }
  throw Error('Timeout: '+description);
};
test('direct OrbitDB writers cannot insert unsigned events into signature-checked indexes, but any namespace/author may publish',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'w9-signed-ac-'));
  const peers=[];
  async function peer(name){
    const libp2p=await createLibp2p({
      addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
      transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
      services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
    });
    const ipfs=await createHelia({
      libp2p,blockstore:new LevelBlockstore(path.join(dir,name,'blocks'))
    });
    const orbitdb=await createOrbitDB({ipfs,directory:path.join(dir,name,'orbitdb')});
    const result={libp2p,ipfs,orbitdb,dbs:[]};peers.push(result);
    return result;
  }
  try{
    const a=await peer('first'),b=await peer('second');
    const dialable=a.libp2p.getMultiaddrs().find(x=>x.toString().includes('/tcp/'));
    assert.ok(dialable);
    await b.libp2p.dial(dialable);
    const original=await generateIdentity(),outsider=await generateIdentity();
    const name='w9-signed-append-'+Date.now();
    const first=await openVerifiedPublicIndex(a.orbitdb,name);
    a.dbs.push(first);
    const second=await openVerifiedPublicIndex(b.orbitdb,first.address);
    b.dbs.push(second);
    assert.ok(first.address.startsWith('/orbitdb/'));
    assert.equal(first.signedAccessController,SIGNED_INDEX_CONTROLLER_TYPE);
    assert.equal(second.signedAccessController,SIGNED_INDEX_CONTROLLER_TYPE);
    assert.equal(first.address,second.address);
    const direct=await b.orbitdb.open(first.address);
    const invalid={id:'sha256:'+'0'.repeat(64),payload:{
      kind:'post',space:'public',author:original.author,time:Date.now(),
      body:{title:'Forged post',text:'No valid signature'}
    },signature:'not-a-real-ed25519-signature'};
    await assert.rejects(direct.add(invalid),/not allowed to write|Could not append/,
      'direct OrbitDB writes bypass the wrapper but must still be stopped by canAppend');
    await assert.rejects(direct.add({...invalid,signature:'x'.repeat(50000)}),
      /not allowed to write|Could not append/,
      'the protocol-wide event size cap rejects oversized direct payloads');
    const valid=await signEvent(outsider,{space:'other-people-can-publish',
      body:{title:'No administrator owns this namespace',text:'Any signer allowed'}});
    // Deliberately bypass WEB9000 wrapper on the second peer to verify that
    // the storage-layer rule checks correctness, not membership or name.
    await assert.rejects(direct.add({
      ...valid,payload:{...valid.payload,body:{title:'tampered',text:'changed'}}
    }),/not allowed to write|Could not append/,
      'a valid author key alone never authenticates tampered post contents');
    await direct.add(valid);
    const replicaA=new Replica(),replicaB=new Replica();
    await eventually(async()=>{
      await first.loadInto(replicaA);
      return !!replicaA.get(valid.id);
    },'signature-checked independent OrbitDB peers');
    await second.loadInto(replicaB);
    assert.ok(replicaB.get(valid.id));
    assert.equal(replicaB.get(invalid.id),null);
    const rows=await direct.all();
    assert.equal(rows.length,1,'forgery should not exist even in local raw oplog');
    assert.equal(rows[0].value.id,valid.id);
    const alsoValid=await signEvent(original,{space:'entirely-unrelated-namespace',
      body:{title:'Another independent signer',text:'Same shared index'}});
    await first.publish(alsoValid);
    await eventually(async()=>{
      await second.loadInto(replicaB);
      return !!replicaB.get(alsoValid.id);
    },'signed events replicate in both directions');
    console.log('PASS arbitrary signed authors append; forged direct writes rejected at storage layer');
    // Demonstrate precisely why the previous unrestricted index must not be
    // advertised as storage-hardened, without polluting any live database.
    const legacy=await openPublicIndex(a.orbitdb,name+'-legacy');
    a.dbs.push(legacy);
    const bypass=await a.orbitdb.open(legacy.address);
    await bypass.add(invalid);
    const legacyReplica=new Replica();
    const outcomes=await legacy.loadInto(legacyReplica);
    assert.equal(outcomes.length,1);
    assert.equal(outcomes[0].accepted,false,
      'application safely ignores invalid records but legacy oplog stores them');
    assert.equal((await bypass.all()).length,1);
  }finally{
    for(const p of peers.reverse()){
      for(const db of p.dbs.reverse())try{await db.close();}catch(e){console.error('close db',e.message);}
      try{await p.orbitdb.stop();}catch(e){console.error('stop orbitdb',e.message);}
      try{await p.ipfs.stop();}catch(e){console.error('stop ipfs',e.message);}
    }
    await rm(dir,{recursive:true,force:true});
  }
});
