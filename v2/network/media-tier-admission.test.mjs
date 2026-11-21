import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {createHelia} from 'helia';
import {unixfs} from '@helia/unixfs';
import {LevelBlockstore} from 'blockstore-level';
import {generateIdentity} from '../core/events.js';
import {MiB,KiB} from '../core/media-resource-policy.js';
import {createImageGateway} from './media-node.mjs';
import {signMediaStakeGrant} from './media-stake-grant.mjs';
import {createMediaLanes} from './media-lanes.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const png=size=>{
 const b=Buffer.alloc(size,61);
 b.set([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68],0);
 return b;
};
const mp4=size=>{
 const b=Buffer.alloc(size,43);
 b.writeUInt32BE(24,0);b.write('ftyp',4,'ascii');b.write('isom',8,'ascii');
 return b;
};
test('ordinary and signed Stake4Karma-size admissions are enforced before media ingest, with 20+ MiB UnixFS streaming',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w9-media-stake-admission-'));
 let ipfs,gateway;
 const issuer=await generateIdentity(),subject=await generateIdentity();
 const audience='independent-media-peer-007';
 try{
  const libp2p=await createLibp2p({
   addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],
   streamMuxers:[yamux()],services:{identify:identify()}
  });
  ipfs=await createHelia({libp2p,
   blockstore:new LevelBlockstore(join(dir,'blocks'))});
  const manifestFile=join(dir,'manifest.json');
  const sharedMediaLanes=createMediaLanes();
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',
   manifestFile,uploadEnabled:true,richMediaEnabled:true,
   maxTotal:160*MiB,trustedProxyAddress:'127.0.0.1',
   stakeGrantIssuer:issuer.author,
   stakeGrantAudience:audience,transferLanes:sharedMediaLanes});
  const url='http://127.0.0.1:'+gateway.port;
  const post=(type,body,grant,testSourceIp='203.0.113.11')=>
   fetch(url+'/upload',{method:'POST',headers:{
    'content-type':type,'x-real-ip':testSourceIp,
    ...(grant?{'x-web9000-media-grant':grant}:{})
   },body});
  const newGrant=(type,bytes,usdCents)=>signMediaStakeGrant({
   signer:issuer,subject:subject.author,audience,mediaType:type,
   bytes:bytes.length,sha256:hash(bytes),stakeUsdCents:usdCents,
   evidenceSha256:hash('mock independently verified stake+oracle report')
  });
  const small=png(50*KiB);
  // An occupied (possibly Bitswap-originated) HEAVY slot cannot block a
  // new ordinary tiny image POST, even when the HTTP/Bitswap scheduler
  // object is shared by the media operator's gateway and P2P broker.
  const blockHeavy=await sharedMediaLanes.acquire('heavy',12);
  const tinyWhileHeavy=await post('image/png',png(40*KiB));
  assert.equal(tinyWhileHeavy.status,201);
  blockHeavy();
  let response=await post('image/png',small);
  assert.equal(response.status,201);
  assert.equal((await response.json()).priority,'image-50k');
  const second=png(100*KiB);
  response=await post('image/png',second);
  assert.equal(response.status,201);
  assert.equal((await response.json()).priority,'image-100k');
  const unverified=png(600*KiB);
  assert.equal((await post('image/png',unverified)).status,403);
  assert.equal((await post('image/png',unverified,
   Buffer.from(JSON.stringify({usdCents:100000})).toString('base64url'))).status,403);
  const imageGrant=await newGrant('image/png',unverified,10000);
  response=await post('image/png',unverified,imageGrant);
  assert.equal(response.status,201);
  assert.equal((await response.json()).priority,'image-1m');
  const video=mp4(5*MiB+513);
  assert.equal((await post('video/mp4',video)).status,403);
  const videoGrant=await newGrant('video/mp4',video,10000);
  const altered=Buffer.from(video);altered[1000]^=1;
  assert.equal((await post('video/mp4',altered,videoGrant,'203.0.113.12')).status,403,
   'a valid signed receipt cannot sponsor different media bytes');
  const accepted=await post('video/mp4',video,videoGrant,'203.0.113.13');
  assert.equal(accepted.status,201,'file-specific independently pinned grant permits 5 MiB video');
  const info=await accepted.json();
  assert.equal(info.priority,'video-10m');
  const read=await fetch(url+'/ipfs/'+info.cid.slice(7),{
   headers:{range:'bytes=999-1300'}});
  assert.equal(read.status,206);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()),video.subarray(999,1301));
  const archive=mp4(21*MiB+11);
  assert.equal((await post('video/mp4',archive)).status,403);
  const largeGrant=await newGrant('video/mp4',archive,100000);
  const large=await post('video/mp4',archive,largeGrant,'203.0.113.14');
  assert.equal(large.status,201,'1000-dollar operator grant unlocks above 20 MiB');
  const largeMeta=await large.json();
  assert.equal(largeMeta.priority,'video-100m');
  const head=await fetch(url+'/ipfs/'+largeMeta.cid.slice(7),{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(Number(head.headers.get('content-length')),archive.length);
  const peek=await fetch(url+'/ipfs/'+largeMeta.cid.slice(7),{
   headers:{range:'bytes=32-63'}});
  assert.equal(peek.status,206);
  assert.deepEqual(Buffer.from(await peek.arrayBuffer()),archive.subarray(32,64));
  if(process.env.WEB9000_BENCH_MEDIA_100==='1'){
   // Deliberately excluded from the regular CI suite. Exercise a genuine
   // 100 MiB upload only inside a separately capped disposable container.
   const t0=performance.now(),maximum=mp4(100*MiB);
   const exact=await newGrant('video/mp4',maximum,100000);
   const result=await post('video/mp4',maximum,exact,'203.0.113.15');
   assert.equal(result.status,201,'exact 100 MiB verified $1000 ceiling');
   const {cid:largeCid}=await result.json();
   const back=await fetch(url+'/ipfs/'+largeCid.slice(7),{
    headers:{range:'bytes=104857560-104857599'}});
   assert.equal(back.status,206);
   assert.deepEqual(Buffer.from(await back.arrayBuffer()),
    maximum.subarray(-40));
   console.log('MEDIA100BENCH '+JSON.stringify({bytes:maximum.length,
    elapsedSeconds:Math.round((performance.now()-t0)/1000),
    cid:largeCid,passed:true}));
  }
  const health=await(await fetch(url+'/health')).json();
  assert.equal(health.imageLimit,512*KiB);
  assert.equal(health.videoLimit,4*MiB);
  assert.equal(health.videoStake100Limit,20*MiB);
  assert.equal(health.videoStake1000Limit,100*MiB);
  assert.equal(health.stakeAdmissionEnabled,true);
  assert.equal(health.priorityLanes.tiny.capacity,3);
  assert.equal(health.priorityLanes.heavy.capacity,1);
  assert.equal((await readdir(dir)).some(x=>x.startsWith('manifest.json.upload-')),false,
   'oversized temporary upload spools must be removed after publishing');
  // A previously-published old 10 MiB video must remain viewable even
  // when this provider's NEW anonymous upload cap is only 4 MiB.
  await gateway.close();gateway=null;
  const legacy=mp4(7*MiB);
  const legacyCid=(await unixfs(ipfs).addBytes(legacy)).toString();
  const existing=JSON.parse(await readFile(manifestFile,'utf8'));
  existing[legacyCid]={type:'video/mp4',bytes:legacy.length,
   time:Date.now()-86400000,codec:'unixfs',sha256:hash(legacy)};
  await writeFile(manifestFile,JSON.stringify(existing));
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',
   manifestFile,uploadEnabled:false,maxTotal:160*MiB});
  const preserved=await fetch('http://127.0.0.1:'+gateway.port+
   '/ipfs/'+legacyCid,{headers:{range:'bytes=65-128'}});
  assert.equal(preserved.status,206);
  assert.deepEqual(Buffer.from(await preserved.arrayBuffer()),
   legacy.subarray(65,129));
 }finally{
  try{await gateway?.close()}catch{}
  try{await ipfs?.stop()}catch{}
  await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
