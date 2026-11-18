// Policy is an interpretation, not database access control.
// Clans/guilds/federations may form arbitrary cycles: recursion must be bounded.
export const DEFAULT_POLICY = Object.freeze({
  followedSpaces:['commons'], trustedAuthors:[], blockedAuthors:[], reviewerWeights:{},
  groups:{}, subscriptions:[], hideTags:['spam','scam','malware','sexual-abuse-material'],
  quarantineTags:['sexual-abuse-material','malware'], minLabelWeight:1,
  showUnknown:true, ownerPreference:{}
});
export function resolveReviewers(policy) {
  const weights = new Map(Object.entries(policy.reviewerWeights || {}));
  const seen = new Set();
  function visit(id, depth) {
    if (depth >= 16 || seen.has(id)) return;
    seen.add(id);
    const group=(policy.groups || {})[id];
    if (!group) return;
    for (const [author,weight] of Object.entries(group.reviewers || {})) {
      if (Number.isFinite(weight) && weight > 0) weights.set(author,Math.max(weights.get(author) || 0,weight));
    }
    for (const child of group.inherits || []) visit(child,depth+1);
  }
  for (const id of policy.subscriptions || []) visit(id,0);
  return weights;
}
export function decide(event, events, policy=DEFAULT_POLICY, viewer=null) {
  const p=event.payload;
  if (!['post','reply'].includes(p.kind)) return {visible:false,reason:'not content'};
  if (!policy.followedSpaces.includes(p.space)) return {visible:false,reason:'space not followed'};
  if (policy.blockedAuthors.includes(p.author)) return {visible:false,reason:'blocked author'};
  const reviewers=resolveReviewers(policy);
  const labels=events.filter(e=>e.payload.kind==='label' && e.payload.body.target===event.id && e.payload.author!==p.author)
    .filter(e=>e.payload.author===viewer || (reviewers.get(e.payload.author)||0)>0);
  // Duplicate signed labels from one reviewer never multiply their vote.
  const scoreFor=tag=>{
    const distinct=new Set(labels.filter(e=>e.payload.body.tag===tag).map(e=>e.payload.author));
    return [...distinct].reduce((sum,author)=>sum+(author===viewer ? 1 : reviewers.get(author)||0),0);
  };
  const tags=[...new Set(labels.map(e=>e.payload.body.tag))];
  // A label applies to *this view*. It cannot erase the original record.
  const hit=tags.find(t=>(policy.hideTags||[]).includes(t) && scoreFor(t)>=(policy.minLabelWeight||1));
  if(hit) return {visible:false,quarantined:(policy.quarantineTags||[]).includes(hit),reason:'label: '+hit,labels};
  const preferred=policy.ownerPreference?.[p.space];
  if(preferred && p.author!==preferred && !policy.trustedAuthors.includes(p.author) && p.author!==viewer)
    return {visible:false,reason:'optional space-owner preference',labels};
  const known=p.author===viewer || policy.trustedAuthors.includes(p.author);
  if(!known && !policy.showUnknown) return {visible:false,reason:'unknown author',labels};
  return {visible:true,reason:known?'trusted':'unverified',labels};
}
export function buildFeed(events,policy=DEFAULT_POLICY,viewer=null) {
  return events.filter(e=>['post','reply'].includes(e.payload.kind))
    .map(event=>({event,decision:decide(event,events,policy,viewer)}))
    .sort((a,b)=>b.event.payload.time-a.event.payload.time);
}
