// Optional, operator-invoked comparison/repair between TWO independent
// WEB9000 WebSocket bridges. No privileged registry, automatic mutation,
// global history completeness, or browser/media mirroring is implied.
import {WebSocket} from 'ws';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifyEvent} from '../core/events.js';

const HEX='0123456789abcdef';
const ID=/^sha256:[0-9a-f]{64}$/;
const MAX_DIFF=1024;
const MAX_COMMANDS=2000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function validSpaces(spaces){
  if(!Array.isArray(spaces)||!spaces.length||spaces.length>64 ||
     spaces.some(s=>typeof s!=='string'||!s.length||s.length>180||/[\x00-\x1f]/.test(s)))
    throw Error('Invalid reconciliation namespace scopes');
  return spaces.includes('*')?['*']:[...new Set(spaces)];
}

// The bridge serializes replies per WebSocket. Ignore unsolicited live
// publication frames; the subscription's frozen snapshot is our comparison.
export async function openInventoryPeer(url,spaces=['*'],{throttleMs=0,timeoutMs=15000}={}){
  if(!/^wss?:\/\//.test(url))throw Error('WebSocket URL required');
  spaces=validSpaces(spaces);
  const ws=new WebSocket(url,{perMessageDeflate:false,maxPayload:2*1024*1024});
  let pending=null,closed=false,lastRequest=0;
  const frames=[];
  const opened=new Promise((resolve,reject)=>{
    ws.once('open',resolve);ws.once('error',reject);
  });
  ws.on('message',raw=>{
    let msg;
    try{msg=JSON.parse(raw.toString('utf8'));}catch{return;}
    if(msg.type==='event'||msg.type==='hello')return;
    frames.push(msg);
    if(frames.length>64)frames.shift();
    if(!pending)return;
    if(msg.type==='error'||msg.type==='reject'){
      const current=pending;pending=null;
      current.reject(Error('Peer refused request: '+(msg.error||msg.reason)));
    }else if(msg.type===pending.expect){
      const current=pending;pending=null;current.resolve(msg);
    }
  });
  ws.on('error',error=>{
    closed=true;
    if(pending){const p=pending;pending=null;p.reject(error);}
  });
  ws.on('close',()=>{
    closed=true;
    if(pending){const p=pending;pending=null;p.reject(Error('Peer disconnected'));}
  });
  await opened;
  const api={
    url,
    async request(msg,expect){
      if(closed||ws.readyState!==WebSocket.OPEN)throw Error('Peer disconnected');
      if(pending)throw Error('Do not issue parallel commands on a reconciliation socket');
      if(throttleMs){
        const wait=throttleMs-(Date.now()-lastRequest);
        if(wait>0)await sleep(wait);
      }
      lastRequest=Date.now();
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{
          if(pending?.timer===timer){pending=null;reject(Error('Peer response timeout'));}
        },timeoutMs);
        const wrapped={
          expect,timer,
          resolve(value){clearTimeout(timer);resolve(value);},
          reject(error){clearTimeout(timer);reject(error);}
        };
        pending=wrapped;
        try{ws.send(JSON.stringify(msg));}
        catch(error){pending=null;wrapped.reject(error);}
      });
    },
    close(){ws.terminate();},
    frames
  };
  try{
    await api.request({type:'subscribe',spaces},'subscribed');
    return api;
  }catch(error){api.close();throw error;}
}

async function inventory(peer,prefix){
  const msg=await peer.request({type:'inventory',prefix},'inventory');
  if(msg.prefix!==prefix||!Number.isSafeInteger(msg.count)||msg.count<0||
     !/^[a-f0-9]{64}$/.test(msg.digest))throw Error('Invalid peer inventory');
  return msg;
}
async function allIds(peer,prefix,{onPage}={}){
  const ids=[];
  let cursor=null;
  do{
    const msg=await peer.request({type:'inventory-ids',prefix,cursor},'inventory-ids');
    if(msg.prefix!==prefix||!Array.isArray(msg.ids)||msg.ids.length>32||
      msg.ids.some(id=>!ID.test(id)||!id.startsWith('sha256:'+prefix)||
        (cursor!==null&&id<=cursor)))
      throw Error('Malformed or unsorted peer IDs');
    if(msg.ids.some((id,index)=>index>0&&id<=msg.ids[index-1]))
      throw Error('Unsorted or duplicate peer IDs');
    if(msg.next!==null&&
       (!ID.test(msg.next)||msg.next!==msg.ids.at(-1)))
      throw Error('Invalid peer cursor');
    ids.push(...msg.ids);
    cursor=msg.next;
    onPage?.();
    if(ids.length>MAX_DIFF*8)throw Error('Inventory range exceeds safe comparison budget');
  }while(cursor!==null);
  return ids;
}

/** Compare two unauthenticated LOCAL observations, not a completeness proof. */
export async function compareMirrorInventories(first,second,{maxDifferences=MAX_DIFF}={}){
  if(!Number.isSafeInteger(maxDifferences)||maxDifferences<1||maxDifferences>MAX_DIFF)
    throw Error('Invalid difference budget');
  const missingFromFirst=[],missingFromSecond=[];
  const digestIds=ids=>{
    const hash=createHash('sha256');
    for(const id of ids){hash.update(id,'utf8');hash.update('\\n','utf8');}
    return hash.digest('hex');
  };
  let commands=0,examinedLeaves=0;
  async function descend(prefix){
    if(++commands>MAX_COMMANDS)throw Error('Reconciliation command budget exceeded');
    const [a,b]=await Promise.all([inventory(first,prefix),inventory(second,prefix)]);
    if(a.count===b.count&&a.digest===b.digest)return;
    if(Math.max(a.count,b.count)>32&&prefix.length<6){
      for(const character of HEX)await descend(prefix+character);
      return;
    }
    const [aIds,bIds]=await Promise.all([allIds(first,prefix),allIds(second,prefix)]);
    if(aIds.length!==a.count||bIds.length!==b.count)
      throw Error('Inventory count and returned IDs disagree');
    if(digestIds(aIds)!==a.digest||digestIds(bIds)!==b.digest)
      throw Error('Peer fingerprint disagrees with its signed-record ID listing');
    const aSet=new Set(aIds),bSet=new Set(bIds);
    for(const id of aIds)if(!bSet.has(id))missingFromSecond.push(id);
    for(const id of bIds)if(!aSet.has(id))missingFromFirst.push(id);
    if(missingFromFirst.length+missingFromSecond.length>maxDifferences)
      throw Error('Reconciliation difference budget exceeded');
    examinedLeaves++;
  }
  await descend('');
  return {missingFromFirst:missingFromFirst.sort(),
    missingFromSecond:missingFromSecond.sort(),examinedLeaves,
    summary:'Differences between two peer-reported snapshots only; neither is globally complete'};
}

async function fetchSigned(peer,ids){
  const events=[];
  for(let n=0;n<ids.length;n+=8){
    const desired=ids.slice(n,n+8);
    const answer=await peer.request({type:'inventory-get',ids:desired},'inventory-records');
    if(!Array.isArray(answer.events)||answer.events.length!==desired.length)
      throw Error('Source no longer serves requested signed records');
    const byId=new Map(answer.events.map(e=>[e.id,e]));
    for(const id of desired){
      const event=byId.get(id);
      if(!event||!await verifyEvent(event))
        throw Error('Invalid signature/identity from source peer');
      events.push(event);
    }
  }
  return events;
}

/** Explicit, independently admitted metadata-only copy; never media bytes. */
export async function repairMirrorDifference(first,second,difference,{to}={}){
  if(!['first','second','both'].includes(to))
    throw Error('Repair requires explicit target first, second or both');
  const result={toFirst:0,toSecond:0};
  async function copy(source,target,ids,field){
    if(ids.length>MAX_DIFF)throw Error('Too many records for bounded repair');
    for(const event of await fetchSigned(source,ids)){
      const response=await target.request({type:'publish',event},'ack');
      if(response.id!==event.id)throw Error('Incorrect publish acknowledgement');
      result[field]++;
    }
  }
  if(to==='first'||to==='both')
    await copy(second,first,difference.missingFromFirst,'toFirst');
  if(to==='second'||to==='both')
    await copy(first,second,difference.missingFromSecond,'toSecond');
  return result;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const args=process.argv.slice(2),urls=args.filter(a=>/^wss?:\/\//.test(a));
  const spaces=args.filter(a=>a.startsWith('--space=')).map(a=>a.slice(8));
  const target=args.find(a=>a.startsWith('--repair-to='))?.slice(12);
  if(urls.length!==2||args.some(a=>!urls.includes(a)&&
     !a.startsWith('--space=')&&!a.startsWith('--repair-to='))||
     (target&&!['first','second','both'].includes(target))){
    console.error('Usage: node reconcile-mirrors.mjs ws://peer-one ws://peer-two [--space=demo] [--repair-to=first|second|both]');
    process.exitCode=2;
  }else{
    let first,second;
    try{
      // The test bridge rate limit is 90 messages/minute per connection.
      // This slow operator CLI respects that; tests use unthrottled peers.
      first=await openInventoryPeer(urls[0],spaces.length?spaces:['*'],{throttleMs:750});
      second=await openInventoryPeer(urls[1],spaces.length?spaces:['*'],{throttleMs:750});
      const diff=await compareMirrorInventories(first,second);
      console.log(JSON.stringify(diff,null,2));
      if(target){
        const copied=await repairMirrorDifference(first,second,diff,{to:target});
        console.log('Explicit metadata repair:',copied);
      }
    }catch(error){
      console.error('Reconciliation failed:',error.message);
      process.exitCode=1;
    }finally{first?.close();second?.close();}
  }
}
