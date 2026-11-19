// Destructive-to-its-own-temporary-data ONLY; isolated local OrbitDB microbenchmark.
// Never points at or modifies the running WEB9000 peer's data, identities or indexes.
// NODE_OPTIONS='--expose-gc' node benchmark-orbitdb-tiers.mjs 1|10|100 [writes-per-db=1]
import {mkdtemp,rm,stat,readdir} from 'node:fs/promises';
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
import {openPublicIndex} from './orbit-index.js';
import {generateIdentity,signEvent} from '../core/events.js';

const count=Number(process.argv[2]||10),writes=Number(process.argv[3]??1);
if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(writes)||writes<0||writes>1000)
  throw Error('Usage: benchmark-orbitdb-tiers.mjs 1..100 [writes-per-db 0..100]');
const dir=await mkdtemp(path.join(os.tmpdir(),'web9000-orbit-tier-bench-'));
let libp2p,helia,orbitdb;
const opened=[],t0=performance.now(),cpu0=process.cpuUsage();
const mib=x=>+(x/1048576).toFixed(2);
const sec=t=>+((performance.now()-t)/1000).toFixed(3);
const mem=()=>({rssMiB:mib(process.memoryUsage().rss),heapMiB:mib(process.memoryUsage().heapUsed),
  externalMiB:mib(process.memoryUsage().external),arrayBuffersMiB:mib(process.memoryUsage().arrayBuffers)});
async function bytesIn(root){
  let sum=0,entries;
  try{entries=await readdir(root,{withFileTypes:true})}catch{return 0}
  for(const e of entries){
    const name=path.join(root,e.name);
    if(e.isDirectory())sum+=await bytesIn(name);
    else if(e.isFile())sum+=(await stat(name)).size;
  }
  return sum;
}
const measure=(stage,details={})=>{
  if(global.gc)global.gc();
  const cpu=process.cpuUsage(cpu0);
  console.log('BENCH '+JSON.stringify({tierCount:count,writesPerTier:writes,stage,
    elapsedSeconds:sec(t0),cpuUserSeconds:+(cpu.user/1e6).toFixed(3),
    cpuSystemSeconds:+(cpu.system/1e6).toFixed(3),...mem(),...details}));
};
let failed=null;
try{
  const create=performance.now();
  libp2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  helia=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(dir,'blocks'))});
  orbitdb=await createOrbitDB({ipfs:helia,id:'bench-local-only',directory:path.join(dir,'orbitdb')});
  measure('base-ready',{initSeconds:sec(create)});
  const signer=await generateIdentity();
  const addresses=new Set();
  let openSeconds=0,writeSeconds=0;
  for(let i=0;i<count;i++){
    const openStart=performance.now();
    const db=await openPublicIndex(orbitdb,'w9-bench-class-'+String(i).padStart(3,'0'));
    openSeconds+=(performance.now()-openStart)/1000;
    if(addresses.has(db.address))throw Error('Benchmark opened duplicate OrbitDB addresses');
    addresses.add(db.address);
    opened.push(db);
    const writeStart=performance.now();
    for(let j=0;j<writes;j++){
      const event=await signEvent(signer,{kind:'post',space:'bench',
        time:Date.now(),body:{title:'Fixture '+i+' '+j,text:'Local signed record; not sent to WEB9000.'}});
      await db.publish(event);
    }
    writeSeconds+=(performance.now()-writeStart)/1000;
    if(opened.length===1||opened.length===10||opened.length%25===0||opened.length===count)
      measure('progress',{opened:opened.length,openSeconds:+openSeconds.toFixed(3),
        writeSeconds:+writeSeconds.toFixed(3)});
  }
  const diskBytes=await bytesIn(dir);
  const pubsub=libp2p.services.pubsub;
  const topics=typeof pubsub.getTopics==='function'?pubsub.getTopics():null;
  measure('all-open',{opened:opened.length,uniqueAddresses:addresses.size,
    pubsubTopics:Array.isArray(topics)?topics.length:null,events:opened.length*writes,
    openSeconds:+openSeconds.toFixed(3),writeSeconds:+writeSeconds.toFixed(3),
    diskMiB:mib(diskBytes),tempOnly:true});
  for(let i=opened.length-1;i>=0;i--)await opened[i].close();
  opened.length=0;
  measure('dbs-closed');
}catch(error){
  failed=error;console.error('BENCH ERROR',error.stack||String(error));
}finally{
  for(const db of opened.reverse())try{await db.close()}catch{}
  if(orbitdb)try{await orbitdb.stop()}catch(error){console.error('orbitdb stop',error.message)}
  if(helia)try{await helia.stop()}catch(error){console.error('helia stop',error.message)}
  if(libp2p&&libp2p.status!=='stopped')try{await libp2p.stop()}catch{}
  try{await rm(dir,{recursive:true,force:true})}catch(error){console.error('temp cleanup',error.message)}
  measure('cleanup');
}
if(failed)process.exitCode=1;
