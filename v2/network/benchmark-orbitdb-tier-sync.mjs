// Isolated two-peer tier benchmark. Operates ONLY in a fresh temporary
// directory inside an explicit resource-limited disposable container.
// No production peer addresses, indexes, keys, data, gateways or protocols.
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
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
import {openPublicIndex} from './orbit-index.js';
import {generateIdentity,signEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';

const count=Number(process.argv[2]||10);
if(!Number.isInteger(count)||count<1||count>100)throw Error('Usage: benchmark-orbitdb-tier-sync.mjs 1..100');
const dir=await mkdtemp(path.join(os.tmpdir(),'w9-tier-sync-'));
const nodes=[],t0=performance.now(),cpu0=process.cpuUsage();
const stamp=()=>+((performance.now()-t0)/1000).toFixed(3);
const mib=x=>+(x/1048576).toFixed(2);
const metrics=(stage,extra={})=>{
  global.gc?.();
  const cpu=process.cpuUsage(cpu0),m=process.memoryUsage();
  console.log('SYNCBENCH '+JSON.stringify({stage,count,elapsedSeconds:stamp(),
    rssMiB:mib(m.rss),heapMiB:mib(m.heapUsed),
    cpuUserSeconds:+(cpu.user/1e6).toFixed(3),
    cpuSystemSeconds:+(cpu.system/1e6).toFixed(3),...extra}));
};
async function newPeer(name){
  const p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const result={name,p2p,ipfs:null,orbitdb:null,dbs:[]};
  nodes.push(result);
  result.ipfs=await createHelia({libp2p:p2p,
    blockstore:new LevelBlockstore(path.join(dir,name,'blocks'))});
  result.orbitdb=await createOrbitDB({ipfs:result.ipfs,
    id:'tier-sync-'+name,directory:path.join(dir,name,'orbitdb')});
  return result;
}
let error=null;
try{
  const a=await newPeer('a'),b=await newPeer('b');
  const addr=a.p2p.getMultiaddrs().find(x=>x.toString().includes('/tcp/'));
  if(!addr)throw Error('No local dial address');
  await b.p2p.dial(addr);
  metrics('connected',{peerConnectionsA:a.p2p.getConnections().length,
    peerConnectionsB:b.p2p.getConnections().length});
  const originals=[],incomingIds=new Set(),seen=[];
  for(let i=0;i<count;i++){
    const first=await openPublicIndex(a.orbitdb,'w9-tier-sync-'+String(i).padStart(3,'0'));
    a.dbs.push(first);
    const second=await openPublicIndex(b.orbitdb,first.address);
    b.dbs.push(second);
    if(first.address!==second.address)throw Error('A and B opened different signed-log addresses');
    second.onUpdate(event=>{
      if(event?.id)incomingIds.add(event.id);
    });
  }
  metrics('all-open',{firstTopics:a.p2p.services.pubsub.getTopics().length,
    secondTopics:b.p2p.services.pubsub.getTopics().length,
    firstConnections:a.p2p.getConnections().length,secondConnections:b.p2p.getConnections().length});
  const author=await generateIdentity();
  await sleep(1600); // allow gossip subscriptions/mesh propagation
  const writeStart=performance.now();
  for(let i=0;i<count;i++){
    const record=await signEvent(author,{space:'tier-bench',
      body:{title:'One real signed event per class '+i,text:'Synced between two local peers'}});
    originals.push(record);
    await a.dbs[i].publish(record);
  }
  metrics('published',{events:originals.length,
    publishSeconds:+((performance.now()-writeStart)/1000).toFixed(3)});
  const deadline=Date.now()+30000;
  let received=0;
  do{
    received=0;
    for(let i=0;i<count;i++){
      const replica=new Replica({maxEvents:100});
      await b.dbs[i].loadInto(replica);
      if(replica.get(originals[i].id))received++;
    }
    if(received===count)break;
    await sleep(450);
  }while(Date.now()<deadline);
  metrics('replicated',{delivered:received,expected:count,
    updateNotifications:incomingIds.size,
    firstTopics:a.p2p.services.pubsub.getTopics().length,
    secondTopics:b.p2p.services.pubsub.getTopics().length,
    firstConnections:a.p2p.getConnections().length,secondConnections:b.p2p.getConnections().length});
  if(received!==count)throw Error('Only '+received+' of '+count+' events replicated within 30s');
}catch(err){error=err;console.error('SYNCBENCH ERROR',err.stack||String(err));}
finally{
  for(const p of nodes.reverse()){
    for(const db of p.dbs.reverse())try{await db.close()}catch(e){console.error('close DB',e.message)}
    if(p.orbitdb)try{await p.orbitdb.stop()}catch(e){console.error('stop OrbitDB',e.message)}
    if(p.ipfs)try{await p.ipfs.stop()}catch(e){console.error('stop Helia',e.message)}
    if(p.p2p&&p.p2p.status!=='stopped')try{await p.p2p.stop()}catch{}
  }
  await rm(dir,{recursive:true,force:true});
  metrics('cleanup');
}
if(error)process.exitCode=1;
// Never strand an ephemeral benchmark container indefinitely. A clean
// shutdown should leave no active handles; log a nonzero diagnostic exit if
// this dependency stack retains background handles even after close/stop.
// This exit watchdog is ONLY for this standalone benchmark executable.
const pendingHandles=()=>process._getActiveHandles?.().map(h=>h.constructor?.name)||[];
metrics('post-cleanup-handles',{activeHandleKinds:pendingHandles()});
const watchdog=setTimeout(()=>{
  metrics('shutdown-watchdog',{activeHandleKinds:pendingHandles(),
    note:'process remained alive after explicit peer and database teardown'});
  process.exit(error?1:2);
},2500);
watchdog.unref();
