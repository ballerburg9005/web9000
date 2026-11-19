// WEB9000 browser bridge: bounded, local, namespace-indexed metadata history.
// This is an acceleration structure over independently signature-verified
// Replica events, NOT a namespace ACL or proof of worldwide completeness.
// It deliberately stores IDs/observation numbers only, never signing keys.
import {createHash} from 'node:crypto';
const ID=/^sha256:[0-9a-f]{64}$/;
const SPACE=s=>typeof s==='string'&&s.length>0&&s.length<=180&& !/[\x00-\x1f]/.test(s);
const MAX_SCOPES=64;
const MAX_PAGE=32;
const PREFIX=/^[0-9a-f]{0,8}$/;

function firstGreater(sorted,cursor){
  let low=0,high=sorted.length;
  while(low<high){
    const mid=(low+high)>>1;
    if(sorted[mid]<=cursor)low=mid+1;else high=mid;
  }
  return low;
}
const insertId=(ids,id)=>ids.splice(firstGreater(ids,id),0,id);
function selectedSpaces(scopes){
  if(!Array.isArray(scopes)||!scopes.length||scopes.length>MAX_SCOPES||
     scopes.some(s=>s!=='*'&&!SPACE(s)))throw Error('Invalid namespace scopes');
  const distinct=[...new Set(scopes)];
  return distinct.includes('*')?['*']:distinct;
}

export class ScopedEventCatalog {
  #all=[];
  #bySpace=new Map();
  #byId=new Map();
  #revision=0;
  constructor(events=[]){
    for(const event of events)this.add(event);
  }
  get size(){return this.#all.length;}
  get revision(){return this.#revision;}
  // Only call after Replica.ingest has verified the event. This method
  // validates shape defensively but intentionally does not re-sign anything.
  add(event){
    const id=event?.id,space=event?.payload?.space;
    if(!ID.test(id)||!SPACE(space))throw Error('Cannot index invalid signed-event identity/space');
    const previous=this.#byId.get(id);
    if(previous){
      if(previous.space!==space)throw Error('Conflicting event ID was assigned to another namespace');
      return false;
    }
    const seq=++this.#revision;
    this.#byId.set(id,{space,seq});
    insertId(this.#all,id);
    const ids=this.#bySpace.get(space)||[];
    insertId(ids,id);
    this.#bySpace.set(space,ids);
    return true;
  }
  // A new browser-history walk sees one fixed sequence number; new arrivals
  // are delivered by live updates and only appear in the NEXT new snapshot.
  // No claim is made that this snapshot includes events withheld by peers.
  capture(scopes){
    const list=selectedSpaces(scopes);
    return Object.freeze({scopes:Object.freeze(list),revision:this.#revision});
  }
  page(snapshot,{cursor=null,limit=MAX_PAGE,prefix=''}={}){
    if(!snapshot||!Array.isArray(snapshot.scopes)||
       !Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||
       snapshot.revision>this.#revision)
      throw Error('Invalid local snapshot');
    const scopes=selectedSpaces(snapshot.scopes);
    if(cursor!==null&&!ID.test(cursor))throw Error('Invalid history cursor');
    if(!PREFIX.test(prefix))throw Error('Invalid inventory prefix');
    if(cursor!==null&&prefix&&!cursor.startsWith('sha256:'+prefix))
      throw Error('Cursor is outside inventory prefix');
    if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)
      throw Error('Invalid history page size');
    const arrays=scopes.includes('*')?[this.#all]:scopes.map(x=>this.#bySpace.get(x)||[]);
    // A prefix is a hexadecimal CID-ID range, NOT a namespace. Search into
    // each sorted namespace list instead of scanning IDs before the range.
    const floor=prefix?'sha256:'+prefix:null;
    const positions=arrays.map(a=>firstGreater(a,cursor??floor??''));
    const ids=[];
    const visited=new Set();
    // At most 64 namespaces × 33 results. Each namespace list is already
    // sorted, making each step independent of other unrequested namespaces.
    while(ids.length<=limit){
      let next=null;
      for(let k=0;k<arrays.length;k++){
        const ary=arrays[k];
        while(positions[k]<ary.length){
          const id=ary[positions[k]];
          // Any ID after the prefix interval cannot match it in this sorted
          // namespace. This is an early stop, not a global completeness claim.
          if(prefix&&!id.startsWith('sha256:'+prefix)){
            positions[k]=ary.length;break;
          }
          const meta=this.#byId.get(id);
          if(!meta||meta.seq>snapshot.revision||visited.has(id)){
            positions[k]++;continue;
          }
          if(next===null||id<next)next=id;
          break;
        }
      }
      if(next===null)break;
      visited.add(next);
      ids.push(next);
      for(let k=0;k<arrays.length;k++){
        if(arrays[k][positions[k]]===next)positions[k]++;
      }
    }
    const hasMore=ids.length>limit;
    if(hasMore)ids.pop();
    return {ids,next:hasMore?ids[ids.length-1]:null,revision:snapshot.revision};
  }
  // Unauthenticated local inventory fingerprint; only its comparison with
  // independently operated peers can reveal disagreement. It is not a
  // witnessed checkpoint or proof that either peer provided all events.
  fingerprint(snapshot,{prefix=''}={}){
    if(!PREFIX.test(prefix))throw Error('Invalid inventory prefix');
    // v1 wire fingerprint: append literal backslash + 'n' after each ID,
    // not an ASCII newline; the browser and operator CLI must match.
    const hash=createHash('sha256');
    let cursor=null,count=0;
    do{
      const page=this.page(snapshot,{cursor,limit:MAX_PAGE,prefix});
      for(const id of page.ids){hash.update(id,'utf8');hash.update('\\n','utf8');count++;}
      cursor=page.next;
    }while(cursor!==null);
    return {prefix,count,digest:hash.digest('hex'),revision:snapshot.revision};
  }
  // Allow explicit bounded fetch of already-indexed signed events only if
  // the event was in this connection's frozen subscription snapshot.
  inSnapshot(snapshot,id){
    if(!snapshot||!Array.isArray(snapshot.scopes)||!ID.test(id))return false;
    const entry=this.#byId.get(id);
    return Boolean(entry&&entry.seq<=snapshot.revision&&
      (snapshot.scopes.includes('*')||snapshot.scopes.includes(entry.space)));
  }
  // Diagnostics counts are LOCAL observations, not receipts/finality.
  counts(){
    return {total:this.#all.length,revision:this.#revision,
      spaces:Object.fromEntries([...this.#bySpace].map(([s,ids])=>[s,ids.length]))};
  }
}
