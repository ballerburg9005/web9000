import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
import {createImageGateway} from './media-node.mjs';
test('opt-in image peer stores genuine content-addressed UnixFS bytes and refuses unsafe files',async()=>{
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
  console.log('PASS independent media node stores real, bounded IPFS/UnixFS images');
 }finally{
  try{await gateway?.close();}catch{}
  try{await ipfs?.stop();}catch{}
  try{await peer?.stop();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
