import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {createImageGateway,MEDIA_LIMITS} from './media-node.mjs';
import {changeOperatorQuarantine,readOperatorQuarantine} from './media-quarantine.mjs';
import {importMediaCID} from './mirror-media.mjs';
test('opt-in image peer stores genuine content-addressed raw IPFS blocks and refuses unsafe files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'web9000-media-'));
 let peer,ipfs,gateway;
 try{
  peer=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
  ipfs=await createHelia({libp2p:peer,blockstore:new LevelBlockstore(join(dir,'blocks'))});
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',manifestFile:join(dir,'images.json'),uploadEnabled:true,maxTotal:1024});
  const url='http://127.0.0.1:'+gateway.port;
  const tiny=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68]);
  const reply=await fetch(url+'/upload',{method:'POST',headers:{'content-type':'image/png'},body:tiny});
  assert.equal(reply.status,201);
  const meta=await reply.json();assert.ok(meta.cid.startsWith('ipfs://'));
  const image=await fetch(url+'/ipfs/'+meta.cid.slice(7));
  assert.equal(image.status,200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),tiny);
  const invalid=await fetch(url+'/upload',{method:'POST',headers:{'content-type':'image/png'},body:'not an actual png'});
  assert.equal(invalid.status,415);
  const huge=await fetch(url+'/upload',{method:'POST',headers:{'content-type':'image/png'},body:Buffer.alloc(262145)});
  assert.equal(huge.status,413);
  const health=await(await fetch(url+'/health')).json();assert.equal(health.images,1);
  console.log('PASS independent media node stores real, bounded IPFS raw-block images');
 }finally{
  try{await gateway?.close();}catch{}
  try{await ipfs?.stop();}catch{}
  try{await peer?.stop();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});

test('explicit opt-in UnixFS media accepts 10 MiB bounded audio/video and supports HTTP seek ranges',async()=>{
 assert.equal(MEDIA_LIMITS['audio/mpeg'],10*1024*1024);
 assert.equal(MEDIA_LIMITS['video/mp4'],10*1024*1024);
 const dir=await mkdtemp(join(tmpdir(),'web9000-unixfs-'));
 let peer,ipfs,gateway;
 try{
  peer=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
   services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
  ipfs=await createHelia({libp2p:peer,blockstore:new LevelBlockstore(join(dir,'blocks'))});
  const manifestFile=join(dir,'all-media.json');
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',manifestFile,
   uploadEnabled:true,richMediaEnabled:false,maxTotal:20*1024*1024});
  const url='http://127.0.0.1:'+gateway.port;
  const video=await readFile(new URL('../../thumb/thumb10.mp4',import.meta.url));
  const audio=await readFile(new URL('../../content/festival_theme.mp3',import.meta.url));
  assert.equal((await fetch(url+'/upload',{method:'POST',
   headers:{'content-type':'video/mp4'},body:video})).status,403,
   'image-only peer never implicitly admits video');
  await gateway.close();
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',manifestFile,
   uploadEnabled:true,richMediaEnabled:true,maxTotal:20*1024*1024,
   trustedProxyAddress:'127.0.0.1'});
  const origin='http://127.0.0.1:'+gateway.port;
  const soundResponse=await fetch(origin+'/upload',{method:'POST',
   headers:{'content-type':'audio/mpeg','x-real-ip':'203.0.113.5'},body:audio});
  assert.equal(soundResponse.status,201);
  const sound=await soundResponse.json();
  assert.equal(sound.type,'audio/mpeg');
  assert.ok(sound.cid.startsWith('ipfs://'));
  const present=await fetch(origin+'/have/'+sound.cid.slice(7));
  assert.equal(present.status,200);
  const descriptor=await present.json();
  assert.equal(descriptor.available,true);
  assert.equal(descriptor.cid,sound.cid);
  assert.equal((await fetch(origin+'/have/'+('z'.repeat(60)))).status,404,
    'a missing CID is not claimed as available');
  const soundBytes=await fetch(origin+'/ipfs/'+sound.cid.slice(7));
  assert.equal(soundBytes.status,200);
  assert.equal(soundBytes.headers.get('content-type'),'audio/mpeg');
  assert.deepEqual(Buffer.from(await soundBytes.arrayBuffer()),audio);
  // Local CID quarantine stops this operator's media delivery immediately,
  // while keeping the signed database, CID, and independent peers untouched.
  const quarantines=manifestFile+'.quarantine.json';
  await changeOperatorQuarantine({file:quarantines,action:'add',cid:sound.cid,
    reason:'Local operator review (test)'});
  assert.equal((await fetch(origin+'/ipfs/'+sound.cid.slice(7))).status,403);
  assert.equal((await fetch(origin+'/have/'+sound.cid.slice(7))).status,404,
    'local quarantine hides availability claims from this operator');
  assert.equal((await fetch(origin+'/ipfs/'+sound.cid.slice(7),{method:'HEAD'})).status,403);
  assert.equal((await readOperatorQuarantine(quarantines)).size,1);
  await changeOperatorQuarantine({file:quarantines,action:'remove',cid:sound.cid});
  assert.equal((await fetch(origin+'/ipfs/'+sound.cid.slice(7))).status,200,
    'local reversal restores media access without recreating any signed event');

  // Test a UnixFS DAG larger than one normal IPFS raw block, with media
  // format header intact, and verify byte-addressable seeking.
  const large=Buffer.concat([video,Buffer.alloc(2*1024*1024,3)]);
  const vr=await fetch(origin+'/upload',{method:'POST',
   headers:{'content-type':'video/mp4','x-real-ip':'203.0.113.5'},body:large});
  assert.equal(vr.status,201);
  const vm=await vr.json();
  assert.equal(vm.type,'video/mp4');
  const head=await fetch(origin+'/ipfs/'+vm.cid.slice(7),{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(Number(head.headers.get('content-length')),large.length);
  assert.equal(head.headers.get('accept-ranges'),'bytes');
  const range=await fetch(origin+'/ipfs/'+vm.cid.slice(7),{
   headers:{range:'bytes=101-400'}});
  assert.equal(range.status,206);
  assert.equal(range.headers.get('content-range'),'bytes 101-400/'+large.length);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),large.subarray(101,401));
  const endRange=await fetch(origin+'/ipfs/'+vm.cid.slice(7),{
   headers:{range:'bytes=-25'}});
  assert.equal(endRange.status,206);
  assert.deepEqual(Buffer.from(await endRange.arrayBuffer()),large.subarray(-25));
  assert.equal((await fetch(origin+'/ipfs/'+vm.cid.slice(7),{
   headers:{range:'bytes=999999999-999999999'}})).status,416);
  const invalid=await fetch(origin+'/upload',{method:'POST',
   headers:{'content-type':'video/mp4','x-real-ip':'203.0.113.5'},body:Buffer.from('not an mp4')});
  assert.equal(invalid.status,429,
   'a third rich-media upload is refused by the operator daily rate limit');
  const info=await(await fetch(origin+'/health')).json();
  assert.equal(info.files,2);
  assert.equal(info.images,0);
  assert.equal(info.richMediaEnabled,true);
  assert.equal(info.audioLimit,10*1024*1024);
  assert.equal(info.videoLimit,10*1024*1024);
  assert.equal(info.richUploadsPerClientPerDay,2);
  const quotaText=await readFile(manifestFile+'.quotas.json','utf8');
  assert.equal(quotaText.includes('203.0.113.5'),false,'stored quota keys do not expose literal client IPs');
  await gateway.close();
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',
   manifestFile,uploadEnabled:true,richMediaEnabled:true,
   trustedProxyAddress:'127.0.0.1',maxTotal:20*1024*1024});
  const restarted='http://127.0.0.1:'+gateway.port;
  await changeOperatorQuarantine({file:quarantines,action:'add',cid:vm.cid,
    reason:'Revocable local review across restart'});
  assert.equal((await fetch(restarted+'/ipfs/'+vm.cid.slice(7))).status,403);
  await changeOperatorQuarantine({file:quarantines,action:'remove',cid:vm.cid});
  assert.equal((await fetch(restarted+'/ipfs/'+vm.cid.slice(7),{headers:{range:'bytes=0-1'}})).status,206);

  assert.equal((await fetch(restarted+'/upload',{method:'POST',
   headers:{'content-type':'audio/mpeg','x-real-ip':'203.0.113.5'},body:audio})).status,429,
   'per-client daily quota survives a media peer restart');
  assert.equal((await fetch(restarted+'/upload',{method:'POST',
   headers:{'content-type':'audio/mpeg','x-real-ip':'203.0.113.6'},body:audio})).status,201,
   'trusted reverse-proxy addresses produce independent client quotas');
  await gateway.close();
  gateway=await createImageGateway({ipfs,port:0,host:'127.0.0.1',
   manifestFile,uploadEnabled:false});
  const again=await fetch('http://127.0.0.1:'+gateway.port+'/ipfs/'+vm.cid.slice(7));
  assert.deepEqual(Buffer.from(await again.arrayBuffer()),large,
   'operator read-only restarts retain the independently pinned UnixFS bytes');
  console.log('PASS opt-in independently stored chunked audio/video IPFS UnixFS with 206 seeks');
 }finally{
  try{await gateway?.close();}catch{}
  try{await ipfs?.stop();}catch{}
  try{await peer?.stop();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
test('an independent media operator explicitly mirrors a CID and decides local serving',async()=>{
 const dirs=[await mkdtemp(join(tmpdir(),'web9000-source-media-')),
             await mkdtemp(join(tmpdir(),'web9000-mirror-media-'))];
 const nodes=[],ipfsNodes=[],gateways=[];
 try{
  for(const dir of dirs){
   const peer=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
   nodes.push(peer);
   const ipfs=await createHelia({libp2p:peer,blockstore:new LevelBlockstore(join(dir,'blocks'))});
   ipfsNodes.push(ipfs);
   gateways.push(await createImageGateway({ipfs,port:0,host:'127.0.0.1',
    manifestFile:join(dir,'media.json'),uploadEnabled:true,richMediaEnabled:true}));
  }
  const original='http://127.0.0.1:'+gateways[0].port;
  const independent='http://127.0.0.1:'+gateways[1].port;
  const video=await readFile(new URL('../../thumb/thumb10.mp4',import.meta.url));
  const upload=await fetch(original+'/upload',{
   method:'POST',headers:{'content-type':'video/mp4'},body:video
  });
  assert.equal(upload.status,201);
  const {cid}=await upload.json();
  assert.equal((await fetch(independent+'/ipfs/'+cid.slice(7))).status,404,
    'mere signed CID knowledge does not cause binary replication');
  const copied=await importMediaCID({cid,sourceBase:original,targetBase:independent});
  assert.equal(copied.cid,cid,'separately importing must retain identical IPFS CID');
  assert.deepEqual(Buffer.from(await(await fetch(independent+'/ipfs/'+cid.slice(7))).arrayBuffer()),video);
  // Operator refusal affects only the selected peer. The original still
  // serves the same CID, and local removal is reversible without republication.
  const file=join(dirs[1],'media.json.quarantine.json');
  await changeOperatorQuarantine({file,action:'add',cid,reason:'Operator test review'});
  assert.equal((await fetch(independent+'/ipfs/'+cid.slice(7))).status,403);
  assert.equal((await fetch(original+'/ipfs/'+cid.slice(7))).status,200);
  await changeOperatorQuarantine({file,action:'remove',cid});
  assert.equal((await fetch(independent+'/ipfs/'+cid.slice(7))).status,200);
  console.log('PASS opt-in independent IPFS CID mirroring and peer-local refusal');
 }finally{
  for(const gateway of gateways.reverse())try{await gateway.close();}catch{}
  for(const ipfs of ipfsNodes.reverse())try{await ipfs.stop();}catch{}
  for(const peer of nodes.reverse())try{await peer.stop();}catch{}
  for(const dir of dirs)await rm(dir,{recursive:true,force:true});
 }
});
