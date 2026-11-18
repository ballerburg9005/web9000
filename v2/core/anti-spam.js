/**
 * Default spam economics for *voluntary* qualified replication lanes.
 *
 * IMPORTANT: this module NEVER determines validity of a signed WEB9000 event
 * and NEVER removes it from independently held raw indexes. It only helps a
 * willing peer choose what to mirror in an independently curated index.
 *
 * Proof of locked stake must come from a separately configured trusted
 * read-only on-chain verifier (contract/chain/price/finality checks). Never
 * accept an arbitrary post author's JSON claim as stake evidence.
 */
export const DEFAULT_ANTI_SPAM=Object.freeze({
  minStakeUsd:10,
  minHoldDays:14,
  minRemainingHoldDays:7,
  postsPerDay:5,
  repliesPerDay:60,
  moderationActionsPerDay:100,
  qualifiedByDefault:true,
  rawFallback:false,
  inviteQuotaPerMonth:3,
  directInvitePenalty:10,
  downstreamPenalty:10,
  penaltyDecay:0.5,
  liabilityDepth:4,
  maxPenaltyPerIdentity:1000,
  // A negative judgment is not legitimate merely because somebody filed a
  // report. It must be ratified under the viewer-selected governance process.
  requireRatifiedAbuseFinding:true
});
const DAY=86400000;
const positive=x=>Number.isFinite(x)&&x>=0;
export function checkStakeEvidence(stake,{now=Date.now(),config=DEFAULT_ANTI_SPAM}={}){
  if(!stake||stake.verification!=='independently-checked-on-chain')
    return {qualified:false,reason:'no independently verified on-chain position'};
  if(!stake.active||stake.exitRequested)
    return {qualified:false,reason:'stake is inactive or exiting'};
  if(!positive(stake.usdValue)||stake.usdValue<config.minStakeUsd)
    return {qualified:false,reason:'stake below the selected USD threshold'};
  if(!Number.isSafeInteger(stake.lockedAt)||!Number.isSafeInteger(stake.withdrawalNotBefore)||
     stake.lockedAt>now||stake.withdrawalNotBefore<now)
    return {qualified:false,reason:'invalid stake lock or expiration'};
  if(stake.withdrawalNotBefore-stake.lockedAt<config.minHoldDays*DAY||
     stake.withdrawalNotBefore-now<config.minRemainingHoldDays*DAY)
    return {qualified:false,reason:'stake locked for too short a period'};
  if(typeof stake.chainId!=='number'||typeof stake.contract!=='string'||
    typeof stake.blockHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(stake.blockHash))
    return {qualified:false,reason:'missing independently verifiable chain anchor'};
  return {qualified:true,reason:'verified active stake'};
}
export function qualifyingLane({stake=null,earned=null,config=DEFAULT_ANTI_SPAM,now=Date.now()}={}){
  const direct=checkStakeEvidence(stake,{now,config});
  if(direct.qualified)return {lane:'qualified',reason:'stake',claim:direct};
  // Earned proof may be used only after independent, signed endorsement
  // verification and liability checks by another trust processor.
  const earnedValid=earned?.verification==='signed-multi-party-reviewed'&&
    Number.isSafeInteger(earned.score)&&earned.score>=10&&
    earned.sponsors>=2&&earned.sponsors<=100&&
    earned.liabilityAccepted===true&&earned.lastReviewedAt<=now&&
    now-earned.lastReviewedAt<=30*DAY&&earned.identity===earned.subject;
  if(earnedValid)return {lane:'qualified',reason:'earned-karmic-reputation'};
  return {lane:'raw',reason:direct.reason};
}
export function localRateDecision(event,priorEvents,{config=DEFAULT_ANTI_SPAM}={}){
  if(!event?.payload)return {allow:false,reason:'not an event'};
  const kind=event.payload.kind;
  if(!['post','reply'].includes(kind))return {allow:true,reason:'rate cap only applies to authored content'};
  // All records from a single signing identity count, regardless of the
  // number of names/spaces they claim. A stake identity may also have
  // additional wallet-level caps in an external verifier.
  const start=event.payload.time-DAY,author=event.payload.author;
  const n=priorEvents.filter(e=>e.payload?.author===author &&
    e.payload.kind===kind&&e.payload.time>start&&e.payload.time<=event.payload.time).length;
  const limit=kind==='post'?config.postsPerDay:config.repliesPerDay;
  return {allow:n<limit,reason:n<limit?'under daily per-author limit':'daily local replication cap',
    count:n,limit};
}
/**
 * Carry *ratified* botspam findings backwards through verified, acyclic
 * invitation sponsorship edges. A finding is NOT an arbitrary user report;
 * the caller must first verify elected reviewer/quorum/appeal requirements.
 *
 * Repeated abuse reports of one identity never multiply the penalty.
 * Max depth, per-sponsor caps, and visited sets limit retaliation cascades.
 */
export function calculateSponsorLiability({
  abusiveAuthor,verifiedEdges=[],ratifiedFindings=[],config=DEFAULT_ANTI_SPAM
}={}){
  if(typeof abusiveAuthor!=='string'||!abusiveAuthor)return new Map();
  const finding=ratifiedFindings.find(f=>f.subject===abusiveAuthor&&
    f.ratified===true&&f.category==='automated-commercial-spam'&&
    f.appealStatus!=='overturned'&&f.verified===true);
  if(!finding)return new Map();
  const penalty=Math.min(config.maxPenaltyPerIdentity,
    Math.max(0,Number(finding.weight)||0)*config.directInvitePenalty);
  const edges=verifiedEdges.filter(e=>e.verified===true&&e.consent===true&&e.active===true);
  const total=new Map(),queue=[{subject:abusiveAuthor,depth:0,value:penalty}];
  const visited=new Set([abusiveAuthor]);
  while(queue.length){
    const item=queue.shift();
    if(item.depth>=config.liabilityDepth||item.value<0.01)continue;
    for(const edge of edges.filter(e=>e.invitee===item.subject)){
      if(visited.has(edge.inviter))continue;
      visited.add(edge.inviter);
      const loss=item.depth===0?item.value:item.value*config.penaltyDecay;
      total.set(edge.inviter,Math.min(config.maxPenaltyPerIdentity,(total.get(edge.inviter)||0)+loss));
      queue.push({subject:edge.inviter,depth:item.depth+1,value:loss});
    }
  }
  return total;
}
/**
 * Keep auditable reasons for local non-replication. Claims may be contested;
 * an alternative peer can still keep the signed record in its own raw lane.
 */
export function auditSuppression(event,{lane='raw',reason='',authorities=[]}={}){
  if(!event?.id||!event.payload?.author)throw Error('Signed event metadata required');
  return {eventId:event.id,space:event.payload.space,author:event.payload.author,
    action:'local-replication-refusal',lane,reason,
    assertedBy:[...new Set(authorities)].slice(0,20)};
}
