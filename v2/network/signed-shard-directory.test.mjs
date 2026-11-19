import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
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
import {AdaptiveTierRouter} from './adaptive-tier-router.mjs';
import {
 SignedShardDirectory,verifySignedShardDirectory,directoryBackedShardOpener
} from './signed-shard-directory.mjs';

const original=body=>JSON.parse(JSON.stringify(body));

test('signed directory persists every historical physical shard and rejects signed rollback, forged records and address rewrites',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'w9-shard-directory-'));
 const signer=await generateIdentity(),stranger=await generateIdentity();
 let clock=1000000;
 const file=path.join(tmp,'shards.json');
 try{
  const directory=new SignedShardDirectory({filePath:file,signer,now:()=>clock});
  await directory.initialize();
  assert.equal(directory.status.revision,0);
  const name='w9-adaptive-test-entry-s000';
  const address='/orbitdb/'+'z'.repeat(45);
  const backup='/orbitdb/'+'a'.repeat(45);
  await directory.register(name,address);
  assert.equal(directory.status.revision,1);
  assert.equal(directory.resolve(name),address);
  const first=directory.exportDocument();
  await assert.rejects(verifySignedShardDirectory({format:first.format,revisions:[]},
    {expectedAuthor:signer.author}),/Invalid shard directory/,
    'unsigned empty discovery claims are invalid');
  const pinned=directory.status;
  await directory.register(name,address);
  assert.equal(directory.status.revision,1,'idempotent reopening does not mint new signed snapshot');
  await assert.rejects(directory.register(name,backup),
    /Refusing changed address/);
  clock+=100;
  await directory.register('w9-adaptive-test-entry-s001',backup);
  const second=directory.exportDocument();
  const report=await verifySignedShardDirectory(second,{
    expectedAuthor:signer.author,minimumRevision:1
  });
  assert.equal(report.entries.length,2);
  assert.equal(report.revision,2);
  assert.notEqual(report.digest,pinned.digest);
  await assert.rejects(verifySignedShardDirectory(first,{
    expectedAuthor:signer.author,minimumRevision:2
  }),/Stale/,'reader pin prevents old directory rollback');
  await assert.rejects(verifySignedShardDirectory(second,{
    expectedAuthor:stranger.author
  }),/Invalid or inconsistent/,'only pinned approved source signer is accepted');
  const tampered=original(second);
  tampered.revisions[1].body.shards[0].address=
    '/orbitdb/'+'p'.repeat(45);
  await assert.rejects(verifySignedShardDirectory(tampered,{
    expectedAuthor:signer.author
  }),/cannot remove|signature|Invalid/);
  const truncated=original(second);
  truncated.revisions.splice(0,1);
  await assert.rejects(verifySignedShardDirectory(truncated,{
    expectedAuthor:signer.author
  }),/Invalid or inconsistent/);
  const restarted=new SignedShardDirectory({filePath:file,signer,now:()=>clock});
  await restarted.initialize({minimumRevision:2,expectedDigest:report.digest});
  assert.equal(restarted.resolve(name),address);
  assert.deepEqual(restarted.status.addresses,report.entries);
  await writeFile(file,JSON.stringify(tampered));
  await assert.rejects(new SignedShardDirectory({
    filePath:file,signer,now:()=>clock
  }).initialize(),/cannot remove|signature|Invalid/,
  'invalid on-disk history never silently resets to empty');
 }finally{await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('directory-backed adaptive physical shards retain actual OrbitDB addresses and original signed records across router restart',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'w9-directory-orbit-real-'));
 let p2p,helia,orbitdb,router,router2;
 try{
  const signer=await generateIdentity();
  const author=await generateIdentity();
  const dirFile=path.join(tmp,'routing','shards.json');
  let clock=1000000;
  const directory=new SignedShardDirectory({
    filePath:dirFile,signer,now:()=>clock
  });
  await directory.initialize();
  p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  helia=await createHelia({libp2p:p2p,
    blockstore:new LevelBlockstore(path.join(tmp,'blocks'))});
  orbitdb=await createOrbitDB({ipfs:helia,id:'w9-directory-test-curator',
    directory:path.join(tmp,'orbitdb')});
  const opener=directoryBackedShardOpener({orbitdb,directory});
  const initRouter=()=>new AdaptiveTierRouter({
    now:()=>clock,maxShards:8,entryBudget:60,
    sourceBudget:10,authorBudget:30,
    namePrefix:'w9-adaptive-shard-dir',
    secret:Buffer.alloc(32,0x16),openShard:opener
  });
  router=initRouter();
  const event=await signEvent(author,{space:'anywhere',
    body:{title:'History is never deleted by reassignment',text:'Portable record'}});
  const result=await router.offer(event,{sourceCohort:'reader-entrance'});
  assert.equal(result.accepted,true);
  assert.equal(directory.resolve(result.shard),result.address);
  const old=directory.status;
  const readerSnapshot=await verifySignedShardDirectory(directory.exportDocument(),{
    expectedAuthor:signer.author,minimumRevision:old.revision,
    expectedDigest:old.digest
  });
  assert.deepEqual(readerSnapshot.entries,[{name:result.shard,address:result.address}]);
  await router.close();router=null;
  const loaded=new SignedShardDirectory({filePath:dirFile,signer,now:()=>clock});
  await loaded.initialize({minimumRevision:old.revision,expectedDigest:old.digest});
  router2=new AdaptiveTierRouter({
    now:()=>clock+60000,maxShards:8,entryBudget:60,
    sourceBudget:10,authorBudget:30,namePrefix:'w9-adaptive-shard-dir',
    secret:Buffer.alloc(32,0x16),
    openShard:directoryBackedShardOpener({orbitdb,directory:loaded})
  });
  const another=await signEvent(author,{space:'anywhere',
    body:{title:'Record after restart',text:'Same physical shard address'}});
  const result2=await router2.offer(another,{sourceCohort:'reader-entrance'});
  assert.equal(result2.accepted,true);
  assert.equal(result2.address,result.address);
  assert.equal(loaded.status.revision,1,
    'reopening by pinned address cannot make a second directory revision');
  const reused=await orbitdb.open(result.address);
  const ids=(await reused.all()).map(row=>row.value.id);
  assert.ok(ids.includes(event.id));
  assert.ok(ids.includes(another.id));
 }finally{
  if(router)await router.close();
  if(router2)await router2.close();
  if(orbitdb)await orbitdb.stop();
  if(helia)await helia.stop();
  await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
});
