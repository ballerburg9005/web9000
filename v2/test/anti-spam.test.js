import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {DEFAULT_ANTI_SPAM,checkStakeEvidence,qualifyingLane,localRateDecision,
  calculateSponsorLiability,auditSuppression} from '../core/anti-spam.js';
test('default qualified replication requires independently checked stake of at least $10 with meaningful lock',()=>{
 const now=Date.UTC(2026,10,18),base={
   verification:'independently-checked-on-chain',active:true,exitRequested:false,
   usdValue:10.01,lockedAt:now-8*86400000,
   withdrawalNotBefore:now+8*86400000,chainId:8453,contract:'0xabc',
   blockHash:'0x'+'a'.repeat(64)
 };
 assert.equal(DEFAULT_ANTI_SPAM.minStakeUsd,10);
 assert.equal(checkStakeEvidence(base,{now}).qualified,true);
 assert.equal(qualifyingLane({stake:base,now}).lane,'qualified');
 assert.equal(qualifyingLane({stake:{...base,usdValue:9.99},now}).lane,'raw');
 assert.equal(qualifyingLane({stake:{...base,verification:'claimed-by-publisher'},now}).lane,'raw');
 assert.equal(qualifyingLane({stake:{...base,withdrawalNotBefore:now+1000},now}).lane,'raw');
 assert.equal(qualifyingLane({now}).lane,'raw');
});
test('signed posts remain valid after local caps or refusal from qualified index',async()=>{
 const identity=await generateIdentity();
 const old=[];
 for(let i=0;i<5;i++)old.push(await signEvent(identity,{body:{title:'post',text:String(i)}}));
 const next=await signEvent(identity,{body:{title:'sixth',text:'still valid'}});
 assert.equal(localRateDecision(next,old).allow,false);
 assert.equal(await verifyEvent(next),true);
 const audit=auditSuppression(next,{lane:'qualified',reason:'temporary per-identity limit'});
 assert.equal(audit.eventId,next.id);
 assert.equal(audit.action,'local-replication-refusal');
});
test('sponsor cascade is capped, acyclic and only follows ratified botspam findings',()=>{
 const edges=[
  {inviter:'parent',invitee:'bot',verified:true,consent:true,active:true},
  {inviter:'grandparent',invitee:'parent',verified:true,consent:true,active:true},
  {inviter:'bot',invitee:'grandparent',verified:true,consent:true,active:true},
  {inviter:'stranger',invitee:'bot',verified:false,consent:true,active:true}
 ];
 const findings=[{subject:'bot',weight:1,verified:true,ratified:true,
  category:'automated-commercial-spam',appealStatus:'confirmed'}];
 const result=calculateSponsorLiability({abusiveAuthor:'bot',verifiedEdges:edges,ratifiedFindings:findings});
 assert.equal(result.get('parent'),10);
 assert.equal(result.get('grandparent'),5);
 assert.equal(result.has('bot'),false);
 assert.equal(result.has('stranger'),false);
 assert.equal(calculateSponsorLiability({abusiveAuthor:'bot',verifiedEdges:edges,
  ratifiedFindings:findings.map(x=>({...x,appealStatus:'overturned'}))}).size,0);
 assert.equal(calculateSponsorLiability({abusiveAuthor:'bot',verifiedEdges:edges,
  ratifiedFindings:[{...findings[0],ratified:false}]}).size,0);
});
