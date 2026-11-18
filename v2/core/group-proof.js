// Portable evidence that a PARTICULAR voluntary group charter branch has
// enough independently signed eligible member approvals. Not BLS/MuSig,
// not a universal current head, and not proof of external facts or identity.
import {deriveGroup} from './governance.js';
import {verifyEvent} from './events.js';
const idRe=/^sha256:[0-9a-f]{64}$/;
export const GROUP_PROOF_FORMAT='web9000-group-branch-proof-v1';

export async function createGroupProof(events,groupId,{head=null}={}){
 const derivation=await deriveGroup(events,groupId,{selectedHead:head});
 if(!derivation.found)throw Error('Founding group charter not found or signature invalid');
 if(!head&&derivation.ambiguous)throw Error('Choose a governance branch before exporting proof');
 const chosen=head||derivation.selectedHead;
 if(chosen!==groupId&&!derivation.recognized.includes(chosen))
   throw Error('The selected branch is not quorum-ratified');
 const byId=new Map();
 for(const event of events){
   if(!event?.id||!idRe.test(event.id))continue;
   if(byId.has(event.id)){
     // Even two envelopes with the same ID cannot silently substitute a
     // different signature while building a self-contained certificate.
     if(JSON.stringify(byId.get(event.id))!==JSON.stringify(event))
       throw Error('Conflicting duplicate signed event ID');
     continue;
   }
   byId.set(event.id,event);
 }
 const certified=new Map(derivation.ratifications.map(item=>[item.proposal,item]));
 const chain=[];let cursor=chosen;
 for(let n=0;cursor!==groupId&&n<64;n++){
   const approval=certified.get(cursor);
   if(!approval)throw Error('Selected branch has an unratified ancestor');
   chain.unshift(approval);cursor=approval.parent;
 }
 if(cursor!==groupId)throw Error('Group proof exceeds depth limit');
 const referenced=[groupId];
 for(const amendment of chain){
   referenced.push(amendment.proposal);
   for(const vote of amendment.approvals)referenced.push(vote.eventId);
 }
 const proofEvents=[...new Set(referenced)].map(id=>byId.get(id));
 if(proofEvents.some(x=>!x))throw Error('Missing independently signed proof record');
 for(const event of proofEvents)
   if(!await verifyEvent(event))throw Error('Invalid approval chain signature');
 return {format:GROUP_PROOF_FORMAT,groupId,head:chosen,events:proofEvents};
}

export async function verifyGroupProof(bundle){
 try{
   if(bundle?.format!==GROUP_PROOF_FORMAT||!idRe.test(bundle.groupId)||
      !idRe.test(bundle.head)||!Array.isArray(bundle.events)||
      bundle.events.length<1||bundle.events.length>5000)
     throw Error('Invalid proof envelope');
   const seen=new Set();
   for(const event of bundle.events){
     if(!event?.id||seen.has(event.id)||!await verifyEvent(event))
       throw Error('Duplicate or invalid signature in proof bundle');
     seen.add(event.id);
   }
   const result=await deriveGroup(bundle.events,bundle.groupId,{selectedHead:bundle.head});
   if(!result.found||result.state.head!==bundle.head)
     throw Error('Proof does not establish the requested group branch');
   if(bundle.head!==bundle.groupId&&!result.recognized.includes(bundle.head))
     throw Error('No valid quorum for requested branch');
   const minimal=await createGroupProof(bundle.events,bundle.groupId,{head:bundle.head});
   const listed=new Set(bundle.events.map(event=>event.id));
   if(minimal.events.some(event=>!listed.has(event.id)))
     throw Error('Signed amendment chain is incomplete');
   // This is inclusion proof only: peers may know additional competing forks,
   // rejections, later amendments or publication events absent in this bundle.
   return {valid:true,groupId:bundle.groupId,head:bundle.head,
     foundingSigner:bundle.events.find(e=>e.id===bundle.groupId)?.payload?.author,
     information:{name:result.state.name,description:result.state.description,
       recommendedSpaces:result.state.recommendedSpaces,
       revision:result.state.infoRevision},
     votingMembers:[...result.state.members],
     ratifications:result.ratifications,
     includedEventCount:minimal.events.length,
     caveat:'A branch inclusion proof does not establish uniqueness, latest state or real-world legitimacy'};
 }catch(error){return {valid:false,reason:String(error.message||error)};}
}
