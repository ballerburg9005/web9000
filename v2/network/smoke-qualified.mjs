import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {createOrbitDB} from '@orbitdb/core';
import {openQualifiedIndex} from './qualified-index.js';
import {openPublicIndex} from './orbit-index.js';
import {generateIdentity,signEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';

const dir=await mkdtemp(path.join(os.tmpdir(),'w9-qualified-'));
let libp2p,ipfs,orbitdb,raw,qualified;
try{
 libp2p=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
 ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(dir,'blocks'))});
 orbitdb=await createOrbitDB({ipfs,directory:path.join(dir,'orbitdb')});
 raw=await openPublicIndex(orbitdb,'w9-raw-lane');
 qualified=await openQualifiedIndex(orbitdb,'w9-qualified-lane',
   {verifyQualification:async ({evidence})=>
     evidence==='independent-test-verifier'?{qualified:true,verification:'independent'}:{qualified:false}});
 assert.notEqual(raw.address,qualified.address,'different indexes are a hard data separation');
 const author=await generateIdentity(),another=await generateIdentity();
 const first=await signEvent(author,{space:'cats',body:{title:'Unstaked but still valid',text:'nobody owns cats'}});
 const second=await signEvent(another,{space:'cats',body:{title:'Verified separately',text:'same namespace'}});
 await raw.publish(first);await raw.publish(second);
 await assert.rejects(qualified.publish(first),/Cannot admit unverified/);
 await qualified.publish(second,'independent-test-verifier');
 const rawReplica=new Replica(),qualifiedReplica=new Replica();
 await raw.loadInto(rawReplica);await qualified.loadInto(qualifiedReplica);
 assert.equal(rawReplica.size,2);assert.equal(qualifiedReplica.size,1);
 assert.equal(rawReplica.get(first.id)!==null,true);
 assert.equal(qualifiedReplica.get(first.id),null);
 assert.equal(qualifiedReplica.get(second.id)!==null,true);
 console.log('PASS permissionless raw index and separate independently curated qualified index');
}finally{
 try{await qualified?.close();}catch{}
 try{await raw?.close();}catch{}
 try{await orbitdb?.stop();}catch{}
 try{await ipfs?.stop();}catch{}
 try{await libp2p?.stop();}catch{}
 await rm(dir,{recursive:true,force:true});
}
