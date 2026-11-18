// Voluntary, locally enforced IPFS pin/fetch policy.
// No network-wide deletion, global blockade or mandatory media download.
import {resolveReviewers,decide} from './policy.js';
const cidRE=/^ipfs:\/\/[A-Za-z0-9]{20,120}$/;
export const DEFAULT_MEDIA_POLICY=Object.freeze({
  autoFetch:false,autoUnpin:false,quarantineTags:['sexual-abuse-material','malware'],
  denyTags:['sexual-abuse-material','malware'],minWeight:2,
  blockedCids:[]
});
export function parseCID(value){
  if(typeof value!=='string'||!cidRE.test(value))throw Error('Invalid IPFS CID reference');
  return value.slice(7);
}
const weightFor=(author,viewer,weights)=>author===viewer?1:(weights.get(author)||0);
function matchedLabels(target,events,viewer,weights,tags){
  // Only independent signer claims, never a network operator's directive.
  const byTag=new Map();
  for(const event of events){
    if(event?.payload?.kind!=='label'||event.payload.body.target!==target ||
       !tags.includes(event.payload.body.tag))continue;
    const author=event.payload.author,w=weightFor(author,viewer,weights);
    if(w<=0)continue;
    if(!byTag.has(event.payload.body.tag))byTag.set(event.payload.body.tag,new Map());
    byTag.get(event.payload.body.tag).set(author,w);
  }
  return [...byTag].map(([tag,authors])=>({
    tag,weight:[...authors.values()].reduce((sum,w)=>sum+w,0),
    independentReviewers:authors.size
  }));
}
/**
 * Media returns fetch=false until explicitly requested. Even an explicit
 * request is refused under an adopted quarantine rule unless overridden.
 * The result is a *local* operation decision, not a verdict on the hash.
 */
export function decideMedia({cid,post=null,events=[],policy={},mediaPolicy={},viewer=null,explicitRequest=false}){
  parseCID(cid);
  const m={...DEFAULT_MEDIA_POLICY,...mediaPolicy};
  if(m.blockedCids.includes(cid))return {fetch:false,keepPinned:false,reason:'local CID block',quarantine:true};
  const weights=resolveReviewers(policy);
  const refs=[cid];
  if(post)refs.push(post.id);
  const labels=refs.flatMap(target=>matchedLabels(target,events,viewer,weights,m.denyTags));
  const hit=labels.find(label=>label.weight>=m.minWeight);
  if(hit)return {fetch:false,keepPinned:false,reason:'accepted media label: '+hit.tag,quarantine:m.quarantineTags.includes(hit.tag),evidence:labels};
  if(post){
    const view=decide(post,events,policy,viewer);
    if(!view.visible)return {fetch:false,keepPinned:false,reason:'source publication filtered',quarantine:false};
  }
  // The document containing the CID may be replicated without its bytes.
  if(!explicitRequest && !m.autoFetch)
    return {fetch:false,keepPinned:true,reason:'manual media request required',quarantine:false};
  return {fetch:true,keepPinned:true,reason:'permitted by selected local policy',quarantine:false};
}
/**
 * Node operator OPTS IN to automatic cleanup; unpin performs only that
 * operator's local action. Other peers are entirely unaffected.
 */
export async function enforceLocalPins({pinned=[],events=[],policy={},mediaPolicy={},viewer=null,unpin}={}){
  const m={...DEFAULT_MEDIA_POLICY,...mediaPolicy};
  if(!m.autoUnpin)return {removed:[],skipped:pinned,errors:[]};
  if(typeof unpin!=='function')throw Error('Operator must supply a local unpin handler');
  const removed=[],skipped=[],errors=[];
  for(const cid of new Set(pinned)){
    let decision;
    try{decision=decideMedia({cid,events,policy,mediaPolicy:m,viewer});}
    catch(error){errors.push({cid,error:error.message});continue;}
    if(decision.keepPinned){skipped.push(cid);continue;}
    try{await unpin(parseCID(cid));removed.push({cid,reason:decision.reason});}
    catch(error){errors.push({cid,error:String(error)});}
  }
  return {removed,skipped,errors};
}
