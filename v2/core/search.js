// Search & discovery are LOCAL views over already verified signed records.
// No website or namespace "owner" can remove an index entry from a peer.
export const SEARCH_KINDS=['image','video','audio','event','poll','text','discussion','job','project','offer'];
const norm=s=>String(s??'').toLocaleLowerCase();
export function postKind(item){
  const b=item.event.payload.body, f=b.fields||{};
  if(f.poll)return 'poll';
  if(f.schedule)return 'event';
  const p=f.presentation;
  if(p==='audio'||p==='sound')return 'audio';
  if(p==='video'||f.video)return 'video';
  if(p==='event'||p==='meetup')return 'event';
  if(['offer','marketplace'].includes(p))return 'offer';
  if(['job','positions'].includes(p))return 'job';
  if(p==='project')return 'project';
  if(p==='discussion'||p==='text'||p==='blog')return 'text';
  if(Array.isArray(b.media)&&b.media.length)return 'image';
  return 'text';
}
function tags(item){
  return (item.event.payload.body.fields?.tags||[]).filter(v=>typeof v==='string').map(norm);
}
function fieldValues(item,attribute){
  const p=item.event.payload,b=p.body,f=b.fields||{};
  if(attribute==='title')return [b.title];
  if(attribute==='body')return [b.text];
  if(attribute==='tags')return tags(item);
  if(attribute==='author')return [p.author];
  if(attribute==='space')return [p.space];
  if(attribute==='type')return [postKind(item),f.presentation];
  if(attribute==='location')return [f.schedule?.location,f.location];
  if(attribute==='positions')return f.positions||[];
  if(attribute==='price')return [f.price];
  if(attribute==='all')return [
    b.title,b.text,p.author,p.space,postKind(item),
    ...tags(item),f.schedule?.location,...(f.positions||[]),f.price
  ];
  // Only attribute queries for arbitrary interoperable custom field names.
  if(attribute.startsWith('field:')){
    const name=attribute.slice(6);
    if(!/^[a-z0-9_-]{1,64}$/i.test(name))return [];
    const value=f[name];
    return typeof value==='string'||typeof value==='number'?[String(value)]:
      Array.isArray(value)?value.filter(x=>typeof x==='string'):[];
  }
  return [];
}
export function searchPosts(items,{
  query='',attribute='all',includeTags=[],excludeTags=[],excludeKinds=[],
  minScore=0,scoreFor=()=>0,sort='new',onlyFlagged=false,
  reactionScore=()=>0
}={}){
  const needles=norm(query).trim().split(/\s+/).filter(Boolean);
  const includes=includeTags.map(norm).filter(Boolean),excludes=excludeTags.map(norm).filter(Boolean);
  const blocked=new Set(excludeKinds);
  const filtered=items.filter(item=>{
    const p=item.event.payload,f=p.body.fields||{},t=tags(item);
    if(blocked.has(postKind(item)))return false;
    if(onlyFlagged && item.decision.visible)return false;
    if(!onlyFlagged && !item.decision.visible)return false;
    if(includes.some(tag=>!t.includes(tag)))return false;
    if(excludes.some(tag=>t.includes(tag)))return false;
    if(minScore>0 && scoreFor(p.author)<minScore)return false;
    if(needles.length){
      const haystack=fieldValues(item,attribute).map(norm).join(' ');
      if(needles.some(q=>!haystack.includes(q)))return false;
    }
    return true;
  });
  if(sort==='old')filtered.sort((a,b)=>a.event.payload.time-b.event.payload.time);
  else if(sort==='popular')filtered.sort((a,b)=>
    reactionScore(b.event.id)-reactionScore(a.event.id)||b.event.payload.time-a.event.payload.time);
  else filtered.sort((a,b)=>b.event.payload.time-a.event.payload.time);
  return filtered;
}
export function tagCloud(items,{max=40}={}){
  const counts=new Map();
  for(const item of items)for(const tag of new Set(tags(item))){
    if(!/^[a-z0-9][a-z0-9._:-]{0,47}$/.test(tag))continue;
    counts.set(tag,(counts.get(tag)||0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,max)
    .map(([tag,count])=>({tag,count}));
}
export function availableSpaces(events,followed=[]){
  const count=new Map();
  for(const event of events){
    if(event.payload?.kind!=='post')continue;
    const s=event.payload.space;
    count.set(s,(count.get(s)||0)+1);
  }
  for(const s of followed)if(typeof s==='string'&&!count.has(s))count.set(s,0);
  return [...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .map(([name,count])=>({name,count}));
}