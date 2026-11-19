// WEB9000 reversible group reputation: opinions and audit evidence, not authority.
// Every returned statement was independently signed/verified by Replica before
// entry here. A reviewer candidacy does not grant a ratified governance role.
const isNewer=(a,b)=>!b||a.payload.time>b.payload.time||
  (a.payload.time===b.payload.time&&a.id>b.id);
function latest(events,kind,key){
 const byKey=new Map();
 for(const e of events){
  if(e?.payload?.kind!==kind)continue;
  const k=key(e);
  if(!k)continue;
  const prior=byKey.get(k);
  if(isNewer(e,prior))byKey.set(k,e);
 }
 return [...byKey.values()].sort((a,b)=>b.payload.time-a.payload.time||
   b.id.localeCompare(a.id));
}
export function groupReputation(events,groupId){
 const opinions=latest(events,'group-rating',e=>
   e.payload.body.group===groupId?e.payload.author:null);
 const counts={trust:0,distrust:0,neutral:0};
 for(const e of opinions){
  if(e.payload.body.value>0)counts.trust++;
  if(e.payload.body.value<0)counts.distrust++;
 }
 const candidates=latest(events,'reviewer-candidacy',e=>
   e.payload.body.group===groupId?e.payload.author:null)
   .filter(e=>e.payload.body.action==='volunteer');
 return {groupId,count:opinions.length,counts,
   score:opinions.reduce((sum,e)=>sum+e.payload.body.value,0),
   opinions,candidates,
   caveat:'Voluntary signed opinions; not a universal group-ban score or binding misconduct ruling'};
}
export function reviewerConduct(events,reviewerId){
 const opinions=latest(events,'reviewer-conduct',e=>
  e.payload.body.reviewer===reviewerId?
    e.payload.author+'|'+e.payload.body.group:null);
 const activity=events.filter(e=>e?.payload?.author===reviewerId&&
   ['content-rating','label'].includes(e.payload.kind))
   .sort((a,b)=>b.payload.time-a.payload.time||b.id.localeCompare(a.id));
 return {reviewer:reviewerId,opinions,activity,
  concerns:opinions.filter(e=>e.payload.body.value<0).length,
  commendations:opinions.filter(e=>e.payload.body.value>0).length};
}
