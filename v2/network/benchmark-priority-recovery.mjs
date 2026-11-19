// Disposable *real* OrbitDB priority recovery microbenchmark.
// Creates exactly 100 individually signed physical logs, closes them,
// then uses the signed directory to restore only 20 or all 100 (one process).
// This is a warm reopen, NOT a process restart, worker isolation, or spam test.
// Run inside a capped disposable container with repository mounted read-only.
// Usage: node --expose-gc benchmark-priority-recovery.mjs 20|100
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
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
import {openLocalAdaptiveShard} from './adaptive-tier-router.mjs';
import {SignedShardDirectory} from './signed-shard-directory.mjs';
import {PriorityShardLoader} from './priority-shard-loader.mjs';

const CAP=Number(process.argv[2]);
if(![20,100].includes(CAP))throw Error('Usage: benchmark-priority-recovery.mjs 20|100');
const root=await mkdtemp(path.join(os.tmpdir(),'w9-priority-benchmark-'));
const t0=performance.now();
const stats=(phase,more={})=>{
  global.gc?.();
  const m=process.memoryUsage();
  console.log('PRIORITYBENCH '+JSON.stringify({
    phase,configured:100,maxActive:CAP,
    seconds:+((performance.now()-t0)/1000).toFixed(3),
    rssMiB:+(m.rss/1048576).toFixed(2),
    heapMiB:+(m.heapUsed/1048576).toFixed(2),...more}));
};
let ipfs,orbitdb,loader,error=null;
try{
  const p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  ipfs=await createHelia({libp2p:p2p,
    blockstore:new LevelBlockstore(path.join(root,'blocks'))});
  orbitdb=await createOrbitDB({ipfs,id:'w9-priority-benchmark',
    directory:path.join(root,'orbitdb')});
  const signer=await generateIdentity(),author=await generateIdentity();
  const directory=new SignedShardDirectory({
    filePath:path.join(root,'index-manifest.json'),signer,
    now:()=>1600000000000
  });
  await directory.initialize();
  stats('base-ready');
  const source=[];
  for(let i=0;i<100;i++){
    const tier=i<12?'established':i<32?'sponsored':'entry';
    const name='w9-adaptive-benchmark-'+tier+'-s'+
      String(i).padStart(3,'0');
    const shard=await openLocalAdaptiveShard(orbitdb,name);
    const signed=await signEvent(author,{body:{
      title:'Priority experiment '+i,text:'Original signed metadata'}
    });
    await shard.publish(signed);
    await directory.register(name,shard.address);
    source.push(shard);
    if((i+1)%25===0)stats('creating-fixture',{fixtureShards:i+1});
  }
  for(const shard of source.reverse())await shard.close();
  stats('all-fixtures-closed',{
    topicsAfterClose:p2p.services.pubsub.getTopics().length
  });
  loader=new PriorityShardLoader({
    maxActive:CAP,entryReserve:1,
    openShard:async({address})=>{
      const db=await orbitdb.open(address);
      return {address:db.address,close:()=>db.close(),
        ids:async()=>(await db.all()).map(x=>x.value.id)};
    }
  });
  await loader.useDirectory(directory.exportDocument(),{
    expectedAuthor:signer.author
  });
  const t=performance.now();
  const restored=await loader.restore();
  const openSeconds=(performance.now()-t)/1000;
  if(restored.active!==CAP||
     p2p.services.pubsub.getTopics().length!==CAP)
    throw Error('Active DB or topics mismatch '+JSON.stringify(restored));
  let readVerified=0;
  for(const item of loader.status.active){
    const ids=await loader.withShard(item.name,db=>db.ids());
    if(ids.length!==1)throw Error('Missing signed event in '+item.name);
    readVerified++;
  }
  stats('restored',{
    restoreSeconds:+openSeconds.toFixed(3),active:restored.active,
    dormant:restored.dormant,readVerified,
    pubsubTopics:p2p.services.pubsub.getTopics().length,
    startedClasses:loader.status.openingOrder.slice(0,14),
    priorityCounts:loader.status.active.reduce((obj,item)=>
      (obj[item.tier]=(obj[item.tier]||0)+1,obj),{})
  });
}catch(e){error=e;console.error('PRIORITYBENCH ERROR',e.stack||String(e));}
finally{
  if(loader)await loader.close().catch(e=>console.error('loader close',e.message));
  if(orbitdb)await orbitdb.stop().catch(e=>console.error('orbitdb close',e.message));
  if(ipfs)await ipfs.stop().catch(e=>console.error('ipfs close',e.message));
  await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  stats('cleanup');
}
if(error)process.exitCode=1;
const watch=setTimeout(()=>{
  stats('shutdown-watchdog',{note:'background sockets after explicit closure'});
  process.exit(error?1:2);
},2500);
watch.unref();
