import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
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
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';
import {createOrbitDB} from '@orbitdb/core';
import {openPublicIndex} from './orbit-index.js';
import {Replica} from '../core/replica.js';
import {generateIdentity,signEvent} from '../core/events.js';
import * as dagPB from '@ipld/dag-pb';
import {createImageGateway} from './media-node.mjs';
import {changeOperatorQuarantine} from './media-quarantine.mjs';
import {createMediaBitswapPolicy} from './media-bitswap-policy.mjs';

const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68]);
const buffer=async chunks=>{
 const parts=[];for await(const chunk of chunks)parts.push(Buffer.from(chunk));
 return Buffer.concat(parts);
};
test('direct libp2p Bitswap block requests respect operator quarantine for raw and UnixFS child blocks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'w9-p2p-refusal-'));
 const peers=[];
 async function peer(name,{manifestFile}={}){
  const libp2p=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
   services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
  const backing=new LevelBlockstore(join(root,name,'blocks'));
  const policy=manifestFile?createMediaBitswapPolicy({manifestFile,localBlockstore:backing}):null;
  const ipfs=await createHelia({libp2p,blockstore:backing,
   ...(policy?{blockBrokers:policy.blockBrokers}:{})});
  const node={libp2p,ipfs,policy,orbitdb:undefined,db:[],
   async stop(){
    for(const d of this.db.reverse())await d.close();
    if(this.orbitdb)await this.orbitdb.stop();
    await ipfs.stop();
   }};
  peers.push(node);
  return node;
 }
 async function remoteRead(from,cid,server){
  return buffer(from.ipfs.blockstore.get(cid,{
   providers:[server.libp2p.peerId],
   signal:AbortSignal.timeout(6000)
  }));
 }
 try{
  const manifestFile=join(root,'media-manifest.json');
  const source=await peer('operator',{manifestFile});
  const gateway=await createImageGateway({ipfs:source.ipfs,host:'127.0.0.1',port:0,
   manifestFile,uploadEnabled:true,richMediaEnabled:true,maxTotal:20*1024*1024});
  try{
   const url='http://127.0.0.1:'+gateway.port;
   const upload=async (type,bytes)=>{
    const result=await fetch(url+'/upload',{method:'POST',headers:{'content-type':type},body:bytes});
    assert.equal(result.status,201,'upload accepted');
    const v=await result.json();return CID.parse(v.cid.slice(7));
   };
   const img=await upload('image/png',PNG);
   const video=await readFile(new URL('../../thumb/thumb10.mp4',import.meta.url));
   const big=Buffer.concat([video,Buffer.alloc(1024*1024,15)]);
   const file=await upload('video/mp4',big);
   const dag=dagPB.decode(await buffer(source.ipfs.blockstore.get(file,{offline:true})));
   assert.ok(dag.Links.length>0,'test UnixFS large enough to have chunk links');
   const chunk=dag.Links[0].Hash;
   assert.ok(chunk,'UnixFS child block present');
   assert.equal(await source.policy.maySend(img),true);
   assert.equal(await source.policy.maySend(file),true);
   assert.equal(await source.policy.maySend(chunk),true);
   const remote=await peer('before');
   await remote.libp2p.dial(source.libp2p.getMultiaddrs()[0]);
   assert.deepEqual(await remoteRead(remote,img,source),PNG);
   // A media-serving peer must still replicate signed metadata through
   // the same shared libp2p/Helia instance.
   source.orbitdb=await createOrbitDB({ipfs:source.ipfs,
    directory:join(root,'operator','orbitdb')});
   remote.orbitdb=await createOrbitDB({ipfs:remote.ipfs,
    directory:join(root,'before','orbitdb')});
   const index=await openPublicIndex(source.orbitdb,'p2p-policy-metadata-test');
   source.db.push(index);
   const signer=await generateIdentity();
   const signed=await signEvent(signer,{space:'not-a-namespace-owner',
    body:{title:'Metadata survives media refusal',text:'Reader sees independent signed posts'}});
   await index.publish(signed);
   const mirror=await openPublicIndex(remote.orbitdb,index.address);
   remote.db.push(mirror);
   const replica=new Replica();
   const until=Date.now()+18000;
   while(Date.now()<until&&!replica.get(signed.id)){
    await mirror.loadInto(replica);
    if(!replica.get(signed.id))await new Promise(resolve=>setTimeout(resolve,250));
   }
   assert.ok(replica.get(signed.id),'OrbitDB metadata still replicates with Bitswap media policy');
   const childData=await remoteRead(remote,chunk,source);
   assert.ok(childData.length>0,'Bitswap actually served a child block');
   const unknown=await upload('image/png',Buffer.concat([PNG,Buffer.from([3])]));
   // A raw block stored locally but omitted from the operator manifest must
   // NOT become an automatically volunteered public IPFS file.
   const orphanBytes=Buffer.from('Unpublished rejected media bytes');
   const orphanCID=CID.createV1(raw.code,await sha256.digest(orphanBytes));
   await source.ipfs.blockstore.put(orphanCID,orphanBytes);
   assert.equal(await source.policy.maySend(orphanCID),false);
   // The GET view is blocked only after operator acts.
   await changeOperatorQuarantine({file:manifestFile+'.quarantine.json',
    action:'add',cid:'ipfs://'+img.toString(),reason:'P2P test'});
   await changeOperatorQuarantine({file:manifestFile+'.quarantine.json',
    action:'add',cid:'ipfs://'+file.toString(),reason:'P2P test'});
   assert.equal(await source.policy.maySend(img),false);
   assert.equal(await source.policy.maySend(file),false);
   assert.equal(await source.policy.maySend(chunk),false);
   // Quarantining media never removes or suppresses independent signed
   // metadata in the same underlying libp2p peer.
   const afterBlock=await signEvent(signer,{space:'not-a-namespace-owner',
    body:{title:'Signed speech survives P2P refusal',text:'Media and metadata remain separate'}});
   await index.publish(afterBlock);
   const untilAfter=Date.now()+18000;
   while(Date.now()<untilAfter&&!replica.get(afterBlock.id)){
    await mirror.loadInto(replica);
    if(!replica.get(afterBlock.id))await new Promise(resolve=>setTimeout(resolve,250));
   }
   assert.ok(replica.get(afterBlock.id),'quarantine must not block signed posts from other peers');
   assert.equal((await fetch(url+'/ipfs/'+img)).status,403);
   const blockedPeer=await peer('after-quarantine');
   await blockedPeer.libp2p.dial(source.libp2p.getMultiaddrs()[0]);
   await assert.rejects(remoteRead(blockedPeer,img,source),
    'remote raw CID should not be retrievable through Bitswap');
   await assert.rejects(remoteRead(blockedPeer,chunk,source),
    'remote UnixFS child CID should not be retrievable through Bitswap');
   // Newly uploaded and explicitly retained media can still be fetched.
   assert.deepEqual(await remoteRead(blockedPeer,unknown,source),
    Buffer.concat([PNG,Buffer.from([3])]));
   await assert.rejects(remoteRead(blockedPeer,orphanCID,source),
    'unmanifested blocks cannot leak through Bitswap');
   // Corrupt operator policy must fail closed for both HTTP and IPFS P2P.
   await writeFile(manifestFile+'.quarantine.json','{malformed', {mode:0o600});
   assert.equal(await source.policy.maySend(unknown),false);
   assert.equal((await fetch(url+'/ipfs/'+unknown)).status,503);
   await writeFile(manifestFile+'.quarantine.json',JSON.stringify({version:1,blocked:[
    {cid:img.toString(),reason:'P2P test'},
    {cid:file.toString(),reason:'P2P test'}
   ]}),{mode:0o600});
   assert.equal(await source.policy.maySend(unknown),true);
   const safeManifest=await readFile(manifestFile,'utf8');
   await writeFile(manifestFile,'{truncated',{mode:0o600});
   assert.equal(await source.policy.maySend(unknown),false,
    'corrupt manifest must fail closed for outgoing P2P media');
   await writeFile(manifestFile,safeManifest,{mode:0o600});
   assert.equal(await source.policy.maySend(unknown),true,
    'restoring operator manifest restores P2P availability');
   await changeOperatorQuarantine({file:manifestFile+'.quarantine.json',
    action:'remove',cid:'ipfs://'+img.toString()});
   await changeOperatorQuarantine({file:manifestFile+'.quarantine.json',
    action:'remove',cid:'ipfs://'+file.toString()});
   assert.equal(await source.policy.maySend(img),true);
   const unblocked=await peer('after-reversal');
   await unblocked.libp2p.dial(source.libp2p.getMultiaddrs()[0]);
   assert.deepEqual(await remoteRead(unblocked,img,source),PNG);
   assert.deepEqual(await remoteRead(unblocked,chunk,source),childData);
  }finally{await gateway.close();}
 }finally{for(const n of peers.reverse())try{await n.stop();}catch{}await rm(root,{recursive:true,force:true});}
});
