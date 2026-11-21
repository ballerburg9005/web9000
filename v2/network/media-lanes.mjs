// Bounded per-size physical media transfer lanes. Distinct tiny/small
// slots stay available even when all heavy video slots are saturated.
// Within each lane, lower rank gets the next available slot.
// Heavy ingress and egress get independently paced *per operator peer*.
// This limits the impact of video floods on small-image bandwidth.
import {setTimeout as delay} from 'node:timers/promises';
const KiB=1024,MiB=1024*KiB;
const rates=Object.freeze({
 tiny:{in:0,out:0},small:{in:0,out:0},
 standard:{in:4*MiB,out:2*MiB},
 heavy:{in:2*MiB,out:512*KiB}
});
const limits=Object.freeze({tiny:3,small:3,standard:2,heavy:1});
const queues=Object.freeze({tiny:12,small:12,standard:6,heavy:2});
export function createMediaLanes(){
 const state=Object.fromEntries(Object.keys(limits).map(k=>[k,{
  running:0,pending:[],limit:limits[k],maxPending:queues[k],
  uploadAt:0,downloadAt:0
 }]));
 const releaseFor=entry=>{
  let released=false;
  return ()=>{
   if(released)return;
   released=true;
   const next=entry.pending.shift();
   if(next)next.resolve(releaseFor(entry));
   else entry.running--;
  };
 };
 function acquire(kind,priority){
  const entry=state[kind];
  if(!entry||!Number.isSafeInteger(priority))
   throw Error('Invalid media priority lane');
  if(entry.running<entry.limit){
   entry.running++;
   return Promise.resolve(releaseFor(entry));
  }
  if(entry.pending.length>=entry.maxPending){
   const err=Error('Media priority lane saturated; retry later');
   err.status=429;
   return Promise.reject(err);
  }
  return new Promise(resolve=>{
   entry.pending.push({priority,resolve});
   entry.pending.sort((a,b)=>a.priority-b.priority);
  });
 }
 async function takeBytes(kind,bytes,{direction='out'}={}){
  const entry=state[kind],rate=rates[kind]?.[direction];
  if(!entry||!Number.isSafeInteger(bytes)||bytes<0||
     !['in','out'].includes(direction))
   throw Error('Invalid media bandwidth budget');
  if(rate===0||bytes===0)return;
  const key=direction==='in'?'uploadAt':'downloadAt';
  const now=performance.now();
  const when=Math.max(now,entry[key]);
  entry[key]=when+bytes/rate*1000;
  if(when>now)await delay(Math.ceil(when-now));
 }
 async function run(kind,priority,operation){
  if(typeof operation!=='function')throw Error('Media transfer must be a function');
  const release=await acquire(kind,priority);
  try{return await operation();}finally{release();}
 }
 return {acquire,run,takeBytes,
  stats:()=>Object.fromEntries(Object.entries(state).map(
   ([name,x])=>[name,{running:x.running,queued:x.pending.length,
    capacity:x.limit,maximumQueue:x.maxPending}]))};
}
