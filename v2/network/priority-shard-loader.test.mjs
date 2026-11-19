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
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {createOrbitDB} from '@orbitdb/core';
import {generateIdentity,signEvent} from '../core/events.js';
import {openLocalAdaptiveShard} from './adaptive-tier-router.mjs';
import {SignedShardDirectory} from './signed-shard-directory.mjs';
import {PriorityShardLoader,shardTier} from './priority-shard-loader.mjs';

const runDir=()=>mkdtemp(path.join(os.tmpdir(),'w9-priority-recovery-'));
function name(tier,i){
  return 'w9-adaptive-priority-'+tier+'-s'+String(i).padStart(3,'0');
}
const addr=i=>'/orbitdb/'+i.toString(36).padStart(45,'a');

test('100 signed historical DB entries restore 12 established, 7 sponsored, 1 entry before 80 dormant subscriptions',async()=>{
  const dir=await runDir();
  const signer=await generateIdentity(),stranger=await generateIdentity();
  try{
    const registry=new SignedShardDirectory({
      filePath:path.join(dir,'directory.json'),signer,now:()=>1200000
    });
    await registry.initialize();
    const rows=[];
    for(let i=0;i<12;i++)rows.push(name('established',i));
    for(let i=0;i<20;i++)rows.push(name('sponsored',i));
    for(let i=0;i<68;i++)rows.push(name('entry',i));
    for(const [i,entry] of rows.entries())await registry.register(entry,addr(i));
    assert.equal(registry.status.revision,100);
    const calls=[],closed=[];
    const opener=async({name,address})=>{
      calls.push(name);
      return {address,close:async()=>closed.push(name),
        read:async()=>name};
    };
    const loader=new PriorityShardLoader({openShard:opener,maxActive:20});
    await assert.rejects(loader.restore(),/Verified directory required|Verified directory is required/);
    await assert.rejects(loader.useDirectory(registry.exportDocument(),{
      expectedAuthor:stranger.author
    }),/Invalid or inconsistent/,'unapproved operator cannot force subscriptions');
    await loader.useDirectory(registry.exportDocument(),{
      expectedAuthor:signer.author
    });
    const restored=await loader.restore();
    assert.equal(restored.configured,100);
    assert.equal(restored.active,20);
    assert.equal(restored.dormant,80);
    assert.equal(loader.status.openingOrder.length,20);
    assert.deepEqual(calls.slice(0,12),Array.from({length:12},(_,i)=>name('established',i)));
    assert.deepEqual(calls.slice(12,19),Array.from({length:7},(_,i)=>name('sponsored',i)));
    assert.equal(calls[19],name('entry',0));
    assert.equal(loader.status.active.filter(row=>row.tier==='entry').length,1);
    assert.equal(loader.status.active.filter(row=>row.tier==='sponsored').length,7);
    assert.equal(await loader.withShard(name('entry',35),db=>db.read()),name('entry',35));
    assert.equal(loader.status.active.filter(row=>row.tier==='entry').length,1,
      'entry history browsing does not evict protected subscriptions');
    assert.ok(closed.includes(name('entry',0)));
    assert.equal(await loader.withShard(name('sponsored',15),db=>db.read()),
      name('sponsored',15));
    assert.equal(loader.status.active.filter(row=>row.tier==='entry').length,1,
      'new sponsored subscriptions must not evict reserved free-entry slot');
    assert.ok(loader.status.active.some(row=>row.name===name('established',0)));
    await assert.rejects(loader.useDirectory(
      {format:'WEB9000/shard-directory/v1',revisions:registry.exportDocument().revisions.slice(0,50)},
      {expectedAuthor:signer.author}),/Pinned shard directory rollback|Historical signed shard/);
    await Promise.all(Array.from({length:30},(_,i)=>
      loader.activate(name('entry',i))));
    assert.equal(loader.status.active.length,20,
      'concurrent requests cannot exceed open DB cap');
    const attempts=Array.from({length:150},(_,i)=>
      loader.activate(name('entry',i%68)));
    const decisions=await Promise.allSettled(attempts);
    assert.ok(decisions.filter(x=>x.status==='rejected').length>=70,
      'untrusted burst of lazy opens cannot build unbounded promise chain');
    assert.ok(loader.status.openingOrder.length<=256);
    assert.equal(loader.status.active.length,20);
    await loader.close();
    assert.equal(loader.status.active.length,0);
    assert.equal(closed.length,calls.length);
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('real OrbitDB physical logs restore established first, retain signed records, and keep one entry index when active cap is small',async()=>{
  const temp=await runDir();
  let p2p,helia,orbitdb,loader;
  try{
    const signer=await generateIdentity(),author=await generateIdentity();
    const directory=new SignedShardDirectory({
      filePath:path.join(temp,'dir.json'),signer,now:()=>1200000
    });
    await directory.initialize();
    p2p=await createLibp2p({
      addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
      transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
      services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
    });
    helia=await createHelia({libp2p:p2p,
      blockstore:new LevelBlockstore(path.join(temp,'blocks'))});
    orbitdb=await createOrbitDB({ipfs:helia,id:'w9-priority-reader',
      directory:path.join(temp,'orbitdb')});
    const messages=new Map();
    const entries=[
      name('entry',0),name('entry',1),name('entry',2),
      name('sponsored',0),name('sponsored',1),
      name('established',0),name('established',1)
    ];
    for(const entry of entries){
      const db=await openLocalAdaptiveShard(orbitdb,entry);
      const event=await signEvent(author,{body:{
        title:entry,text:'Signed original event in independent DB'
      }});
      await db.publish(event);
      messages.set(entry,event.id);
      await directory.register(entry,db.address);
      await db.close();
    }
    loader=new PriorityShardLoader({
      maxActive:3,
      openShard:async({address})=>{
        const db=await orbitdb.open(address);
        return {address:db.address,
          close:async()=>db.close(),
          read:async()=>(await db.all()).map(x=>x.value.id)};
      }
    });
    await loader.useDirectory(directory.exportDocument(),{
      expectedAuthor:signer.author
    });
    const restored=await loader.restore();
    assert.equal(restored.active,3);
    assert.equal(restored.dormant,4);
    assert.deepEqual(loader.status.openingOrder,
      [name('established',0),name('established',1),name('entry',0)]);
    assert.ok((await loader.withShard(name('established',0),db=>db.read()))
      .includes(messages.get(name('established',0))));
    assert.ok((await loader.withShard(name('entry',2),db=>db.read()))
      .includes(messages.get(name('entry',2))));
    assert.ok(!loader.status.active.some(row=>row.name===name('sponsored',0)));
    assert.equal(loader.status.active.length,3);
  }finally{
    if(loader)await loader.close();
    if(orbitdb)await orbitdb.stop();
    if(helia)await helia.stop();
    await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});

test('shard names use explicit tier suffix and reject unknown classes',()=>{
  assert.equal(shardTier('w9-adaptive-any-established-s012'),'established');
  assert.equal(shardTier('w9-adaptive-any-entry-c0123456789abcdef0123-s100'),'entry');
  assert.equal(shardTier('w9-adaptive-any-sponsored-s000'),'sponsored');
  assert.equal(shardTier('w9-adaptive-any-tenth-karma-s000'),null);
  assert.equal(shardTier('w9-adaptive-any-entry-s999x'),null);
});
