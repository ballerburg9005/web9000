import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {classifyNetworkObservation} from './source-compartments.mjs';
import {AdaptiveTierRouter} from './adaptive-tier-router.mjs';

const secret=Buffer.alloc(32,0x71);
const region=(country,networkKind,asn,networkPrefix)=>({
  provenance:'operator-observed',country,networkKind,asn,networkPrefix
});
test('trusted source country/ASN/VPN/DC/network prefix chooses opaque stable compartments, never national denial',()=>{
  const vpn=region('DE','vpn','AS64500','203.0.113.0/24');
  const dc=region('DE','datacenter','AS64500','203.0.113.0/24');
  const mobile=region('DE','mobile','AS64500','203.0.113.0/24');
  const abroad=region('FR','vpn','AS64500','203.0.113.0/24');
  const otherAsn=region('DE','vpn','AS64501','203.0.113.0/24');
  const otherPrefix=region('DE','vpn','AS64500','198.51.100.0/24');
  const a=classifyNetworkObservation(vpn,{secret});
  assert.equal(a.observationAccepted,true);
  assert.equal(a.class,'concentrated');
  assert.deepEqual(a,classifyNetworkObservation(vpn,{secret}));
  assert.notEqual(a.bucket,classifyNetworkObservation(dc,{secret}).bucket);
  assert.notEqual(a.bucket,classifyNetworkObservation(mobile,{secret}).bucket);
  assert.notEqual(a.bucket,classifyNetworkObservation(abroad,{secret}).bucket);
  assert.notEqual(a.bucket,classifyNetworkObservation(otherAsn,{secret}).bucket);
  assert.notEqual(a.bucket,classifyNetworkObservation(otherPrefix,{secret}).bucket);
  assert.notEqual(a.bucket,classifyNetworkObservation(vpn,{
    secret:Buffer.alloc(32,0x7c)}).bucket);
  assert.ok(!JSON.stringify(a).includes('DE'));
  assert.ok(!JSON.stringify(a).includes('203.0.113'));
  assert.ok(!JSON.stringify(a).includes('64500'));
  assert.equal(classifyNetworkObservation({...vpn,provenance:'browser-header'},
    {secret}).bucket,'general','untrusted user classification falls back to shared box');
  assert.equal(classifyNetworkObservation(null,{secret}).bucket,'general');
  assert.equal(classifyNetworkObservation({...vpn,networkPrefix:'203.0.113.8/32'},
    {secret}).bucket,
    classifyNetworkObservation({...vpn,networkPrefix:'invalid'}, {secret}).bucket,
    'individual-IP /32 cannot create another compartment');
});

test('saturated VPN/hosting compartment is isolated while other zero-karma country and residential boxes continue',async()=>{
  const rows=new Map();
  let timestamp=840000;
  const router=new AdaptiveTierRouter({
    openShard:async name=>{
      const entries=[];rows.set(name,entries);
      return {address:'/orbitdb/'+name,publish:async event=>{entries.push(event);},
        close:async()=>{}};
    },
    now:()=>timestamp,namePrefix:'w9-adaptive-isolation',secret,
    entryBudget:200,entryCompartmentBudget:4,sourceBudget:30,
    authorBudget:200,maxBoxes:6,maxShards:20
  });
  const one=await generateIdentity(),two=await generateIdentity();
  const vpn=region('US','vpn','AS64523','198.51.100.0/24');
  const home=region('US','residential','AS64524','203.0.113.0/24');
  const abroad=region('PL','datacenter','AS64523','192.0.2.0/24');
  const make=async (author,title)=>signEvent(author,{
    body:{title,text:'Independent source compartment remains available'}
  });
  try{
    let firstBox=null;
    for(let i=0;i<10;i++){
      const result=await router.offer(await make(one,'vpn attempt '+i),{
        sourceObservation:vpn,sourceCohort:'claimed-fake-country'
      });
      if(i===0){assert.equal(result.accepted,true);firstBox=result.compartment;}
      if(i>=4)assert.equal(result.accepted,false);
    }
    assert.equal(router.status.counts.accepted,4);
    const quiet=await router.offer(await make(two,'ordinary honest post'),{
      sourceObservation:home
    });
    const foreign=await router.offer(await make(two,'unrelated country post'),{
      sourceObservation:abroad
    });
    assert.equal(quiet.accepted,true);
    assert.equal(foreign.accepted,true);
    assert.notEqual(quiet.compartment,firstBox);
    assert.notEqual(foreign.compartment,firstBox);
    assert.notEqual(quiet.address,foreign.address);
    assert.ok(!JSON.stringify(router.status).includes('198.51.100.0'));
    assert.ok(!JSON.stringify(router.status).includes('US'));
    assert.ok(rows.size>=3,'real independent database names for each compartment');
    // The signed author's arbitrary source claims do not control the box.
    assert.equal(classifyNetworkObservation(
      {...vpn,provenance:'client-claimed'}, {secret}).bucket,'general');
    // Reset the local window: classification is NOT a persistent ban.
    timestamp+=60000;
    const renewed=await router.offer(await make(one,'vpn user after quiet minute'),{
      sourceObservation:vpn
    });
    assert.equal(renewed.accepted,true);
    assert.equal(renewed.compartment,firstBox);
  }finally{await router.close();}
});

test('attacker cannot create unlimited compartments from garbage and an overflow pool remains bounded',async()=>{
  const opened=[];
  let timestamp=900000;
  const router=new AdaptiveTierRouter({
    now:()=>timestamp,namePrefix:'w9-adaptive-geo-cap',secret,
    maxBoxes:3,maxShards:8,entryBudget:200,
    entryCompartmentBudget:5,sourceBudget:10,authorBudget:50,
    openShard:async name=>{
      opened.push(name);
      return {address:'/orbitdb/'+name,publish:async()=>{},close:async()=>{}};
    }
  });
  const signer=await generateIdentity();
  try{
    for(let i=0;i<100;i++){
      const malicious={payload:{author:signer.author,kind:'post'},
        id:'sha256:'+i.toString(16).padStart(64,'0'),signature:'not-a-signature'};
      await router.offer(malicious,{sourceObservation:region(
        'US','vpn','AS'+(65000+i),'198.51.100.0/24')});
    }
    assert.equal(router.status.compartments.length,0,
      'fake signatures cannot occupy the finite geographic boxes');
    assert.equal(opened.length,0);
    timestamp+=60000; // attacker used up this admission window; retries reset quotas
    for(let i=0;i<8;i++){
      const regionObs=region('US','vpn','AS'+(65000+i),'198.51.100.0/24');
      const signed=await signEvent(signer,{body:{title:'valid '+i,text:'content'}});
      const result=await router.offer(signed,{sourceObservation:regionObs});
      assert.equal(result.accepted,true);
      if(i>=3)assert.equal(result.compartment,'overflow');
    }
    assert.equal(router.status.compartments.length,3);
    assert.equal(router.status.shards.length,4);
  }finally{await router.close();}
});

test('separate source compartments persist across both entry and independently attested sponsored tiers, without trusting event body origin claims',async()=>{
  let timestamp=1200000;
  const proofOwner=await generateIdentity(),anon=await generateIdentity();
  const rows=new Map();
  const router=new AdaptiveTierRouter({
    now:()=>timestamp,secret,maxBoxes:5,maxShards:12,
    namePrefix:'w9-adaptive-multiple-trust',
    entryBudget:100,sponsoredBudget:50,entryCompartmentBudget:10,
    sourceBudget:30,authorBudget:30,
    verifyAttestation:async ({author,evidence})=>
      author===proofOwner.author&&evidence==='verified-sponsor'?
        {verification:'independent',subject:author,
          className:'sponsored',validUntil:timestamp+120000}:null,
    openShard:async name=>{
      const data=[];rows.set(name,data);
      return {address:'/orbitdb/'+name,publish:async event=>data.push(event),
        close:async()=>{}};
    }
  });
  const vpn=region('NL','vpn','AS64444','203.0.113.0/24');
  const residential=region('NL','residential','AS64444','203.0.113.0/24');
  const publish=async(owner,observed,title)=>{
    const signed=await signEvent(owner,{
      body:{title,text:'signed metadata',
        fields:{country:'GB',networkKind:'residential',
          sourceObservation:residential}}
    });
    return router.offer(signed,{sourceObservation:observed});
  };
  try{
    assert.equal((await router.registerAttestation(
      proofOwner.author,'verified-sponsor',{sourceCohort:'operator-received-proof'}
    )).qualified,true);
    const unverifiedVpn=await publish(anon,vpn,'vpn entry');
    const verifiedVpn=await publish(proofOwner,vpn,'vpn sponsored');
    const verifiedResidential=await publish(proofOwner,residential,'home sponsored');
    assert.equal(unverifiedVpn.className,'entry');
    assert.equal(verifiedVpn.className,'sponsored');
    assert.equal(verifiedResidential.className,'sponsored');
    assert.equal(unverifiedVpn.compartment,verifiedVpn.compartment,
      'operator source compartment independent of trust class');
    assert.notEqual(verifiedVpn.compartment,verifiedResidential.compartment);
    assert.notEqual(unverifiedVpn.shard,verifiedVpn.shard);
    assert.notEqual(verifiedVpn.shard,verifiedResidential.shard);
    assert.ok(verifiedVpn.shard.includes('sponsored'));
    assert.ok(unverifiedVpn.shard.includes('entry'));
    assert.ok(!verifiedVpn.shard.includes('NL'));
    assert.ok(!verifiedVpn.shard.includes('203.0.113'));
    assert.equal(rows.size,3);
  }finally{await router.close();}
});

test('local hard database count bound refuses additional physical compartments without converting geography into a global author ban',async()=>{
  let clock=930000;
  const owner=await generateIdentity();
  const records=new Map();
  const router=new AdaptiveTierRouter({
    now:()=>clock,secret,maxShards:2,maxBoxes:3,
    entryBudget:200,entryCompartmentBudget:30,sourceBudget:30,
    authorBudget:100,namePrefix:'w9-adaptive-physical-cap',
    openShard:async name=>{
      const values=[];records.set(name,values);
      return {address:'/orbitdb/'+name,publish:async event=>values.push(event),
        close:async()=>{}};
    }
  });
  const make=async i=>signEvent(owner,{
    body:{title:'legitimate '+i,text:'original record'}
  });
  try{
    const cases=[
      region('US','vpn','AS64900','198.51.100.0/24'),
      region('NL','vpn','AS64901','203.0.113.0/24'),
      region('JP','datacenter','AS64902','192.0.2.0/24')
    ];
    for(let i=0;i<2;i++){
      const result=await router.offer(await make(i),{sourceObservation:cases[i]});
      assert.equal(result.accepted,true);
    }
    const limited=await router.offer(await make(2),{sourceObservation:cases[2]});
    assert.equal(limited.accepted,false);
    assert.equal(limited.reason,'operator-shard-capacity');
    assert.equal(records.size,2);
    clock+=60000;
    const restored=await router.offer(await make(3),{
      sourceObservation:cases[0]
    });
    assert.equal(restored.accepted,true,
      'existing full-capacity shard remains accessible in a new window');
  }finally{await router.close();}
});
