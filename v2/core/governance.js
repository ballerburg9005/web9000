// WEB9000 group governance: self-constituted, signed, immutable, non-authoritative.
// Every result is an independently selected view of a forkable charter history.
import {verifyEvent} from './events.js';
const idRe=/^sha256:[0-9a-f]{64}$/;
const asSorted=a=>[...a].sort();
const copy=s=>({
  ...s,
  members:[...s.members],reviewers:{...s.reviewers},delegates:[...s.delegates],
  hideTags:[...s.hideTags],quorum:{...s.quorum}
});
function threshold(state){return Math.ceil(state.members.length*state.quorum.numerator/state.quorum.denominator);}
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
 * A member who signed both yes/no on a proposal is ignored for that proposal.
 * Rejected votes are retained as evidence, but do not retroactively veto a
 * threshold of approvals (acceptance is monotonic as additional events arrive).
 */
export async function deriveGroup(events, groupId, {selectedHead=null,maxEvents=5000,maxDepth=64}={}) {
  if(!idRe.test(groupId))throw Error('Invalid group ID');
  if(!Array.isArray(events)||events.length>maxEvents)throw Error('Governance event budget exceeded');
  const signed=await validSignatures(events.filter(e=>['group','proposal','vote'].includes(e?.payload?.kind)));
  const charter=signed.find(e=>e.id===groupId&&e.payload.kind==='group');
  if(!charter) return {found:false,groupId,heads:[],selectedHead:null};
  // A group starts with its creator; others acquire voting rights through
  // explicitly ratified membership amendments, never simply a claimed name.
  const base={groupId,head:groupId,revision:0,name:charter.payload.body.name,
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
  const notRecognized=new Map();
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
      const eligible=new Map();
      for(const vote of votes.get(event.id)||[]){
        if(!s.members.includes(vote.payload.author))continue;
        if(!eligible.has(vote.payload.author))eligible.set(vote.payload.author,new Set());
        eligible.get(vote.payload.author).add(vote.payload.body.choice);
      }
      const yes=[...eligible.values()].filter(v=>v.size===1&&v.has('approve')).length;
      if(yes<threshold(s)){notRecognized.set(event.id,'insufficient approved member ballots');continue;}
      const next=applyChange(s,change);
      if(!next){notRecognized.set(event.id,'invalid state transition');continue;}
      next.head=event.id;next.revision=s.revision+1;
      states.set(event.id,next);recognized.add(event.id);notRecognized.delete(event.id);progress=true;
    }
    if(!progress)break;
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
    recognized:asSorted(recognized),
    pending:proposals.filter(e=>!recognized.has(e.id)).map(e=>({id:e.id,reason:notRecognized.get(e.id)||'missing parent or exceeding depth'})),
    forks
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
