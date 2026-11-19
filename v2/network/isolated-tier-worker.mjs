// Disposable operator-local process-isolation experiment. NOT the default
// WEB9000 peer, not a public-facing bridge, and not proof of stake or karma.
// Each worker has its OWN libp2p/Helia/OrbitDB process and blockstore.
// Intended to run in separate OS/Docker cgroups with bounded CPU/RAM/PIDs.
//
// Usage: node isolated-tier-worker.mjs entry|sponsored|established /tmp/own-store [port=0] [operator-author-allowlist.json]
// An operator-owned allowlist is lab-only proof fixture. Never infer privilege
// from an incoming JSON tier, self-reported balance, user-supplied IP header,
// or an arbitrary number of votes.
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {openLocalAdaptiveShard} from './adaptive-tier-router.mjs';

const cls=process.argv[2],dir=process.argv[3],port=Number(process.argv[4]??0);
if(!['entry','sponsored','established'].includes(cls)||
   typeof dir!=='string'||!path.isAbsolute(dir)||
   path.resolve(dir)!==dir||!dir.startsWith('/tmp/')||
   !Number.isSafeInteger(port)||port<0||port>65535)
  throw Error('Usage: isolated-tier-worker.mjs entry|sponsored|established /tmp/<isolated> [port] [operator-allowlist.json]');
const MAX_ENVELOPE=48*1024;
const MAX_RECORDS=50;
const MAX_WINDOW=30;
const MAX_INFLIGHT=4;
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
let allowlist=new Set();
const allowFile=process.argv[5];
if(cls!=='entry'){
  if(typeof allowFile!=='string'||!path.isAbsolute(allowFile))
    throw Error('Protected lab worker must have an explicit operator-owned author allowlist');
  const parsed=JSON.parse(await readFile(allowFile,'utf8'));
  if(!Array.isArray(parsed)||parsed.length>1000||parsed.some(x=>!AUTHOR.test(x)))
    throw Error('Invalid lab author allowlist');
  allowlist=new Set(parsed);
}
await mkdir(dir,{recursive:true});
let p2p,ipfs,orbitdb,shard,server;
let shuttingDown=false,active=0,used=0,epoch=-1,total=0;
const counters={accepted:0,badEnvelope:0,limited:0,unqualified:0};
const reply=(res,status,data)=>{
  if(res.writableEnded||res.destroyed)return;
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(data));
};
async function bodyOf(req){
  const length=req.headers['content-length'];
  if(!/^[0-9]{1,6}$/.test(String(length||''))||
    Number(length)>MAX_ENVELOPE||Number(length)<1)
    throw Error('invalid-size');
  // Reject Transfer-Encoding, even if Content-Length is also present.
  if(req.headers['transfer-encoding'])throw Error('chunked-not-allowed');
  const parts=[];let size=0;
  for await(const chunk of req){
    size+=chunk.byteLength;
    if(size>MAX_ENVELOPE)throw Error('oversized');
    parts.push(chunk);
  }
  if(size!==Number(length))throw Error('mismatched-size');
  return Buffer.concat(parts,size);
}
try{
  p2p=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  ipfs=await createHelia({libp2p:p2p,
    blockstore:new LevelBlockstore(path.join(dir,'blocks'))});
  orbitdb=await createOrbitDB({ipfs,id:'w9-isolated-'+cls,
    directory:path.join(dir,'orbitdb')});
  shard=await openLocalAdaptiveShard(orbitdb,'w9-adaptive-isolated-'+cls+'-s000');
  total=(await shard.events()).length;
  server=http.createServer(async(req,res)=>{
    if(req.url==='/health'&&req.method==='GET'){
      reply(res,200,{ok:true,className:cls,address:shard.address,
        stored:total,active,pid:process.pid,rssMiB:+
          (process.memoryUsage().rss/1048576).toFixed(2),counters});
      return;
    }
    if(req.url!=='/publish'||req.method!=='POST'){
      reply(res,404,{ok:false,error:'unknown-route'});return;
    }
    const window=Math.floor(Date.now()/60000);
    if(window!==epoch){epoch=window;used=0;}
    // Mandatory bounded admission before JSON parsing, crypto and OrbitDB.
    // Separate processes can therefore be killed/overloaded independently.
    if(shuttingDown||active>=MAX_INFLIGHT||used>=MAX_WINDOW||total>=MAX_RECORDS){
      counters.limited++;
      reply(res,429,{ok:false,error:'isolated-worker-resource-limit'});return;
    }
    active++;used++;
    try{
      const bytes=await bodyOf(req);
      let event;
      try{event=JSON.parse(bytes.toString('utf8'));}catch{
        throw Error('not-json');
      }
      if(!event?.payload?.author||!AUTHOR.test(event.payload.author)){
        throw Error('invalid-author');
      }
      if(cls!=='entry'&&!allowlist.has(event.payload.author)){
        counters.unqualified++;
        reply(res,403,{ok:false,error:'operator-proof-required'});
        return;
      }
      await shard.publish(event); // original Ed25519 verification, then append
      total++;counters.accepted++;
      reply(res,200,{ok:true,id:event.id});
    }catch(e){
      counters.badEnvelope++;
      reply(res,422,{ok:false,error:'bad-signed-event'});
    }finally{active--;}
  });
  server.maxConnections=16;
  server.headersTimeout=5000;
  server.requestTimeout=5000;
  server.keepAliveTimeout=1000;
  server.maxRequestsPerSocket=20;
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  console.log('ISOLATED_TIER_READY '+JSON.stringify({className:cls,
    pid:process.pid,port:server.address().port,address:shard.address,
    records:total}));
}catch(error){
  console.error('ISOLATED_TIER_FAILED',error.stack||String(error));
  process.exitCode=1;
  if(server)server.close();
  if(shard)await shard.close().catch(()=>{});
  if(orbitdb)await orbitdb.stop().catch(()=>{});
  if(ipfs)await ipfs.stop().catch(()=>{});
  process.exit(1);
}
async function stop(){
  if(shuttingDown)return;
  shuttingDown=true;
  if(server){
    server.closeAllConnections();
    await new Promise(resolve=>server.close(()=>resolve()));
  }
  if(shard)await shard.close().catch(()=>{});
  if(orbitdb)await orbitdb.stop().catch(()=>{});
  if(ipfs)await ipfs.stop().catch(()=>{});
  process.exit(0);
}
process.on('SIGTERM',()=>{stop().catch(()=>process.exit(1));});
process.on('SIGINT',()=>{stop().catch(()=>process.exit(1));});
