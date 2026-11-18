// WEB9000 group governance: self-constituted, signed, immutable, non-authoritative.
// Every result is an independently selected view of a forkable charter history.
import {verifyEvent} from './events.js';
const idRe=/^sha256:[0-9a-f]{64}$/;
const asSorted=a=>[...a].sort();
const copy=s=>({
  ...s,
  members:[...s.members],reviewers:{...s.reviewers},delegates:[...s.delegates],
  hideTags:[...s.hideTags],recommendedSpaces:[...s.recommendedSpaces],quorum:{...s.quorum}
});
const DAY=86400000;
const timedDays=change=>change.type==='set-group-info'?7:14;
function threshold(state,change){
 const legacy=Math.ceil(state.members.length*state.quorum.numerator/state.quorum.denominator);
 if(change?.type==='set-decision-policy')
   return Math.max(legacy,Math.ceil(state.members.length*2/3));
 if(state.decisionPolicy?.mode!=='timed-v1')return legacy;
 // In the timed policy, binding authority MUST be backed by an absolute
 // number of member approvals. A turnout-only majority is too vulnerable
 // to omitted opposition ballots in an offline/incomplete replica.
 const required=change.type==='set-group-info'?
   Math.floor(state.members.length/2)+1:Math.ceil(state.members.length*2/3);
 return Math.max(legacy,required);
}
// Ordinary motions are nonbinding advice; low turnout must not silently
// authorize changes to membership, charter, moderation or group identity.
function resolutionOutcome(proposal,state,votes,now){
 const starts=proposal.payload.time,closes=starts+7*DAY;
 const electorate=new Set(state.members),latest=new Map();
 for(const vote of votes){
   const time=vote.payload.time;
   if(!electorate.has(vote.payload.author)||time<starts||time>closes||time>now)
     continue;
   const previous=latest.get(vote.payload.author);
   if(!previous||time>previous.payload.time||
       (time===previous.payload.time&&vote.id>previous.id))
     latest.set(vote.payload.author,vote);
 }
 const ballots=[...latest.values()];
 const yes=ballots.filter(x=>x.payload.body.choice==='approve').length;
 const no=ballots.length-yes;
 const required=state.members.length===1?1:
   Math.max(2,Math.ceil(state.members.length/3));
 const status=now<starts-5*60000?'not-started':now<closes?'open':ballots.length<required?'insufficient-turnout':
   yes>no?'supported':'rejected';
 return {proposal:proposal.id,parent:proposal.payload.body.parent,
   title:proposal.payload.body.change.title,text:proposal.payload.body.change.text,
   status,yes,no,participation:ballots.length,required,
   closesAt:closes,eligibleMembers:state.members.length,eligibleAuthors:[...state.members],
   // Time isn't a consensus clock. Omitted or backdated records can lead
   // another honest peer to a different observation of the same motion.
   caveat:'Local signed-event tally, not network-wide finality or group-state authorization'};
}

function applyChange(state,change) {
  const s=copy(state),members=new Set(s.members),delegates=new Set(s.delegates);
  switch(change.type){
    case 'add-member': members.add(change.author);break;
    case 'remove-member': members.delete(change.author);if(!members.size)return null;break;
    case 'set-quorum': s.quorum={numerator:change.numerator,denominator:change.denominator};break;
    case 'appoint-reviewer': s.reviewers[change.author]=change.weight;break;
    case 'remove-reviewer': delete s.reviewers[change.author];break;
    case 'delegate': delegates.add(change.group);break;
    case 'undelegate': delegates.delete(change.group);break;
    case 'set-label-rules': s.hideTags=[...new Set(change.hideTags)].sort();break;
    case 'set-decision-policy': s.decisionPolicy={mode:change.mode};break;
    case 'resolution': return null; // Advisory motion: never changes charter authority.
    case 'set-group-info':
      s.name=change.name.trim();
      s.description=change.description;
      s.recommendedSpaces=[...change.recommendedSpaces];
      break;
    default: return null;
  }
  s.members=asSorted(members);s.delegates=asSorted(delegates);
  return s;
}
const validSignatures=async events=>{
  const out=[];
  for(const e of events) if(await verifyEvent(e))out.push(e);
  return out;
};
/**
 * Derive ALL recognized branches of a group; never invent a global winning head.
 * Quorum is evaluated against members in the proposal's *parent snapshot*.
 * Any distinct valid approving voter counts once. Signed rejections are retained
 * as dissent; a later rejection cannot un-ratify an existing accepted charter.
 * Both choices from one voter are equivocation evidence, not a retroactive veto.
 */
export async function deriveGroup(events, groupId, {selectedHead=null,maxEvents=5000,maxDepth=64,now=Date.now()}={}) {
  if(!idRe.test(groupId))throw Error('Invalid group ID');
  if(!Array.isArray(events)||events.length>maxEvents)throw Error('Governance event budget exceeded');
  const signed=await validSignatures(events.filter(e=>['group','proposal','vote'].includes(e?.payload?.kind)));
  const charter=signed.find(e=>e.id===groupId&&e.payload.kind==='group');
  if(!charter) return {found:false,groupId,heads:[],selectedHead:null};
  // A group starts with its creator; others acquire voting rights through
  // explicitly ratified membership amendments, never simply a claimed name.
  const base={groupId,head:groupId,revision:0,name:charter.payload.body.name,
    description:charter.payload.body.description||'',
    recommendedSpaces:[...(charter.payload.body.recommendedSpaces||[])],
    infoRevision:groupId,decisionPolicy:charter.payload.body.decisionPolicy||null,
    members:[charter.payload.author],reviewers:{},delegates:[],
    quorum:{...charter.payload.body.quorum},
    hideTags:['spam','scam','malware','sexual-abuse-material']};
  const states=new Map([[groupId,base]]);
  const proposals=signed.filter(e=>e.payload.kind==='proposal'&&e.payload.body.group===groupId)
    .sort((a,b)=>a.id.localeCompare(b.id));
  const votes=new Map();
  for(const event of signed.filter(e=>e.payload.kind==='vote')){
    const id=event.payload.body.proposal;
    if(!votes.has(id))votes.set(id,[]);
    votes.get(id).push(event);
  }
  const recognized=new Set();
  const motions=[];
  const equivocations=[];
  const ratifications=new Map();
  const notRecognized=new Map();
  const pendingCounts=new Map();
  const maxRounds=Math.min(maxDepth,proposals.length)+1;
  for(let round=0;round<maxRounds;round++){
    let progress=false;
    for(const event of proposals){
      if(recognized.has(event.id))continue;
      const {parent,change}=event.payload.body,s=states.get(parent);
      if(!s || s.revision>=maxDepth)continue;
      if(!s.members.includes(event.payload.author)){
        notRecognized.set(event.id,'proposer not a voting member at parent snapshot');continue;
      }
      if(change.type==='resolution')continue; // Tally separately, not as authority.
      const eligible=new Map(),approvals=new Map();
      const timed=s.decisionPolicy?.mode==='timed-v1'||
        change.type==='set-decision-policy';
      const deadline=event.payload.time+timedDays(change)*DAY;
      if(timed&&event.payload.time>now){
        notRecognized.set(event.id,'proposal starts in future');continue;
      }
      for(const vote of votes.get(event.id)||[]){
        if(timed&&(vote.payload.time<event.payload.time||
          vote.payload.time>deadline||vote.payload.time>now))continue;
        if(!s.members.includes(vote.payload.author))continue;
        if(!eligible.has(vote.payload.author))eligible.set(vote.payload.author,new Set());
        eligible.get(vote.payload.author).add(vote.payload.body.choice);
        if(vote.payload.body.choice==='approve'&&
           (!approvals.has(vote.payload.author)||vote.id<approvals.get(vote.payload.author).id))
          approvals.set(vote.payload.author,vote);
      }
      const doubleVotes=[...eligible.entries()].filter(([,v])=>v.size>1).map(([author])=>author);
      if(doubleVotes.length) equivocations.push({proposal:event.id,authors:doubleVotes.sort()});
      const yes=approvals.size,required=threshold(s,change);
      pendingCounts.set(event.id,{approved:yes,required,
        eligibleMembers:s.members.length,closesAt:timed?deadline:null});
      if(yes<required){
        notRecognized.set(event.id,timed&&now>deadline?
          'expired without required member signatures':
          'insufficient approved member ballots');continue;
      }
      const next=applyChange(s,change);
      if(!next){notRecognized.set(event.id,'invalid state transition');continue;}
      next.head=event.id;next.revision=s.revision+1;
      if(change.type==='set-group-info')next.infoRevision=event.id;
      const signatureProof=[...approvals.values()]
        .sort((a,b)=>a.payload.author.localeCompare(b.payload.author))
        .map(v=>({author:v.payload.author,eventId:v.id,signature:v.signature}));
      ratifications.set(event.id,{
        proposal:event.id,parent,changeType:change.type,
        required,eligibleMembers:asSorted(s.members),
        decisionPolicy:s.decisionPolicy?.mode||'legacy-quorum',
        expiresAt:timed?deadline:null,
        approved:signatureProof.length,approvals:signatureProof
      });
      states.set(event.id,next);recognized.add(event.id);notRecognized.delete(event.id);pendingCounts.delete(event.id);progress=true;
    }
    if(!progress)break;
  }
  for(const proposal of proposals){
    if(proposal.payload.body.change.type!=='resolution')continue;
    const parent=proposal.payload.body.parent,s=states.get(parent);
    if(!s||s.decisionPolicy?.mode!=='timed-v1')continue;
    if(!s.members.includes(proposal.payload.author))continue;
    motions.push(resolutionOutcome(proposal,s,votes.get(proposal.id)||[],now));
  }
  const children=new Map();
  for(const e of proposals.filter(x=>recognized.has(x.id))){
    const parent=e.payload.body.parent;children.set(parent,[...(children.get(parent)||[]),e.id]);
  }
  const heads=asSorted([...states.keys()].filter(id=>!children.has(id)));
  const chosen=selectedHead && states.has(selectedHead)?selectedHead:heads.length===1?heads[0]:groupId;
  const forks=[...children.entries()].filter(([,list])=>list.length>1).map(([parent,branches])=>({parent,branches:asSorted(branches)}));
  return {
    found:true,groupId,charter:charter.id,heads,selectedHead:chosen,
    ambiguous:heads.length>1 && (!selectedHead || !states.has(selectedHead)),
    state:copy(states.get(chosen)),
    states: [...states.values()].map(copy),
    ratifications:[...ratifications.values()].sort((a,b)=>a.proposal.localeCompare(b.proposal)),
    motions:motions.sort((a,b)=>a.proposal.localeCompare(b.proposal)),
    recognized:asSorted(recognized),
    pending:proposals.filter(e=>e.payload.body.change.type!=='resolution'&&!recognized.has(e.id))
      .map(e=>({id:e.id,reason:notRecognized.get(e.id)||'missing parent or exceeding depth',
        ...(pendingCounts.get(e.id)||{})})),
    forks,
    equivocations
  };
}
/** Materialize independently chosen group checkpoints into a LOCAL policy.
 * Group IDs cannot become mandatory global authorities by subscribing.
 * The caller explicitly selects heads, and local hideTags always win.
 */
export async function governancePolicy(events,basePolicy,selectedGroups) {
  const groups={};
  const observations=[];
  for(const entry of selectedGroups){
    const view=await deriveGroup(events,entry.id,{selectedHead:entry.head||null});
    observations.push(view);
    if(!view.found)continue;
    const s=view.state;
    groups[entry.id]={reviewers:s.reviewers,inherits:s.delegates};
  }
  return {policy:{...basePolicy,groups:{...(basePolicy.groups||{}),...groups},
    subscriptions:[...new Set([...(basePolicy.subscriptions||[]),...selectedGroups.map(g=>g.id)])]},
    observations};
}
