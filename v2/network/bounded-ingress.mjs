// WEB9000 lab-only bounded pre-OrbitDB HTTP ingress.
// NOT loaded by browser-bridge.mjs/node-peer.mjs or advertised on public web.
// Each separately operated gateway uses trusted socket IP observation and
// manually pinned operator proof issuer; client karma/tier/IP headers are inert.
// Limits and routing are operator choices, not global governance or bans.
import http from 'node:http';
import {isIP} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {classifyNetworkObservation} from './source-compartments.mjs';
import {verifyIngressCapability} from './ingress-capability.mjs';

const MAX_BODY=48*1024;
const MAX_GROUPS=128;
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
function upstreams(input,lane){
  const value={};
  if(!input||typeof input!=='object')throw Error('Configured worker endpoints required');
  for(const tier of ['entry','sponsored','established']){
    const list=input[tier]??[];
    if(!Array.isArray(list)||list.length>20)throw Error('Invalid physical worker list');
    value[tier]=list.map(item=>{
      const u=new URL(item);
      if(u.protocol!=='http:'||
        !['127.0.0.1','[::1]','localhost'].includes(u.hostname)||
        u.username||u.password||u.pathname!=='/'||u.search||u.hash)
        throw Error('Only explicitly configured loopback worker endpoints accepted');
      return u.origin;
    });
  }
  if(value.entry.length+value.sponsored.length+value.established.length>20)
    throw Error('20 physical worker/DB ceiling exceeded');
  if((lane!=='protected'&&!value.entry.length)||
     (lane==='protected'&&!value.sponsored.length&&!value.established.length))
    throw Error('Required ingress lane worker is missing');
  return value;
}
function coarse(ip){
  const remote=typeof ip==='string'?ip:'';
  if(isIP(remote)===4){
    const parts=remote.split('.');
    return parts.slice(0,3).join('.')+'.0/24';
  }
  // IPv6 is intentionally NOT converted from an arbitrary textual address
  // into an unsafe prefix. The operator can provide normalized /48 data
  // via a trusted sourceClassifier or proxy-side lookup.
  return '';
}
function boundedValue(x,fallback,max,label){
  const v=x??fallback;
  if(!Number.isSafeInteger(v)||v<1||v>max)throw Error('Invalid '+label);
  return v;
}
async function readSmall(req){
  const n=req.headers['content-length'];
  if(req.headers['transfer-encoding']||
    typeof n!=='string'||!/^[0-9]{1,5}$/.test(n)||
    Number(n)<1||Number(n)>MAX_BODY)
    throw Error('bad-content-length-or-transfer-encoding');
  let total=0;
  const chunks=[];
  for await(const buf of req){
    total+=buf.length;
    if(total>MAX_BODY)throw Error('excess-body-bytes');
    chunks.push(buf);
  }
  if(total!==Number(n))throw Error('body-length-mismatch');
  return Buffer.concat(chunks,total);
}
function reply(res,status,body){
  if(res.writableEnded||res.destroyed)return;
  res.writeHead(status,{'content-type':'application/json',
    'cache-control':'no-store','connection':'close'});
  res.end(JSON.stringify(body));
}
export async function createBoundedIngress({
  workers,expectedIssuer,sourceClassifier=null,host='127.0.0.1',port=0,
  lane='both',
  secret=randomBytes(32),now=()=>Date.now(),
  entryPerMinute=12,protectedPerMinute=30,
  proofAttemptsPerMinute=16,proofGlobalPerMinute=64,
  maxEntryInFlight=4,maxProtectedInFlight=4,maxProofInFlight=2
}={}){
  if(!['entry','protected','both'].includes(lane))
    throw Error('Invalid gateway lane');
  const routes=upstreams(workers,lane);
  if(!AUTHOR.test(expectedIssuer||'')||
    !Buffer.isBuffer(secret)||secret.length<16||
    typeof now!=='function'||
    (sourceClassifier!==null&&typeof sourceClassifier!=='function')||
    !['127.0.0.1','::1'].includes(host)||
    !Number.isSafeInteger(port)||port<0||port>65535)
    throw Error('Invalid operator-pinned gateway configuration');
  for(const [x,max,label] of [
    [entryPerMinute,100000,'entry budget'],
    [protectedPerMinute,100000,'protected budget'],
    [proofAttemptsPerMinute,10000,'source proof budget'],
    [proofGlobalPerMinute,100000,'global proof budget'],
    [maxEntryInFlight,128,'entry concurrency'],
    [maxProtectedInFlight,128,'protected concurrency'],
    [maxProofInFlight,32,'proof verification concurrency']])
    boundedValue(x,null,max,label);
  const budgets=new Map();
  const results={entry:0,sponsored:0,established:0,
    badProof:0,limited:0,proxyErrors:0};
  let epoch=-1,entryPending=0,protectedPending=0,proofPending=0,closed=false;
  function sourceOf(req){
    const remote=req.socket.remoteAddress||'unknown';
    const prefix=coarse(remote);
    let input={provenance:'operator-observed',networkKind:'unknown',
      networkPrefix:prefix};
    if(sourceClassifier){
      // Callback gets only the operator-observed socket endpoint; NEVER
      // the request, its attacker-set headers or its JSON body.
      const observed=sourceClassifier(remote);
      if(observed?.provenance==='operator-observed')
        input={...observed,provenance:'operator-observed'};
    }
    const result=classifyNetworkObservation(input,{secret});
    const stable=createHash('sha256').update(secret).update(remote)
      .digest('hex').slice(0,16);
    return {compartment:result.bucket,source:stable};
  }
  function charge(key,cap,time){
    const next=Math.floor(time/60000);
    if(epoch!==next){epoch=next;budgets.clear();}
    if(!budgets.has(key)&&budgets.size>=MAX_GROUPS)key='overflow:'+key.split(':')[0];
    const value=budgets.get(key)||0;
    if(value>=cap)return false;
    budgets.set(key,value+1);
    return true;
  }
  const server=http.createServer({maxHeaderSize:4096},async(req,res)=>{
    if(req.url==='/health'&&req.method==='GET'){
      reply(res,200,{ok:!closed,workers:Object.fromEntries(
        Object.entries(routes).map(([k,v])=>[k,v.length])),
        counters:{...results}});
      return;
    }
    if(req.url!=='/publish'||req.method!=='POST'){
      reply(res,404,{ok:false,error:'unknown-route'});return;
    }
    if(closed){reply(res,503,{ok:false,error:'gateway-shutdown'});return;}
    let origin;
    try{origin=sourceOf(req);}catch{
      reply(res,503,{ok:false,error:'operator-source-classifier-unavailable'});
      return;
    }
    const t=now();
    if(!Number.isSafeInteger(t)||t<0){
      reply(res,503,{ok:false,error:'operator-clock-unavailable'});return;
    }
    const rawProof=req.headers['x-w9-operator-capability'];
    const candidate=rawProof!==undefined;
    if((lane==='entry'&&candidate)||(lane==='protected'&&!candidate)){
      reply(res,403,{ok:false,error:'wrong-gateway-lane'});return;
    }
    let className='entry',proof=null;
    if(candidate){
      // Do not parse/signature-check a client body until the bounded proof
      // control plane has established an independently signed capability.
      if(proofPending>=maxProofInFlight||
        !charge('proof-source:'+origin.source,proofAttemptsPerMinute,t)||
        !charge('proof-global',proofGlobalPerMinute,t)){
        results.limited++;
        reply(res,429,{ok:false,error:'bounded-proof-verification'});return;
      }
      proofPending++;
      try{
        const verified=await verifyIngressCapability(rawProof,{
          expectedIssuer,now:t
        });
        if(!verified.valid){
          results.badProof++;
          reply(res,403,{ok:false,error:'invalid-operator-proof'});return;
        }
        className=verified.className;proof=verified;
      }finally{proofPending--;}
    }
    const protectedMode=className!=='entry';
    if((protectedMode?protectedPending>=maxProtectedInFlight:
        entryPending>=maxEntryInFlight)||
      !charge('tier:'+className,protectedMode?protectedPerMinute:entryPerMinute,t)||
      !charge('compartment:'+className+':'+origin.compartment,
        protectedMode?protectedPerMinute:entryPerMinute,t)||
      !charge('source:'+className+':'+origin.source,
        protectedMode?protectedPerMinute:entryPerMinute,t)){
      results.limited++;
      reply(res,429,{ok:false,error:'bounded-ingress-capacity'});return;
    }
    if(protectedMode)protectedPending++;else entryPending++;
    try{
      const payload=await readSmall(req);
      if(protectedMode){
        let event;
        try{event=JSON.parse(payload.toString('utf8'));}catch{
          reply(res,422,{ok:false,error:'malformed-signed-envelope'});return;
        }
        if(event?.payload?.author!==proof.subject){
          reply(res,403,{ok:false,error:'capability-subject-mismatch'});return;
        }
      }
      const workerList=routes[className];
      if(!workerList.length){
        reply(res,503,{ok:false,error:'this-operator-does-not-serve-class'});return;
      }
      const number=Number.parseInt(origin.compartment.slice(-8),16)||0;
      const endpoint=workerList[number%workerList.length];
      let downstream;
      try{
        downstream=await fetch(endpoint+'/publish',{
          method:'POST',body:payload,headers:{
            'content-type':'application/json',
            ...(proof?{'x-w9-operator-capability':rawProof}:{})
          },
          redirect:'error',signal:AbortSignal.timeout(3000)
        });
      }catch{
        results.proxyErrors++;
        reply(res,503,{ok:false,error:'isolated-worker-unavailable'});return;
      }
      // Worker outputs are local and already bounded by this lab worker.
      let result;
      try{result=await downstream.json();}
      catch{result={ok:false,error:'invalid-worker-response'};}
      if(downstream.status===200)results[className]++;
      reply(res,downstream.status,result);
    }catch{
      reply(res,422,{ok:false,error:'invalid-bounded-envelope'});
    }finally{
      if(protectedMode)protectedPending--;else entryPending--;
    }
  });
  server.maxConnections=32;
  server.headersTimeout=3000;server.requestTimeout=5000;
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=15;
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,host,resolve);
  });
  return {host,port:server.address().port,url:
    'http://'+(host==='::1'?'[::1]':host)+':'+server.address().port,
    get counters(){return {...results};},
    async close(){
      closed=true;
      server.closeAllConnections();
      await new Promise(resolve=>server.close(()=>resolve()));
    }
  };
}
