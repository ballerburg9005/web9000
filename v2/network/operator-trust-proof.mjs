// WEB9000 opt-in operator trust policy: independently check signed, portable
// invitation+acceptance lineage or a quorum-ratified, operator-PINNED group
// branch, then mint a short-lived *operator-local* routing capability.
//
// No global karma, mandatory invite tree, or group namespace ownership.
// CRITICAL: Never use this as proof of Stake4Karma funding. A UI balance,
// unsigned chain snapshot or arbitrary user-provided transaction is NOT a bond.
//
// All proof parsing/verification is CPU-expensive. Call only in an isolated,
// tightly rate-limited proof issuer process, never from the raw content path.
import {evaluateReputation} from '../core/reputation.js';
import {verifyGroupProof} from '../core/group-proof.js';
import {issueIngressCapability} from './ingress-capability.mjs';
import {verifyEvent} from '../core/events.js';

const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const SHA=/^sha256:[0-9a-f]{64}$/;
const CLASSES=new Set(['sponsored','established']);
const MAX_PROOF_EVENTS=36;
const MAX_BYTES=48*1024;
const unique=a=>[...new Set(a)];
const validTime=x=>Number.isSafeInteger(x)&&x>=0;
const fail=reason=>({qualified:false,reason});

export function validateOperatorTrustPolicy(policy){
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||
    Object.keys(policy).some(k=>!['roots','scope','minInviteScore',
      'groupPins','ttlMs'].includes(k)))
   throw Error('Invalid operator trust policy');
 const roots=policy.roots??[],groups=policy.groupPins??[];
 if(!Array.isArray(roots)||roots.length>32||
    roots.some(x=>!AUTHOR.test(x))||unique(roots).length!==roots.length||
    !Array.isArray(groups)||groups.length>20||
    groups.some(g=>!g||typeof g!=='object'||Array.isArray(g)||
      Object.keys(g).sort().join(',')!=='groupId,head'||
      !SHA.test(g.groupId)||!SHA.test(g.head))||
    unique(groups.map(g=>g.groupId)).length!==groups.length||
    typeof policy.scope!=='string'||policy.scope.length<1||
    policy.scope.length>180||
    !Number.isFinite(policy.minInviteScore??30)||
    (policy.minInviteScore??30)<0||(policy.minInviteScore??30)>100||
    !Number.isSafeInteger(policy.ttlMs??60000)||
    (policy.ttlMs??60000)<1000||(policy.ttlMs??60000)>300000)
   throw Error('Invalid operator roots, group pins or invitation policy');
 return Object.freeze({
   roots:Object.freeze([...roots]),scope:policy.scope,
   minInviteScore:policy.minInviteScore??30,
   groupPins:Object.freeze(groups.map(g=>Object.freeze({...g}))),
   ttlMs:policy.ttlMs??60000
 });
}

export async function verifyOperatorTrustEvidence({
 policy,subject,evidence,now=Date.now()
}={}){
 const p=validateOperatorTrustPolicy(policy);
 if(!AUTHOR.test(subject||'')||!validTime(now)||
    !evidence||typeof evidence!=='object'||Array.isArray(evidence)||
    Object.keys(evidence).some(k=>!['kind','events','bundle'].includes(k)))
   return fail('invalid-subject-or-evidence');
 if(evidence.kind==='bilateral-invitation'){
   // This is stronger than a signer-only assertion. There must be an actual
   // signed invitation AND the recipient's separately signed acceptance.
   // The root is explicitly trusted by THIS operator, not by any federation.
   if(!p.roots.length)return fail('no-operator-pinned-invitation-roots');
   const list=evidence.events;
   if(!Array.isArray(list)||list.length<2||
      list.length>MAX_PROOF_EVENTS||
      Buffer.byteLength(JSON.stringify(list))>MAX_BYTES)
     return fail('bounded-invitation-evidence-required');
   const seen=new Set();
   for(const event of list){
     if(!['invitation','accept','endorse'].includes(event?.payload?.kind)||
       seen.has(event.id)||!await verifyEvent(event))
       return fail('duplicate-or-invalid-signed-reputation-evidence');
     seen.add(event.id);
     // In this route do not trust future-dated evidence, even if it is signed.
     if(event.payload.time>now)return fail('future-dated-evidence');
   }
   const report=await evaluateReputation(list,{
     roots:p.roots,scope:p.scope,now,
     // Hard limits on how much one invited identity can multiply promotions.
     maxInvitesPerSponsor:5,maxDepth:4,hopFactor:0.55
   });
   const candidate=report.results[subject];
   const ancestor=report.edges.some(edge=>edge.invitee===subject);
   if(!ancestor||report.ambiguous.includes(subject)||
      !candidate||candidate.depth===null||candidate.depth<1||
      candidate.score<p.minInviteScore)
     return fail('no-operator-trusted-bilateral-invitation-chain');
   return {qualified:true,verification:'independent',
     subject,className:'sponsored',method:'accepted-invitation',
     score:candidate.score,depth:candidate.depth,
     evidenceCount:list.length};
 }
 if(evidence.kind==='pinned-group-membership'){
   if(!p.groupPins.length)return fail('no-operator-pinned-group-branches');
   const bundle=evidence.bundle;
   if(!bundle||!p.groupPins.some(g=>g.groupId===bundle.groupId&&
       g.head===bundle.head))
     return fail('group-branch-not-approved-by-this-operator');
   if(!Array.isArray(bundle.events)||bundle.events.length<1||
      bundle.events.length>MAX_PROOF_EVENTS||
      Buffer.byteLength(JSON.stringify(bundle))>MAX_BYTES)
     return fail('bounded-group-evidence-required');
   const result=await verifyGroupProof(bundle);
   if(!result.valid)return fail('invalid-quorum-group-proof');
   if(!result.votingMembers.includes(subject))
     return fail('subject-not-ratified-group-member');
   // A group founder alone is not a shortcut to established status; the
   // operator has to pin its concrete groupId AND branch beforehand.
   return {qualified:true,verification:'independent',subject,
     className:'established',method:'operator-pinned-group-membership',
     groupId:bundle.groupId,head:bundle.head,
     evidenceCount:result.includedEventCount};
 }
 // Explicitly fail closed on raw coins, wallet claims and other proof types.
 return fail('unsupported-proof-kind');
}

export async function issueVerifiedTrustCapability({
 signer,policy,subject,evidence,now=Date.now()
}={}){
 const verified=await verifyOperatorTrustEvidence({policy,subject,evidence,now});
 if(!verified.qualified)return {...verified,credential:null};
 const p=validateOperatorTrustPolicy(policy);
 const credential=await issueIngressCapability({
   signer,subject,className:verified.className,now,ttlMs:p.ttlMs
 });
 return {...verified,credential};
}
