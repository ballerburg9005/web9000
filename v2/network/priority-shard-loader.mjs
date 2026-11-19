// Opt-in bounded shard activation for WEB9000's independently chosen
// replication operator. The manifest may contain 100+ historical addresses,
// yet this reader initially opens only the most important 20 (or operator's
// cap). Priority is ESTABLISHED > SPONSORED > ENTRY; this does NOT assign
// universal social status, govern a namespace or delete dormant records.
//
// A verified, operator-pinned signed directory is mandatory. An ordinary
// author may still publish identical signed records to any other willing
// independent peer, regardless of this reader's activation schedule.
import {verifySignedShardDirectory} from './signed-shard-directory.mjs';

const TIER_ORDER={established:0,sponsored:1,entry:2};
const TIER_SUFFIX=/-(established|sponsored|entry)(?:-c[0-9a-f]{20})?-s[0-9]{3}$/;

export function shardTier(name){
  const match=typeof name==='string'?TIER_SUFFIX.exec(name):null;
  return match?match[1]:null;
}
const byPriority=(a,b)=>TIER_ORDER[shardTier(a.name)]-TIER_ORDER[shardTier(b.name)]||
  a.name.localeCompare(b.name);

export class PriorityShardLoader{
  #open;#limit;#entries=new Map();#active=new Map();#step=0;
  #operations=Promise.resolve();#operator=null;#revision=0;#digest=null;
  #opening=[];#evictions=0;#entryReserve;
  #queued=0;#maxQueued=64;
  constructor({openShard,maxActive=20,entryReserve=1}={}){
    if(typeof openShard!=='function')throw Error('Shard opener callback required');
    if(!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>100)
      throw Error('maxActive must be 1..100');
    if(!Number.isSafeInteger(entryReserve)||entryReserve<0||
       entryReserve>=maxActive&&maxActive>1)
      throw Error('entryReserve must leave room for protected shards');
    this.#open=openShard;this.#limit=maxActive;
    this.#entryReserve=maxActive===1?0:entryReserve;
  }
  async useDirectory(document,{expectedAuthor,minimumRevision=0,expectedDigest=null}={}){
    return this.#serialize(async()=>{
      const verified=await verifySignedShardDirectory(document,{
        expectedAuthor,minimumRevision,expectedDigest
      });
      if(this.#operator&&this.#operator!==verified.operator)
        throw Error('Cannot silently replace a pinned directory operator');
      if(verified.revision<this.#revision)
        throw Error('Pinned shard directory rollback');
      // Check even when a different signed digest is offered at the SAME
      // revision: independent reader must not silently accept equivocation.
      if(verified.revision===this.#revision&&this.#digest&&
         verified.digest!==this.#digest)
        throw Error('Directory fork at already pinned revision');
      for(const [name,address] of this.#entries)
        if(!verified.entries.some(row=>row.name===name&&row.address===address))
          throw Error('Historical signed shard address was removed or rewritten');
      const next=new Map();
      for(const row of verified.entries){
        if(!shardTier(row.name))throw Error('Unsupported shard class in directory');
        next.set(row.name,row.address);
      }
      this.#entries=next;
      this.#operator=verified.operator;
      this.#revision=verified.revision;this.#digest=verified.digest;
      return this.status;
    });
  }
  #serialize(task){
    // A GUI/client must not queue arbitrarily many lazy history opens.
    // Otherwise queue promises themselves become a low-tier DoS vector.
    if(this.#queued>=this.#maxQueued)
      return Promise.reject(Error('Physical shard activation queue full'));
    this.#queued++;
    const operation=this.#operations.then(task);
    this.#operations=operation.catch(()=>{}).finally(()=>{this.#queued--;});
    return operation;
  }
  get status(){
    const active=[...this.#active].map(([name,item])=>({
      name,address:item.address,tier:shardTier(name)
    })).sort(byPriority);
    return {operator:this.#operator,revision:this.#revision,
      digest:this.#digest,maxActive:this.#limit,
      entryReserve:this.#entryReserve,
      configured:this.#entries.size,active,
      dormant:this.#entries.size-active.length,
      evictions:this.#evictions,openingOrder:[...this.#opening],
      pendingRequests:this.#queued};
  }
  async #activate(name){
    if(!this.#operator||!this.#entries.has(name))
      throw Error('Shard requires a verified pinned directory entry');
    if(this.#active.has(name)){
      this.#active.get(name).lastUsed=++this.#step;
      return {opened:true,alreadyOpen:true,name};
    }
    const tier=shardTier(name);
    if(this.#active.size>=this.#limit){
      // Never allow an entry request to evict protected, independently
      // attested subscriptions merely to browse more low-priority history.
      const entryOpen=[...this.#active].filter(([other])=>
        shardTier(other)==='entry').length;
      const candidates=[...this.#active].filter(([other])=>{
        if(TIER_ORDER[shardTier(other)]<TIER_ORDER[tier])return false;
        // Keep an independently operable free-entry route even if
        // protected history is much larger than the active DB budget.
        if(tier!=='entry'&&shardTier(other)==='entry'&&
           entryOpen<=this.#entryReserve)return false;
        return true;
      });
      candidates.sort((a,b)=>
        TIER_ORDER[shardTier(b[0])]-TIER_ORDER[shardTier(a[0])]||
        a[1].lastUsed-b[1].lastUsed);
      if(!candidates.length)
        return {opened:false,reason:'higher-priority-subscriptions-reserved',name};
      const [victim,old]=candidates[0];
      await old.db.close();
      this.#active.delete(victim);
      this.#evictions++;
    }
    const address=this.#entries.get(name);
    let db;
    try{
      db=await this.#open({name,address,tier});
      if(!db||typeof db.close!=='function'||db.address!==address)
        throw Error('Shard opener failed address pin');
    }catch(error){
      if(db?.close)await db.close().catch(()=>{});
      throw error;
    }
    this.#active.set(name,{db,address,lastUsed:++this.#step});
    this.#opening.push(name);
    if(this.#opening.length>256)this.#opening.shift();
    return {opened:true,alreadyOpen:false,name,tier,address};
  }
  async activate(name){return this.#serialize(()=>this.#activate(name));}
  async restore(){
    return this.#serialize(async()=>{
      if(!this.#operator)throw Error('Verified directory is required before restore');
      const sorted=[...this.#entries].map(([name,address])=>({name,address}))
        .sort(byPriority);
      const entry=sorted.filter(item=>shardTier(item.name)==='entry');
      const protectedShards=sorted.filter(item=>shardTier(item.name)!=='entry');
      // Open priority classes before any unverified subscriptions, while
      // reserving a small explicit free-entry slice if possible.
      const reserve=Math.min(entry.length,this.#entryReserve);
      const order=[
        ...protectedShards.slice(0,this.#limit-reserve),
        ...entry.slice(0,reserve),
        ...protectedShards.slice(this.#limit-reserve),
        ...entry.slice(reserve)
      ];
      const restored=[];
      for(const item of order){
        if(restored.length>=this.#limit)break;
        if(this.#active.has(item.name))continue;
        const result=await this.#activate(item.name);
        if(result.opened)restored.push(result.name);
      }
      return {restored,configured:this.#entries.size,
        active:this.#active.size,dormant:this.#entries.size-this.#active.size};
    });
  }
  async withShard(name,operation){
    if(typeof operation!=='function')throw Error('Read operation required');
    // Do NOT hand a DB out to a delayed callback outside the internal
    // serialization boundary: an eviction could otherwise close it mid-read.
    return this.#serialize(async()=>{
      const result=await this.#activate(name);
      if(!result.opened)return result;
      return operation(this.#active.get(name).db);
    });
  }
  async close(){
    return this.#serialize(async()=>{
      const all=[...this.#active.values()];
      this.#active.clear();
      for(const value of all.reverse())await value.db.close();
    });
  }
}
