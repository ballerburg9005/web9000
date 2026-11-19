// Two-endpoint real Bitswap benchmark for separate WEB9000-style Helia media
// providers. 1/10/100 independent IPFS nodes, one reader that explicitly
// dials each, image root per source + a 2 MiB UnixFS video. Outbound policy
// is WEB9000's actual manifest-aware quarantine guard.
// ALL data is temporary; launch ONLY inside a capped disposable container.
// Does not test censorship resistance, DHT, media congestion or stake proof.
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {randomFillSync,createHash} from 'node:crypto';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {unixfs} from '@helia/unixfs';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';
import {createMediaBitswapPolicy} from './media-bitswap-policy.mjs';
import {changeOperatorQuarantine} from './media-quarantine.mjs';

const N=Number(process.argv[2]);
if(![1,10,100].includes(N))throw Error('Usage: benchmark-ipfs-tier-bitswap.mjs 1|10|100');
const work=await mkdtemp(path.join(os.tmpdir(),'w9-bitswap-tiers-'));
const started=performance.now(),nodes=[],MiB=1024*1024;
let failed=null,peak=0;
function stat(stage,details={}){
  global.gc?.();
  const mem=process.memoryUsage();
  peak=Math.max(peak,mem.rss);
  console.log('BITSWAPBENCH '+JSON.stringify({tiers:N,stage,
    elapsedSeconds:+((performance.now()-started)/1000).toFixed(3),
    rssMiB:+(mem.rss/MiB).toFixed(2),
    peakRssMiB:+(peak/MiB).toFixed(2),...details}));
}
async function createNode(name,withPolicy){
  const dir=path.join(work,name);await mkdir(dir,{recursive:true});
  const store=new LevelBlockstore(path.join(dir,'blocks'));
  const manifestFile=path.join(dir,'manifest.json');
  if(withPolicy)await writeFile(manifestFile,'{}',{mode:0o600});
  const policy=withPolicy?createMediaBitswapPolicy({manifestFile,localBlockstore:store}):null;
  const p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  const node={p2p,helia:null,store,manifestFile,policy,name};
  nodes.push(node);
  node.helia=await createHelia({libp2p:p2p,blockstore:store,
    ...(policy?{blockBrokers:policy.blockBrokers}:{})});
  return node;
}
async function chunks(iter){
  const buffers=[];for await(const piece of iter)buffers.push(Buffer.from(piece));
  return Buffer.concat(buffers);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  const reader=await createNode('reader',false);
  const owned=[];
  for(let i=0;i<N;i++){
    const src=await createNode('tier-'+i,true);
    const img=randomFillSync(Buffer.alloc(64*1024));
    img.set([137,80,78,71,13,10,26,10],0);
    const cid=CID.createV1(raw.code,await sha256.digest(img));
    await src.store.put(cid,img);
    const manifest={[cid.toString()]:{type:'image/png',bytes:img.length,time:Date.now(),codec:'raw',sha256:sha(img)}};
    owned.push({src,cid,bytes:img,kind:'image'});
    if(i===0){
      const video=randomFillSync(Buffer.alloc(2*MiB));
      video.writeUInt32BE(24,0);video.write('ftyp',4,'ascii');video.write('isom',8,'ascii');
      const movie=await unixfs(src.helia).addBytes(video);
      manifest[movie.toString()]={type:'video/mp4',bytes:video.length,
        time:Date.now(),codec:'unixfs',sha256:sha(video)};
      owned.push({src,cid:movie,bytes:video,kind:'video'});
    }
    await writeFile(src.manifestFile,JSON.stringify(manifest),{mode:0o600});
    if(!(await src.policy.maySend(cid)))throw Error('Manifest policy refused own signed root '+i);
    if((i+1)%25===0||i===0||i+1===N)stat('sources-ready',{sources:i+1});
  }
  const begin=performance.now();
  // Deliberately rely on explicitly dialled provider peer IDs, not on DHT
  // discovery, magic public gateway caches or built-in loopback shortcuts.
  let delivered=0,networkBytes=0;
  for(const item of owned){
    const addr=item.src.p2p.getMultiaddrs().find(x=>x.toString().includes('/tcp/'));
    if(!addr)throw Error('No source listen address');
    if(!reader.p2p.getConnections(item.src.p2p.peerId).length)
      await reader.p2p.dial(addr);
    const opts={providers:[item.src.p2p.peerId],signal:AbortSignal.timeout(15000)};
    const bytes=item.kind==='image'?
      await chunks(reader.helia.blockstore.get(item.cid,opts)):
      await chunks(unixfs(reader.helia).cat(item.cid.toString(),opts));
    if(!bytes.equals(item.bytes))
      throw Error('Remote Bitswap retrieved incorrect bytes from '+item.src.name);
    networkBytes+=bytes.length;delivered++;
    if(delivered%25===0||delivered===owned.length)
      stat('fetching',{delivered,expected:owned.length,
        readerConnections:reader.p2p.getConnections().length});
  }
  const elapsedSeconds=(performance.now()-begin)/1000;
  const sourceZero=owned.find(o=>o.src.name==='tier-0'&&o.kind==='video');
  if(!sourceZero)throw Error('No video fixture');
  await changeOperatorQuarantine({file:sourceZero.src.manifestFile+'.quarantine.json',
    action:'add',cid:'ipfs://'+sourceZero.cid.toString(),reason:'Benchmark local refusal'});
  if(await sourceZero.src.policy.maySend(sourceZero.cid))
    throw Error('Bitswap policy failed to quarantine UnixFS video root');
  const other=owned.find(o=>o.kind==='image'&&o.src.name==='tier-'+(N-1));
  if(!await other.src.policy.maySend(other.cid))
    throw Error('One tier quarantine incorrectly blocked another tier');
  stat('complete',{sourceNodes:N,readerNodes:1,mediaRootsDelivered:delivered,
    actualMediaMiB:+(networkBytes/MiB).toFixed(2),
    fetchSeconds:+elapsedSeconds.toFixed(3),
    readerConnections:reader.p2p.getConnections().length,
    policyIsolationVerified:true,videoUnixFSVerified:true});
}catch(error){failed=error;console.error('BITSWAPBENCH ERROR',error.stack||String(error));}
finally{
  for(const node of nodes.reverse())
    try{await node.helia?.stop()}catch(error){console.error('stop',error.message)}
  await rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100})
    .catch(error=>console.error('temporary cleanup',error.message));
  stat('cleanup');
}
if(failed)process.exitCode=1;
const watchdog=setTimeout(()=>{
  stat('shutdown-watchdog',{note:'test dependency kept event loop alive'});
  process.exit(failed?1:2);
},3000);
watchdog.unref();
