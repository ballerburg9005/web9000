import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {generateIdentity,signEvent} from '../core/events.js';
import {
  AdaptiveTierRouter,openLocalAdaptiveShard,summarizeAttestedOpinions
} from './adaptive-tier-router.mjs';

test('untrusted opinion counts never manufacture higher-tier admission, negative opinions cannot lower entry below zero',async()=>{
  const [author,fan1,fan2,fan3]=await Promise.all(Array.from({length:4},()=>generateIdentity()));
  const votes=[
    {signer:fan1.author,group:'supported',choice:'up',verified:true,observedAt:10},
    {signer:fan2.author,group:'supported',choice:'up',verified:true,observedAt:10},
    {signer:fan3.author,group:'supported',choice:'up',verified:true,observedAt:10},
    {signer:fan3.author,group:'untrusted',choice:'up',verified:true,observedAt:12},
    {signer:fan2.author,group:'low-score',choice:'up',verified:true,observedAt:12},
    {signer:fan1.author,group:'supported',choice:'down',verified:true,observedAt:11},
    {signer:fan1.author,group:'supported',choice:'up',verified:false,observedAt:12}
  ];
  const result=summarizeAttestedOpinions(votes,new Map([
    ['supported',1],['low-score',0.01],['untrusted',0]
  ]));
  assert.equal(result.admissionClass,'entry');
  assert.equal(result.promotionAuthorized,false);
  assert.ok(result.positiveEvidence>0);
  assert.ok(result.negativeOpinion>0);
  assert.equal(result.independentSupportingGroups,2);
  assert.ok(result.positiveEvidence<=1.01);
  // A flood of 100 manufactured raw votes with no verified group confidence
  // changes neither admission class nor resource entitlement.
  const fake=Array.from({length:100},(_,i)=>({
    signer:author.author,group:'fabricated-'+i,choice:'up',verified:false
  }));
  const flooded=summarizeAttestedOpinions([...votes,...fake],new Map([
    ['supported',1],['low-score',0.01]
  ]));
  assert.equal(flooded.positiveEvidence,result.positiveEvidence);
  assert.equal(flooded.admissionClass,'entry');
});

test('physical local OrbitDB tiers are budgeted, split adaptively, preserve prior records, and reject unverified elevation',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'w9-adaptive-physical-'));
  let p2p,ipfs,orbitdb,outsider,outsiderP2P,outsiderIPFS,router;
  const opened=new Map();
  let clock=1000000;
  try{
    p2p=await createLibp2p({
      addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
      transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
      services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
    });
    ipfs=await createHelia({libp2p:p2p,
      blockstore:new LevelBlockstore(path.join(tmp,'blocks'))});
    orbitdb=await createOrbitDB({ipfs,id:'w9-adaptive-curator',
      directory:path.join(tmp,'curator')});
    const signer=await generateIdentity();
    const secondSigner=await generateIdentity();
    router=new AdaptiveTierRouter({
      now:()=>clock,
      maxShards:8,
      entryBudget:100,
      sourceBudget:2,
      authorBudget:200,
      sponsoredBudget:20,
      establishedBudget:20,
      namePrefix:'w9-adaptive-lab',
      secret:Buffer.alloc(32,0x11),
      verifyAttestation:async ({author,evidence})=>{
        if(evidence==='independent-test-proof'&&author===secondSigner.author)
          return {verification:'independent',subject:author,
            className:'sponsored',validUntil:clock+200000};
        return {verification:'untrusted',subject:author,className:'established'};
      },
      openShard:async name=>{
        const db=await openLocalAdaptiveShard(orbitdb,name);
        opened.set(name,db);return db;
      }
    });
    const make=async (who,title)=>signEvent(who,{space:'any-public-name',
      body:{title,text:'Original signed content, no exclusive namespace owner.'}});
    const one=await make(signer,'anonymous creator 1');
    const res1=await router.offer(one,{sourceCohort:'observed-provider-a'});
    assert.equal(res1.accepted,true);
    assert.equal(res1.className,'entry');
    assert.equal(router.status.active.entry,1);
    assert.equal(res1.shard,'w9-adaptive-lab-entry-s000');
    const two=await make(signer,'anonymous creator 2');
    assert.equal((await router.offer(two,{sourceCohort:'observed-provider-a'})).accepted,true);
    // Fresh keys from the same observed source cannot escape the source cap.
    for(let i=0;i<28;i++){
      const newIdentity=await generateIdentity();
      const spam=await make(newIdentity,'new disposable identity '+i);
      const denied=await router.offer(spam,{sourceCohort:'observed-provider-a'});
      assert.equal(denied.accepted,false);
      assert.match(denied.reason,/budget/);
    }
    assert.equal(router.status.active.entry,1);
    assert.equal(router.adapt().entryPartitions,1,
      'one hostile network source must not force many new databases');
    const other=await make(secondSigner,'unpopular but valid original');
    assert.equal((await router.offer(other,{
      sourceCohort:'separate-network',
      attestation:{karma:9999,tenLikes:true,stakedUsd:10000}
    })).className,'entry','author JSON cannot purchase trust');
    for(let i=0;i<28;i++){
      const spam=await make(signer,'another network cohort flood '+i);
      await router.offer(spam,{sourceCohort:'separate-network'});
    }
    assert.equal(router.status.active.entry,2,
      'multi-source flood automatically splits the entry pool');
    assert.equal(router.adapt().entryPartitions,2,
      'manual reads do not cause repeated splitting in one epoch');
    // The first partition's original immutable event is retained after split.
    assert.ok((await opened.get('w9-adaptive-lab-entry-s000').events())
      .some(event=>event.id===one.id));
    clock+=60000;
    const seenShards=new Set();
    for(let i=0;i<40;i++){
      const message=await make(signer,'source fan-out '+i);
      const result=await router.offer(message,{sourceCohort:'independent-network-'+i});
      if(result.accepted)seenShards.add(result.shard);
    }
    assert.equal(seenShards.size,2,'2 active physical indexes receive accepted events');
    const fakeProof=await make(signer,'a self-claimed expert');
    const fakeResult=await router.offer(fakeProof,{
      sourceCohort:'unverified-new-source',attestation:'independent-test-proof'
    });
    assert.equal(fakeResult.className,'entry');
    assert.equal((await router.registerAttestation(secondSigner.author,
      {karma:1000000},{sourceCohort:'observed-provider-a'})).qualified,false);
    const verified=await router.registerAttestation(
      secondSigner.author,'independent-test-proof',
      {sourceCohort:'observed-provider-a'});
    assert.equal(verified.qualified,true);
    const sponsor=await make(secondSigner,'independently eligible');
    const sponsorResult=await router.offer(sponsor,{
      sourceCohort:'observed-provider-a'
    });
    assert.equal(sponsorResult.className,'sponsored');
    assert.equal(sponsorResult.accepted,true);
    assert.notEqual(sponsorResult.address,res1.address);
    assert.ok(opened.get(sponsorResult.shard));
    assert.ok(!JSON.stringify(router.status).includes('observed-provider-a'),
      'source/region observations must not become publicly indexed metadata');
    assert.ok(!JSON.stringify(router.status).includes(secondSigner.author),
      'diagnostics should not expose author-specific reputation');
    assert.ok(router.status.shards.length>=3);
    // The physical shard access controller is restricted to the curator's
    // OrbitDB identity; a second identity cannot directly append around policy.
    outsiderP2P=await createLibp2p({
      addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
      transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
      services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
    });
    outsiderIPFS=await createHelia({libp2p:outsiderP2P,
      blockstore:new LevelBlockstore(path.join(tmp,'outsider-blocks'))});
    await outsiderP2P.dial(p2p.getMultiaddrs()[0]);
    outsider=await createOrbitDB({ipfs:outsiderIPFS,id:'unapproved-orbitdb-writer',
      directory:path.join(tmp,'outsider')});
    const direct=await outsider.open(sponsorResult.address);
    const bypass=await make(signer,'direct append bypass');
    await assert.rejects(direct.add(bypass),
      /not allowed to write|Could not append/,
      'direct writes to curated shard must be denied');
    assert.ok(!(await opened.get(sponsorResult.shard).events())
      .some(event=>event.id===bypass.id));
    // Neither an unverified -100 social score nor proof failure disables
    // permissionless signed-event creation or the next epoch's free lane.
    clock+=60000;
    const negative=await make(signer,'negative social reputation, valid author');
    const accepted=await router.offer(negative,{
      sourceCohort:'new-independent-provider',
      attestation:{negativeVotes:100,rawKarma:-100}
    });
    assert.equal(accepted.accepted,true);
    assert.equal(accepted.className,'entry');
    // A previously qualified subject drops to the free-entry class on
    // short-lived proof expiry without erasing historical signed records.
    clock+=220000;
    const expired=await router.offer(await make(secondSigner,'expired proof'),
      {sourceCohort:'another-new-source'});
    assert.equal(expired.className,'entry');
    // Idle periods can reduce active partition count without erasing
    // signed events or changing the addresses of older physical shards.
    clock+=180000;
    assert.equal(router.adapt().entryPartitions,1,
      'quiet periods merge new-write routing only');
    assert.ok((await opened.get('w9-adaptive-lab-entry-s000').events())
      .some(event=>event.id===one.id));
  }finally{
    if(router)await router.close();
    if(outsider)await outsider.stop();
    if(outsiderIPFS)await outsiderIPFS.stop();
    if(orbitdb)await orbitdb.stop();
    if(ipfs)await ipfs.stop();
    await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});

test('flood budgets and trusted proof checks remain bounded even when many bogus identities share a source',async()=>{
  const signer=await generateIdentity();
  let clock=120000;
  let verifierCalls=0;
  const rows=new Map();
  const router=new AdaptiveTierRouter({
    now:()=>clock,maxShards:16,
    sourceBudget:3,entryBudget:12,authorBudget:100,
    verificationBudget:5,verificationSourceBudget:2,maxPendingAttestations:1,
    secret:Buffer.alloc(32,0x26),
    verifyAttestation:async ({author,evidence})=>{
      verifierCalls++;
      if(evidence==='genuine-operator-check')
        return {verification:'independent',subject:author,
          className:'established',validUntil:clock+30000};
      return {verification:'untrusted',subject:author,className:'established'};
    },
    openShard:async name=>{
      const values=[];
      rows.set(name,values);
      return {address:'/orbitdb/test-'+name,publish:async event=>values.push(event),
        close:async()=>{}};
    }
  });
  try{
    const make=async label=>signEvent(signer,{space:'arbitrary-public',
      body:{title:label,text:'Synthetic event'}});
    for(let i=0;i<30;i++){
      const attempted=await router.registerAttestation(
        signer.author,{karma:9999,stakeUsd:1e9},
        {sourceCohort:'same-observed-cloud-network'});
      assert.equal(attempted.qualified,false);
    }
    assert.equal(verifierCalls,2,'proof-work caps apply before verifier invocation');
    for(let i=0;i<300;i++){
      const event=await make('identity churn probe '+i);
      await router.offer(event,{sourceCohort:'same-observed-cloud-network'});
    }
    assert.equal(router.status.counts.accepted,3,
      'many signed events in one cohort cannot exceed its content budget');
    assert.ok(router.status.counts.limited>=290);
    assert.equal(router.status.active.entry,1,
      'one shared hostile source must not allocate more physical indexes');
    clock+=60000;
    assert.equal((await router.registerAttestation(
      signer.author,'genuine-operator-check',
      {sourceCohort:'same-observed-cloud-network'})).qualified,true);
    assert.equal(verifierCalls,3);
    const signed=await make('attested noncommercial speech');
    const higher=await router.offer(signed,{sourceCohort:'same-observed-cloud-network'});
    assert.equal(higher.className,'established');
    assert.equal(higher.accepted,true,
      'verified pool has its own source budget apart from flooded entry');
    assert.equal(rows.get(higher.shard).length,1);
    clock+=31000;
    const downgraded=await router.offer(await make('proof automatically expired'),
      {sourceCohort:'independent-network'});
    assert.equal(downgraded.className,'entry');
  }finally{await router.close();}
});

test('12,000 fabricated sender identities cannot allocate unbounded DBs or per-signer accounting memory',async()=>{
  const router=new AdaptiveTierRouter({
    openShard:async()=>{throw Error('Unsigned flood must not open a database');},
    now:()=>360000,maxShards:100,entryBudget:12,sourceBudget:4,
    secret:Buffer.alloc(32,0x33)
  });
  let rejected=0;
  for(let i=0;i<12000;i++){
    const fake={id:'sha256:'+i.toString(16).padStart(64,'0'),
      payload:{author:'ed25519:'+i.toString(36).padStart(43,'A'),
        kind:'post',space:'commons'}};
    const response=await router.offer(fake,{
      sourceCohort:'observed-network-'+i
    });
    if(!response.accepted)rejected++;
  }
  assert.equal(rejected,12000);
  const status=router.status;
  assert.equal(status.counts.accepted,0);
  assert.ok(status.accountingSizes.sourceCohorts<=256);
  assert.ok(status.accountingSizes.signerBuckets<=8192);
  assert.ok(status.accountingSizes.quotaKeys<=10000);
  assert.equal(status.shards.length,0,'unverified headers never allocate durable DBs');
  assert.equal(status.active.entry,2,
    'at most one adaptive split per local observation window');
  await router.close();
});
