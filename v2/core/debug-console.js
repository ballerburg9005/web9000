// Read-only local inspection of verified signed records and bounded wire traces.
// No private signing keys, IndexedDB authentication material, or remote fetches.
const HEX=/^sha256:[0-9a-f]{64}$/;
export function discussionRecords(events,postId,{limit=2000}={}){
 if(!HEX.test(postId))throw Error('Invalid root post ID');
 const selected=new Set([postId]),found=[],seen=new Set();
 const records=Array.isArray(events)?events:[];
 // A 32 KiB signed reply cannot become a child cycle, but bound traversal.
 for(let pass=0;pass<Math.min(limit,records.length)+1;pass++){
  let grew=false;
  for(const e of records){
   if(e?.payload?.kind!=='reply'||!HEX.test(e.id)||seen.has(e.id))continue;
   if(!selected.has(e.payload.body?.parent))continue;
   if(found.length>=limit)break;
   selected.add(e.id);seen.add(e.id);found.push(e);grew=true;
  }
  if(!grew||found.length>=limit)break;
 }
 // Include reply reactions/tags/labels that refer to any actual comment.
 const related=records.filter(e=>e?.payload&&
  ['reaction','tag-vote','label'].includes(e.payload.kind)&&
  seen.has(e.payload.body?.target)).slice(0,limit);
 return {root:postId,replyCount:found.length,events:[...found,...related]};
}
const idPart=(value)=>String(value??'').toLowerCase();
export function filterDebugEntries(entries,{kind='',space='',author='',query='',limit=150}={}){
 const q=idPart(query).trim(),k=idPart(kind).trim();
 const s=idPart(space).trim(),a=idPart(author).trim();
 const max=Math.max(1,Math.min(500,Number(limit)||150));
 const output=[];
 for(const item of entries||[]){
  if(!item||typeof item!=='object')continue;
  const event=item.event||item.raw?.event||null;
  const data=event?.payload;
  const type=idPart(item.kind||data?.kind||item.type);
  if(k&&type!==k)continue;
  if(s&&!idPart(item.space||data?.space).includes(s))continue;
  if(a&&!idPart(item.author||data?.author).includes(a))continue;
  if(q&&!JSON.stringify(item).toLowerCase().includes(q))continue;
  output.push(item);
  if(output.length>=max)break;
 }
 return output;
}
export function summarizeSignedEvents(events){
 const counts=Object.create(null),spaces=Object.create(null);
 for(const e of events||[]){
  if(!e?.payload)continue;
  counts[e.payload.kind]=(counts[e.payload.kind]||0)+1;
  spaces[e.payload.space]=(spaces[e.payload.space]||0)+1;
 }
 return {total:events?.length||0,kinds:counts,spaces};
}
export class DebugTrace{
 constructor({limit=250,bytesPerPacket=16384}={}){
  this.limit=Math.max(1,Math.min(limit,1000));
  this.bytesPerPacket=Math.max(512,Math.min(bytesPerPacket,65536));
  this.entries=[];this.nextSequence=1;
 }
 restore(entries){
  if(!Array.isArray(entries))return 0;
  const restored=[];
  for(const item of entries.slice(-this.limit)){
   if(!item||typeof item!=='object'||!Number.isSafeInteger(item.seq)||
      item.seq<1||typeof item.raw!=='string'||item.raw.length>this.bytesPerPacket||
      typeof item.at!=='string'||typeof item.direction!=='string'||
      typeof item.peer!=='string'||typeof item.type!=='string')continue;
   restored.push({
    seq:item.seq,at:item.at.slice(0,40),direction:item.direction.slice(0,32),
    peer:item.peer.slice(0,512),type:item.type.slice(0,60),
    message:typeof item.message==='string'?item.message.slice(0,1000):'',
    raw:item.raw,truncated:item.truncated===true,
    originalCharacters:Number.isSafeInteger(item.originalCharacters)?item.originalCharacters:item.raw.length
   });
  }
  this.entries=restored;
  this.nextSequence=1+Math.max(0,...restored.map(x=>x.seq));
  return restored.length;
 }
 push({direction='local',peer='',packet,type='status',message=''}={}){
  const source=typeof packet==='string'?packet:packet===undefined?'':
    JSON.stringify(packet);
  const truncated=source.length>this.bytesPerPacket;
  const item={seq:this.nextSequence++,at:new Date().toISOString(),direction,peer:String(peer).slice(0,512),
    type:String(type).slice(0,60),message:String(message).slice(0,1000),
    raw:source.slice(0,this.bytesPerPacket),truncated,
    originalCharacters:source.length};
  this.entries.push(item);
  if(this.entries.length>this.limit)this.entries.shift();
  return item;
 }
 clear(){this.entries.length=0;}
}
