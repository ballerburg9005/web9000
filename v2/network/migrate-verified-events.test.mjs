import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
import {openVerifiedPublicIndex} from './signed-access-controller.js';
import {inspectLegacyIndex,migrateVerifiedEvents} from './migrate-verified-events.mjs';

test('verified legacy records migrate to independent signed index with evidence, no re-signing, and safe resume',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'web9000-migrate-'));
 const peers=[];
 const start=async name=>{
  const p2p=await createLibp2p({
   addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
   services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const ipfs=await createHelia({libp2p:p2p,blockstore:new LevelBlockstore(path.join(root,name,'blocks'))});
  const orbit=await createOrbitDB({ipfs,directory:path.join(root,name,'orbitdb')});
  const peer={p2p,ipfs,orbit,db:[]};peers.push(peer);
  return peer;
 };
 try{
  const source=await start('source'),dest=await start('dest');
  const a=await generateIdentity(),b=await generateIdentity();
  // Source DB directly writable with no nested signature check.
  const {IPFSAccessController}=await import('@orbitdb/core');
  const db=await source.orbit.open('legacy-migrate-test',{type:'events',
   AccessController:IPFSAccessController({write:['*']})});
  source.db.push(db);
  const invalid={id:'sha256:'+'0'.repeat(64),payload:{space:'x'},signature:'invalid'};
  const post=await signEvent(a,{space:'public-never-owned',
   body:{title:'From a different source',text:'Signed post must survive unchanged'}});
  const reply=await signEvent(b,{kind:'reply',space:'public-never-owned',
   body:{parent:post.id,title:'',text:'Nested independently signed reply'}});
  await db.add(invalid);
  await db.add(post);
  await db.add(post); // intentionally duplicated physical log entry
  await db.add(reply);
  let plan=await inspectLegacyIndex(db);
  assert.equal(plan.scanned,4);assert.equal(plan.invalid,1);
  assert.equal(plan.valid,2);assert.equal(plan.duplicates,1);
  assert.equal(plan.oversized,0);
  assert.match(plan.snapshot,/^[0-9a-f]{64}$/);
  const originalSnapshot=plan.snapshot;
  const signed=await openVerifiedPublicIndex(dest.orbit,'signed-migration-test');
  dest.db.push(signed);
  // A source change after dry-run invalidates the operator's approval.
  const amended=await signEvent(a,{space:'public-never-owned',
   body:{title:'An independently signed update',text:'Must be in the expected snapshot'}});
  await db.add(amended);
  await assert.rejects(migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:originalSnapshot
  }),/changed before copy/);
  plan=await inspectLegacyIndex(db);
  assert.notEqual(plan.snapshot,originalSnapshot);
  assert.equal(plan.valid,3);
  await assert.rejects(migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:'0'.repeat(64)
  }),/Explicit expected source snapshot/);
  // Simulate a crash after a successfully appended record.
  await assert.rejects(migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:plan.snapshot,
   onProgress:()=>{throw Error('Simulated process interruption');}
  }),/Simulated process interruption/);
  assert.equal((await dest.orbit.open(signed.address)).access.type,'web9000-signed-v1');
  const resumed=await migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:plan.snapshot
  });
  assert.equal(resumed.verified,true);
  assert.equal(resumed.sourcePreserved,true);
  assert.equal(resumed.cutover,false);
  assert.equal(resumed.preexisting,1);
  assert.equal(resumed.copied,2);
  assert.equal((await db.all()).length,5);
  const sourceSet=plan.events.map(e=>[e.id,e.signature]);
  const destRows=await (await dest.orbit.open(signed.address)).all();
  assert.equal(destRows.length,3);
  assert.deepEqual(destRows.map(x=>[x.value.id,x.value.signature]).sort(),sourceSet.sort());
  assert.notEqual(signed.address,db.address);
  const idempotent=await migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:plan.snapshot
  });
  assert.equal(idempotent.preexisting,3);
  assert.equal(idempotent.copied,0);
  assert.equal((await db.all()).length,5,'source physical log preserved');
  // No unrelated already-signed destination content may be claimed as
  // migrated source history in a "complete verified" manifest.
  const stranger=await signEvent(b,{space:'other',body:{title:'stranger',text:'independent'}});
  await signed.publish(stranger);
  await assert.rejects(migrateVerifiedEvents({
   sourceDb:db,destinationIndex:signed,plan,expectSnapshot:plan.snapshot
  }),/outside this plan/);
  console.log('PASS signed migration snapshot, changed-source refusal, resume, identity preservation and independent target');
 }finally{
  for(const p of peers.reverse()){
   for(const d of p.db.reverse())try{await d.close();}catch{}
   try{await p.orbit.stop();}catch{}
   try{await p.ipfs.stop();}catch{}
  }
  await rm(root,{recursive:true,force:true});
 }
});
