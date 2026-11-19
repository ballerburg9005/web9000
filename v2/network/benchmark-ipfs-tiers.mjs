// Disposable IPFS media-tier benchmark. Never points to real WEB9000 data.
// Modes:
//   shards 1|10|100    : independent LevelBlockstores behind one Helia/libp2p identity
//   nodes  1|10|100    : independent Helia/libp2p identities and LevelBlockstores
// Produces 100 distinct synthetic, high-entropy media files under application
// caps (50 96KiB raw images + 50 2MiB UnixFS videos), verifies all content,
// checks cross-tier isolation, measures resources and physically stored bytes.
// It is NOT the deployed WEB9000 media upload gateway or a spam proof.
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomFillSync,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {createHelia} from 'helia';
import {unixfs} from '@helia/unixfs';
import {LevelBlockstore} from 'blockstore-level';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';

const mode=process.argv[2],tierCount=Number(process.argv[3]);
if(!['shards','nodes'].includes(mode)||![1,10,100].includes(tierCount))
  throw Error('Usage: benchmark-ipfs-tiers.mjs shards|nodes 1|10|100');
const TOTAL_FILES=100,IMAGE_BYTES=96*1024,VIDEO_BYTES=2*1024*1024;
const root=await mkdtemp(path.join(os.tmpdir(),'web9000-ipfs-tier-bench-'));
const tiers=[],nodes=[],started=performance.now(),cpuStart=process.cpuUsage(),MiB=1024*1024;
let base=null,failed=null;let maxRss=0;
async function diskBytes(rootDir){
  let entries;
  try{entries=await readdir(rootDir,{withFileTypes:true})}catch{return 0;}
  let bytes=0;
  for(const entry of entries){
    const p=path.join(rootDir,entry.name);
    if(entry.isDirectory())bytes+=await diskBytes(p);
    else if(entry.isFile())bytes+=(await stat(p)).size;
  }
  return bytes;
}
const snap=(stage,more={})=>{
  global.gc?.();
  const m=process.memoryUsage(),cpu=process.cpuUsage(cpuStart);
  maxRss=Math.max(maxRss,m.rss);
  console.log('IPFSBENCH '+JSON.stringify({mode,tiers:tierCount,stage,
    elapsedSeconds:+((performance.now()-started)/1000).toFixed(3),
    rssMiB:+(m.rss/MiB).toFixed(2),peakSampledRssMiB:+(maxRss/MiB).toFixed(2),
    heapMiB:+(m.heapUsed/MiB).toFixed(2),
    cpuSeconds:+((cpu.user+cpu.system)/1e6).toFixed(3),...more}));
};
async function makeNetwork(name,store){
  const p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const node={p2p,helia:null};
  nodes.push(node);
  node.helia=await createHelia({libp2p:p2p,blockstore:store});
  return node.helia;
}
const asBuffer=async iterable=>{
  const parts=[];
  for await(const chunk of iterable)parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
};
try{
  if(mode==='shards'){
    // Each partition owns an independently opened LevelDB blockstore;
    // one shared Helia network identity is used only for UnixFS construction.
    // A production Bitswap/HTTP path MUST explicitly route by verified tier;
    // this test does not pretend that Helia's default broker finds every shard.
    const baseStore=new LevelBlockstore(path.join(root,'network-blocks'));
    base=await makeNetwork('shared',baseStore);
    snap('network-ready',{nodes:1});
    for(let n=0;n<tierCount;n++){
      const store=new LevelBlockstore(path.join(root,'tier-'+n,'blocks'));
      await store.open();
      tiers.push({store,fs:unixfs({...base,blockstore:store}),ownsNode:false,index:n});
      if((n+1)%25===0||n===0||n+1===tierCount)
        snap('opening',{opened:n+1});
    }
  }else{
    for(let n=0;n<tierCount;n++){
      const store=new LevelBlockstore(path.join(root,'tier-'+n,'blocks'));
      const helia=await makeNetwork('peer-'+n,store);
      tiers.push({store,fs:unixfs(helia),ownsNode:true,index:n});
      if((n+1)%25===0||n===0||n+1===tierCount)
        snap('opening',{opened:n+1});
    }
  }
  const openEnd=performance.now();
  const manifest=[];
  for(let i=0;i<TOTAL_FILES;i++){
    const isVideo=i%2===1;
    const buffer=randomFillSync(Buffer.alloc(isVideo?VIDEO_BYTES:IMAGE_BYTES));
    if(isVideo){
      // Synthetic payload with an MP4 ftyp header (not playable), sufficient
      // to benchmark the application's UnixFS multi-chunk object storage.
      buffer.writeUInt32BE(24,0);buffer.write('ftyp',4,'ascii');
      buffer.write('isom',8,'ascii');
    }else{
      buffer.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);
    }
    const tier=tiers[i%tierCount];
    let cid;
    if(isVideo)cid=await tier.fs.addBytes(buffer);
    else{
      cid=CID.createV1(raw.code,await sha256.digest(buffer));
      await tier.store.put(cid,buffer);
    }
    manifest.push({cid,tier:i%tierCount,size:buffer.length,
      digest:createHash('sha256').update(buffer).digest('hex'),isVideo});
    if((i+1)%25===0) snap('writing',{mediaFiles:i+1});
  }
  const writeEnd=performance.now();
  const perTierFiles=Array.from({length:tierCount},()=>0);
  for(const item of manifest){
    const tier=tiers[item.tier];
    let bytes;
    if(item.isVideo)bytes=await asBuffer(tier.fs.cat(item.cid.toString(),{offline:true}));
    else bytes=await asBuffer(tier.store.get(item.cid));
    if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.digest)
      throw Error('Tier '+item.tier+' media bytes/CID failed round-trip validation');
    perTierFiles[item.tier]++;
  }
  // Check that lower/other partitions do not accidentally contain a root.
  if(tierCount>1){
    for(const item of manifest.slice(0,20)){
      const other=tiers[(item.tier+1)%tierCount];
      if(await other.store.has(item.cid))
        throw Error('CID root leaked into a different tier blockstore');
    }
  }
  const verifyEnd=performance.now();
  const disk=await diskBytes(root);
  snap('complete',{nodes:nodes.length,storedFiles:manifest.length,
    imageFiles:50,videoFiles:50,nominalMediaMiB:+((50*IMAGE_BYTES+50*VIDEO_BYTES)/MiB).toFixed(2),
    openSeconds:+((openEnd-started)/1000).toFixed(3),
    writeSeconds:+((writeEnd-openEnd)/1000).toFixed(3),
    readVerifySeconds:+((verifyEnd-writeEnd)/1000).toFixed(3),
    diskMiB:+(disk/MiB).toFixed(2),everyTierNonempty:perTierFiles.every(n=>n>0),
    isolationChecked:tierCount>1,mediaBytesVerified:true});
}catch(error){failed=error;console.error('IPFSBENCH ERROR',error.stack||String(error));}
finally{
  if(mode==='shards'){
    for(const tier of tiers.reverse())try{await tier.store.close()}catch(error){console.error('shard close',error.message)}
  }
  for(const node of nodes.reverse())try{await node.helia?.stop()}catch(error){console.error('Helia close',error.message)}
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
    .catch(error=>console.error('temp delete',error.message));
  snap('cleanup');
}
if(failed)process.exitCode=1;
// A benchmark must not remain alive indefinitely because of any dependency
// background socket or timer. Keep the watchdog standalone to this tool.
const watchdog=setTimeout(()=>{
  snap('shutdown-watchdog',{note:'lingering runtime handles after explicit cleanup'});
  process.exit(failed?1:2);
},3000);
watchdog.unref();
