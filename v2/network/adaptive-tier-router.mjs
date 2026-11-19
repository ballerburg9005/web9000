// Experimental, operator-local adaptive physical OrbitDB sharding.
// Not loaded by the live WEB9000 node or browsers.
// No global karma authority, universal rejection, country blacklist or migration.
import {createHash,randomBytes} from 'node:crypto';
import {IPFSAccessController} from '@orbitdb/core';
import {verifyEvent} from '../core/events.js';
import {classifyNetworkObservation} from './source-compartments.mjs';

const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const ID=/^sha256:[0-9a-f]{64}$/;
const CLASSES=['entry','sponsored','established'];
const FEEDBACK=new Set(['reaction','tag-vote','poll-choice','content-rating',
  'group-rating','reviewer-conduct','reviewer-candidacy','vote','endorse']);

function bounded(n,max,label,min=0){
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid '+label);
  return n;
}
function keyedBucket(secret,cohort){
  return createHash('sha256').update(secret).update('source:').update(cohort).digest('hex').slice(0,24);
}
// Public votes, downvotes, and karma claims are not independent admission proof.
// This is a diagnostic summary only. Group weights must come from an external
// reader-selected, ratified trust interpreter, never the signed vote itself.
export function summarizeAttestedOpinions(votes=[],trustedGroupWeights=new Map()){
  const latest=new Map();
  for(const vote of votes){
    if(vote?.verified!==true||!AUTHOR.test(vote.signer||'')||
       !['up','down'].includes(vote.choice)||typeof vote.group!=='string')continue;
    const weight=trustedGroupWeights.get(vote.group);
    if(!Number.isFinite(weight)||weight<=0||weight>1)continue;
    const key=vote.group+'|'+vote.signer;
    const observed=Number.isSafeInteger(vote.observedAt)?vote.observedAt:0;
    if(!latest.has(key)||observed>=latest.get(key).observed)
      latest.set(key,{group:vote.group,choice:vote.choice,observed,weight});
  }
  const groups=new Map();
  for(const value of latest.values()){
    const totals=groups.get(value.group)||{up:0,down:0,weight:value.weight};
    totals[value.choice]++;groups.set(value.group,totals);
  }
  let positive=0,negative=0,positiveGroups=0,negativeGroups=0;
  for(const {up,down,weight} of groups.values()){
    if(up){positiveGroups++;positive+=weight*Math.min(1,up/3);}
    if(down){negativeGroups++;negative+=weight*Math.min(1,down/3);}
  }
  return Object.freeze({
    positiveEvidence:+positive.toFixed(3),
    negativeOpinion:+negative.toFixed(3),
    independentSupportingGroups:positiveGroups,
    independentCriticalGroups:negativeGroups,
    // A new key starts at entry; a negative score cannot go below entry.
    // A positive score never by itself authorizes privileged replication.
    admissionClass:'entry',
    promotionAuthorized:false
  });
}

// A physically distinct OrbitDB log with a curator-only WRITE identity.
// The events inside retain their ORIGINAL independently verified authors.
// This protects the local operator's admissions; it cannot own a namespace,
// invalidate raw records elsewhere, or authorize a universal publication gate.
export async function openLocalAdaptiveShard(orbitdb,name,{address=null}={}){
  if(!/^w9-adaptive-[a-z0-9-]{1,120}$/.test(name)||
     !orbitdb?.identity?.id)throw Error('Invalid local shard configuration');
  if(address!==null&&
     (typeof address!=='string'||!/^\/orbitdb\/[a-zA-Z0-9]{16,220}$/.test(address)))
    throw Error('Invalid pinned shard address');
  const db=await orbitdb.open(address||name,{
    type:'events',AccessController:IPFSAccessController({write:[orbitdb.identity.id]})
  });
  if(address!==null&&db.address!==address){
    await db.close();throw Error('Shard address changed unexpectedly');
  }
  return {
    address:db.address,name,
    async publish(event){
      if(!await verifyEvent(event))throw Error('Invalid signed event');
      return db.add(event);
    },
    async events(){return (await db.all()).map(row=>row.value);},
    async close(){await db.close();}
  };
}

// Hash source groups into a *bounded* number of predeclared physical shard
// names, never one DB per author, IP, ASN, country, namespace, or network peer.
// Cohort metadata is an ephemeral OPERATOR observation, not signed content.
// If traffic arrives through a relay, the last hop is not the author origin.
export class AdaptiveTierRouter {
  #open;#attest;#now;#secret;#prefix;#maxShards;#windowMs;
  #active=new Map([['entry',1],['sponsored',1],['established',1]]);
  #openShards=new Map();#opening=new Map();#used=new Map();
  #cohorts=new Set();#authors=new Set();#window=-1;#rejected=0;
  #lastSplitEpoch=-1;#quietWindows=0;
  #boxes=new Map();#maxBoxes;#boxCap;
  #inFlight=0;#maxInFlight;#classCaps;#sourceCap;#authorCap;
  #cached=new Map();#pendingAttestations=0;#maxPendingAttestations;
  #verificationCap;#verificationSourceCap;#cacheTtlMs;
  #summary={accepted:0,limited:0,invalid:0,duplicate:0};
  #seen=new Set();
  constructor({openShard,verifyAttestation=async()=>null,
    now=()=>Date.now(),maxShards=100,windowSeconds=60,
    namePrefix='w9-adaptive-test',entryBudget=80,
    sponsoredBudget=50,establishedBudget=150,
    sourceBudget=12,authorBudget=6,maxInFlight=12,
    maxBoxes=24,entryCompartmentBudget=24,
    maxPendingAttestations=2,verificationBudget=24,
    verificationSourceBudget=3,cacheTtlMs=300000,
    secret=randomBytes(32)}={}){
    if(typeof openShard!=='function'||typeof verifyAttestation!=='function'||
       typeof now!=='function')throw Error('Missing independent shard opener/verifier');
    bounded(maxShards,100,'maxShards',1);
    bounded(windowSeconds,3600,'windowSeconds',1);
    for(const [val,key] of [[entryBudget,'entryBudget'],[sponsoredBudget,'sponsoredBudget'],
      [establishedBudget,'establishedBudget'],[sourceBudget,'sourceBudget'],
      [authorBudget,'authorBudget'],[maxInFlight,'maxInFlight'],
      [maxPendingAttestations,'maxPendingAttestations'],
      [verificationBudget,'verificationBudget'],
      [verificationSourceBudget,'verificationSourceBudget']])
      bounded(val,100000,'budget '+key,1);
    bounded(cacheTtlMs,300000,'cacheTtlMs',1000);
    bounded(maxBoxes,100,'maxBoxes',1);
    bounded(entryCompartmentBudget,100000,'entryCompartmentBudget',1);
    if(!/^w9-adaptive-[a-z0-9-]{1,70}$/.test(namePrefix))
      throw Error('Unsafe shard name prefix');
    if(!Buffer.isBuffer(secret)||secret.length<16)throw Error('Invalid secret');
    this.#open=openShard;this.#attest=verifyAttestation;this.#now=now;
    this.#prefix=namePrefix;this.#secret=secret;this.#maxShards=maxShards;
    this.#windowMs=windowSeconds*1000;this.#maxInFlight=maxInFlight;
    this.#classCaps={entry:entryBudget,sponsored:sponsoredBudget,
      established:establishedBudget};
    this.#sourceCap=sourceBudget;this.#authorCap=authorBudget;
    this.#maxBoxes=maxBoxes;this.#boxCap=entryCompartmentBudget;
    this.#maxPendingAttestations=maxPendingAttestations;
    this.#verificationCap=verificationBudget;
    this.#verificationSourceCap=verificationSourceBudget;
    this.#cacheTtlMs=cacheTtlMs;
  }
  get status(){
    return {
      active:Object.fromEntries(this.#active),
      compartments:[...this.#boxes].map(([bucket,box])=>({
        bucket,activePartitions:box.width,rejections:box.rejected,
        observations:box.sources.size
      })),
      shards:[...this.#openShards].map(([name,db])=>({name,address:db.address})),
      counts:{...this.#summary},windowRejected:this.#rejected,
      distinctObservedSources:this.#cohorts.size,
      accountingSizes:{sourceCohorts:this.#cohorts.size,
        signerBuckets:this.#authors.size,quotaKeys:this.#used.size,
        cachedProofs:this.#cached.size}
    };
  }
  #resetEpoch(now){
    const epoch=Math.floor(now/this.#windowMs);
    if(epoch!==this.#window){
      if(this.#window>=0&&epoch>this.#window){
        this.#quietWindows=this.#rejected===0?
          this.#quietWindows+Math.min(3,epoch-this.#window):0;
        if(this.#quietWindows>=3&&this.#active.get('entry')>1){
          this.#active.set('entry',Math.max(1,Math.ceil(this.#active.get('entry')/2)));
          this.#quietWindows=0;
          // Older records remain in prior, independently indexed logs.
        }
      }
      for(const box of this.#boxes.values()){
        if(this.#window>=0&&epoch>this.#window){
          box.quiet=box.rejected===0?
            box.quiet+Math.min(3,epoch-this.#window):0;
          if(box.quiet>=3&&box.width>1){
            box.width=Math.max(1,Math.ceil(box.width/2));
            box.quiet=0;
          }
        }
        box.sources.clear();box.rejected=0;
      }
      this.#window=epoch;this.#used.clear();
      this.#cohorts.clear();this.#authors.clear();this.#rejected=0;
    }
  }
  // Proof verification runs on a separate, tightly bounded control plane.
  // Incoming event JSON NEVER triggers the potentially expensive verifier.
  // Only this locally validated, short-lived cache can elevate a signer.
  // No fee-to-karma or raw likes are accepted.
  async registerAttestation(author,evidence,{sourceCohort=''}={}){
    const now=this.#now();
    this.#resetEpoch(now);
    if(!AUTHOR.test(author||''))return {qualified:false,reason:'bad-subject'};
    const source=this.#sourceKey(sourceCohort);
    const caps=[
      ['verify:global',this.#verificationCap],
      ['verify:source:'+source,this.#verificationSourceCap]
    ];
    if(this.#pendingAttestations>=this.#maxPendingAttestations||
      caps.some(([key,cap])=>(this.#used.get(key)||0)>=cap))
      return {qualified:false,reason:'verification-queue-or-budget-full'};
    for(const [key] of caps)this.#used.set(key,(this.#used.get(key)||0)+1);
    this.#pendingAttestations++;
    let proof;
    try{proof=await this.#attest({author,evidence});}
    catch{return {qualified:false,reason:'independent-proof-unavailable'};}
    finally{this.#pendingAttestations--;}
    if(proof?.verification!=='independent'||proof.subject!==author||
       !['sponsored','established'].includes(proof.className)||
       !Number.isSafeInteger(proof.validUntil)||proof.validUntil<=now||
       proof.validUntil>now+this.#cacheTtlMs)
      return {qualified:false,reason:'independent-proof-not-established'};
    if(this.#cached.size>=4096)this.#cached.delete(this.#cached.keys().next().value);
    this.#cached.set(author,{className:proof.className,validUntil:proof.validUntil});
    return {qualified:true,className:proof.className,validUntil:proof.validUntil};
  }
  #classify(author,now){
    const proof=this.#cached.get(author);
    if(!proof)return 'entry';
    if(proof.validUntil<=now){this.#cached.delete(author);return 'entry';}
    return proof.className;
  }
  #sourceKey(sourceCohort){
    const hash=keyedBucket(this.#secret,
      typeof sourceCohort==='string'&&sourceCohort.length<=160?
        sourceCohort:'unknown');
    if(!this.#cohorts.has(hash)&&this.#cohorts.size>=256)
      return 'overflow-cohort';
    this.#cohorts.add(hash);
    return hash;
  }
  #compartment(observation){
    if(!observation)return 'general';
    const result=classifyNetworkObservation(observation,{secret:this.#secret});
    if(!result.observationAccepted)return 'general';
    if(this.#boxes.has(result.bucket))return result.bucket;
    // Only an admitted, VERIFIED event creates a new compartment entry.
    // Bad signatures / bogus network reports cannot exhaust all box slots.
    if(this.#boxes.size>=this.#maxBoxes)return 'overflow';
    return result.bucket;
  }
  #activateBox(box){
    if(box==='general'||box==='overflow')return;
    if(!this.#boxes.has(box)){
      if(this.#boxes.size>=this.#maxBoxes)return;
      this.#boxes.set(box,{width:1,rejected:0,quiet:0,
        lastSplitEpoch:-1,sources:new Set()});
    }
  }
  #entryWidth(box){
    if(box==='general')return this.#active.get('entry');
    return this.#boxes.get(box)?.width||1;
  }
  #activeTotal(){
    return this.#active.get('entry')+
      [...this.#boxes.values()].reduce((sum,box)=>sum+box.width,0)+
      1; // reserve the overflow compartment for future distinct sources
  }
  #recordCompartmentRejection(box,source){
    if(box==='general'){
      this.#rejected++;
      this.#maybeAdapt();
      return;
    }
    const entry=this.#boxes.get(box);
    if(!entry)return; // Never provision a compartment from rejected traffic.
    entry.rejected++;
    if(entry.sources.size<256)entry.sources.add(source);
    // One rejected isolated compartment never forces other compartments
    // to split or stop accepting new legitimate records.
    if(entry.rejected>=20&&entry.sources.size>=2&&
        entry.lastSplitEpoch!==this.#window&&this.#activeTotal()<this.#maxShards){
      entry.width=Math.min(entry.width*2,
        entry.width+this.#maxShards-this.#activeTotal());
      entry.lastSplitEpoch=this.#window;
      entry.rejected=0;entry.quiet=0;
    }
  }
  #authorKey(author){
    if(!this.#authors.has(author)&&this.#authors.size>=8192)
      return 'overflow-authors';
    this.#authors.add(author);
    return author;
  }
  async #database(name){
    if(this.#openShards.has(name))return this.#openShards.get(name);
    if(this.#opening.has(name))return this.#opening.get(name);
    const promise=(async()=>{
      const db=await this.#open(name);
      if(!db?.publish||typeof db.address!=='string')
        throw Error('Shard callback did not open a durable index');
      this.#openShards.set(name,db);return db;
    })();
    this.#opening.set(name,promise);
    try{return await promise;}finally{this.#opening.delete(name);}
  }
  async offer(event,{sourceCohort='',sourceObservation=null}={}){
    const receipt=this.#now();
    if(!Number.isSafeInteger(receipt)||receipt<0)
      throw Error('Invalid local observer clock');
    this.#resetEpoch(receipt);
    const author=event?.payload?.author;
    if(!AUTHOR.test(author||'')||!ID.test(event?.id||'')){
      this.#summary.invalid++;
      return {accepted:false,reason:'bad-header'};
    }
    let length;
    try{length=Buffer.byteLength(JSON.stringify(event),'utf8');}
    catch{length=Infinity;}
    if(length>48*1024){
      this.#summary.invalid++;
      return {accepted:false,reason:'invalid-envelope-size'};
    }
    // Source origin is provided only by local transport observation, NEVER
    // by a field carried in a signed post or purported geolocation.
    // The source/geo classification is from the OPERATOR network boundary,
    // not JSON from a post. An ordinary signed author has no such field.
    const box=this.#compartment(sourceObservation);
    const networkSource=sourceObservation?.provenance==='operator-observed'?
      String(sourceObservation.networkPrefix||sourceObservation.asn||box):
      sourceCohort;
    const group=this.#sourceKey(networkSource);
    if(this.#inFlight>=this.#maxInFlight){
      this.#summary.limited++;this.#rejected++;
      return {accepted:false,reason:'bounded-verifier-queue'};
    }
    this.#inFlight++;
    try{
      const cls=this.#classify(author,receipt);
      const channel=FEEDBACK.has(event.payload.kind)?'feedback':'content';
      const limits=[
        ['tier:'+cls+':'+channel,this.#classCaps[cls]],
        // A hosting/VPN/country/ASN compartment has its own ceiling, so
        // one box can saturate without shutting down unrelated boxes.
        ['box:'+cls+':'+box+':'+channel,
          cls==='entry'?this.#boxCap:this.#classCaps[cls]],
        ['source:'+cls+':'+group+':'+channel,this.#sourceCap],
        ['author:'+cls+':'+this.#authorKey(author)+':'+channel,this.#authorCap]
      ];
      if(limits.some(([key,cap])=>(this.#used.get(key)||0)>=cap)){
        this.#summary.limited++;
        if(cls==='entry')this.#recordCompartmentRejection(box,group);
        return {accepted:false,className:cls,
          compartment:box,reason:'bounded-ingress-budget'};
      }
      // All three reservations happen before Ed25519/OrbitDB append.
      for(const [key] of limits)this.#used.set(key,(this.#used.get(key)||0)+1);
      if(this.#seen.has(event.id)){
        this.#summary.duplicate++;
        return {accepted:false,reason:'already-observed',className:cls};
      }
      if(!await verifyEvent(event)){
        this.#summary.invalid++;
        return {accepted:false,reason:'invalid-signature',className:cls};
      }
      this.#activateBox(box);
      const width=cls==='entry'?this.#entryWidth(box):this.#active.get(cls);
      const hash=createHash('sha256').update(this.#secret).update(group).digest();
      const shardIndex=hash.readUInt32BE(0)%width;
      // Opaque compartment IDs keep country/ASN/network private.
      const suffix=box!=='general'?'-'+box:'';
      const name=this.#prefix+'-'+cls+suffix+
        '-s'+String(shardIndex).padStart(3,'0');
      // Hard physical resource ceiling across ALL classes and compartments.
      // Decline this operator's new shard; preserve the signed record's
      // portability to independently willing indexes.
      if(!this.#openShards.has(name)&&!this.#opening.has(name)&&
          this.#openShards.size+this.#opening.size>=this.#maxShards){
        this.#summary.limited++;
        return {accepted:false,className:cls,compartment:box,
          reason:'operator-shard-capacity'};
      }
      const db=await this.#database(name);
      await db.publish(event);
      this.#seen.add(event.id);
      if(this.#seen.size>2048)this.#seen.delete(this.#seen.values().next().value);
      this.#summary.accepted++;
      return {accepted:true,className:cls,compartment:box,
        shard:name,address:db.address};
    }finally{this.#inFlight--;}
  }
  // AUTOMATIC entry pressure splitting is bounded to one split per
  // observation window, and one abusive datacenter cannot mint 100 logs.
  // The combined class budget stays FIXED across every subshard.
  #maybeAdapt(){
    let width=this.#active.get('entry');
    if(this.#rejected>=20&&this.#cohorts.size>=2&&
       this.#lastSplitEpoch!==this.#window&&this.#activeTotal()<this.#maxShards){
      width=Math.min(width+this.#maxShards-this.#activeTotal(),
        Math.max(width+1,width*2));
      this.#active.set('entry',width);
      this.#lastSplitEpoch=this.#window;
      this.#quietWindows=0;
      this.#rejected=0;
    }
  }
  // Operators may tick this even during quiet periods. Shrinking only
  // affects future writes and never deletes old shard addresses/records.
  adapt(){
    this.#resetEpoch(this.#now());
    this.#maybeAdapt();
    return {entryPartitions:this.#active.get('entry'),
      historicalShardsRemain:true,maxShards:this.#maxShards};
  }
  async close(){
    for(const db of [...this.#openShards.values()].reverse())
      await db.close?.();
    this.#openShards.clear();
  }
}
