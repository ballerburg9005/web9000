// Stake-independent, local-view invitation/reputation evaluation for WEB9000.
// Nothing here can delete a record or deny publication. No global trust scores.
// Sponsor links require TWO signatures: sponsor invitation AND invitee acceptance.
import {verifyEvent} from './events.js';
const uniqueSorted=x=>[...new Set(x)].sort();
const defaultConfig=Object.freeze({
  roots:[],reviewerWeights:{},scope:'commons',
  maxDepth:4,hopFactor:0.55,maxInvitesPerSponsor:5,
  windowMs:90*86400000,minSponsorScore:12,
  penaltyPerDistrust:40,sponsorLiability:0.75,now:Date.now()
});
function checkPolicy(p){
  if(typeof p.scope!=='string' || !p.scope ||
     !Number.isFinite(p.maxDepth) || p.maxDepth<1 || p.maxDepth>16 ||
     !Number.isFinite(p.hopFactor) || p.hopFactor<=0 || p.hopFactor>=1 ||
     !Number.isInteger(p.maxInvitesPerSponsor) || p.maxInvitesPerSponsor<1 || p.maxInvitesPerSponsor>1000 ||
     !Number.isFinite(p.windowMs) || p.windowMs<1 ||
     !Number.isFinite(p.minSponsorScore) || p.minSponsorScore<0 || p.minSponsorScore>100 ||
     !Number.isFinite(p.penaltyPerDistrust) || p.penaltyPerDistrust<0 ||
     !Number.isFinite(p.sponsorLiability) || p.sponsorLiability<0 || p.sponsorLiability>1 ||
     !Number.isSafeInteger(p.now) || p.now<0)throw Error('Invalid local reputation configuration');
}
const chron=(a,b)=>a.payload.time-b.payload.time || a.id.localeCompare(b.id);
const scoreMap = () => Object.create(null);
/**
 * Output is viewer-dependent, optional evidence used for ranking/filtering.
 * The algorithm ignores invitations not independently accepted by the invitee.
 * It also limits per-sponsor promotion and reviewer duplicate reports.
 */
export async function evaluateReputation(events,opts={}) {
  const p={...defaultConfig,...opts};
  checkPolicy(p);
  if(!Array.isArray(events)||events.length>10000)throw Error('Reputation input budget exceeded');
  const verified=[];
  for(const event of events){
    if(!['invitation','accept','endorse'].includes(event?.payload?.kind))continue;
    if(await verifyEvent(event))verified.push(event);
  }
  const invitations=new Map();
  // Invite expiry limits *when acceptance may occur*. Once bilaterally
  // accepted before the deadline, sponsor lineage and liability persist.
  for(const event of verified.filter(e=>e.payload.kind==='invitation'&&e.payload.body.scope===p.scope)
    .filter(e=>e.payload.time<=p.now)){
    if(event.payload.author===event.payload.body.invitee)continue;
    invitations.set(event.id,event);
  }
  // Acceptance must be from the *named* invitee. One acceptance is a
  // commitment to a sponsor. Multiple commitments intentionally lose trust,
  // rather than ambiguously shifting liability between sponsors.
  const accepted=new Map();
  for(const a of verified.filter(e=>e.payload.kind==='accept')){
    const invitation=invitations.get(a.payload.body.invitation);
    if(!invitation || a.payload.author!==invitation.payload.body.invitee ||
       a.payload.time<invitation.payload.time || a.payload.time>p.now ||
       (invitation.payload.body.expiresAt!==undefined && a.payload.time>invitation.payload.body.expiresAt))continue;
    const invitee=a.payload.author;
    if(!accepted.has(invitee))accepted.set(invitee,new Set());
    accepted.get(invitee).add(invitation.id);
  }
  const ambiguous=uniqueSorted([...accepted.entries()].filter(([,ids])=>ids.size>1).map(([id])=>id));
  const candidates=[...accepted.entries()].filter(([,ids])=>ids.size===1)
    .map(([invitee,ids])=>({invitee,invite:invitations.get([...ids][0])})).sort((a,b)=>chron(a.invite,b.invite));
  // One sponsor's promoted invites cannot grow without bound. Windowed limits
  // are relative to *signed* publication times and remain a local policy.
  const bySponsor=new Map(),edges=[];
  for(const item of candidates){
    const sponsor=item.invite.payload.author,time=item.invite.payload.time;
    const slots=(bySponsor.get(sponsor)||[]).filter(t=>time-t<p.windowMs);
    if(slots.length>=p.maxInvitesPerSponsor)continue;
    slots.push(time);bySponsor.set(sponsor,slots);
    edges.push({sponsor,invitee:item.invitee,eventId:item.invite.id});
  }
  const scores=scoreMap(),depths=scoreMap(),parent=scoreMap(),roots=uniqueSorted(p.roots);
  for(const root of roots){scores[root]=100;depths[root]=0;}
  // Repeated relaxation only increases scores and strictly decreases them per hop.
  // Cycles without a trusted root cannot bootstrap positive reputation.
  for(let depth=0;depth<p.maxDepth;depth++){
    let changed=false;
    for(const edge of edges){
      const amount=(scores[edge.sponsor]||0)*p.hopFactor;
      const hop=(depths[edge.sponsor]??Infinity)+1;
      if(hop>p.maxDepth || (scores[edge.sponsor]||0)<p.minSponsorScore || roots.includes(edge.invitee))continue;
      if(amount>(scores[edge.invitee]||0)+1e-9){
        scores[edge.invitee]=amount;depths[edge.invitee]=hop;
        parent[edge.invitee]=edge.sponsor;changed=true;
      }
    }
    if(!changed)break;
  }
  // Moderation assertions are attributed, independent and viewer-chosen.
  // One reviewer's newest signed opinion for each subject wins in this view.
  const opinions=new Map();
  const weights=p.reviewerWeights||{};
  for(const e of verified.filter(e=>e.payload.kind==='endorse').sort(chron)){
    if(e.payload.author===e.payload.body.subject || !Number.isFinite(weights[e.payload.author]) || weights[e.payload.author]<=0)continue;
    const key=e.payload.author+'|'+e.payload.body.subject;
    opinions.set(key,e);
  }
  const penalties=scoreMap(),evidence=[];
  for(const e of opinions.values()){
    if(e.payload.body.action!=='distrust')continue;
    const origin=e.payload.body.subject, reviewer=e.payload.author;
    const amount=Math.min(100,p.penaltyPerDistrust*Math.min(weights[reviewer],5));
    evidence.push({reviewer,subject:origin,eventId:e.id,impact:amount});
    const seen=new Set();
    let subject=origin,factor=1;
    for(let d=0;d<=p.maxDepth && subject&&!seen.has(subject);d++){
      seen.add(subject);
      penalties[subject]=(penalties[subject]||0)+amount*factor;
      subject=parent[subject];factor*=p.sponsorLiability;
    }
  }
  const all=new Set([...Object.keys(scores),...Object.keys(penalties)]);
  const results={};
  for(const id of all)results[id]={
    score:Math.max(0,Math.min(100,(scores[id]||0)-(penalties[id]||0))),
    invitationScore:scores[id]||0,
    penalty:penalties[id]||0,
    parent:parent[id]||null,depth:depths[id]??null
  };
  return {scope:p.scope,results,edges,ambiguous,evidence,roots,acceptedInvitations:edges.length};
}
