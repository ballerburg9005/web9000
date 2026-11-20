import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateIdentity,signEvent} from '../core/events.js';
import {issueIngressCapability,verifyIngressCapability} from './ingress-capability.mjs';
import {createBoundedIngress} from './bounded-ingress.mjs';

const workerScript=new URL('./isolated-tier-worker.mjs',import.meta.url).pathname;
async function launch(cls,root,configFile){
 const child=spawn(process.execPath,[workerScript,cls,root,'0',
   ...(configFile?[configFile]:[])],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stderr.on('data',b=>stderr+=b.toString());
 try{
  const data=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker startup timeout: '+stderr)),20000);
   const read=d=>{
    stdout+=d.toString();
    const m=stdout.match(/ISOLATED_TIER_READY ([^\n]+)\n/);
    if(m){clearTimeout(timer);child.stdout.off('data',read);
      resolve(JSON.parse(m[1]));}
   };
   child.stdout.on('data',read);
   child.once('exit',code=>{clearTimeout(timer);reject(Error('Worker exited '+code+': '+stderr));});
  });
  return {...data,child};
 }catch(error){child.kill('SIGKILL');throw error;}
}
async function kill(worker){
 if(!worker||worker.child.exitCode!==null||worker.child.signalCode!==null)return;
 const exit=once(worker.child,'exit').catch(()=>{});
 worker.child.kill('SIGTERM');
 await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,3500))]);
 if(worker.child.exitCode===null&&worker.child.signalCode===null)
   worker.child.kill('SIGKILL');
}
async function send(url,event,{token=null,headers={}}={}){
 const response=await fetch(url+'/publish',{
   method:'POST',body:JSON.stringify(event),headers:{
     'content-type':'application/json',
     ...headers,...(token?{'x-w9-operator-capability':token}:{})
   },signal:AbortSignal.timeout(7000)
 });
 return {status:response.status,body:await response.json()};
}
const signed=async(owner,title,extra={})=>signEvent(owner,{
 body:{title,text:'Original independently signed material',...extra}
});
test('operator-issued metadata capability rejects forged issuer, scope, mismatched author, expiry and edited signatures',async()=>{
 const issuer=await generateIdentity(),attacker=await generateIdentity(),
  author=await generateIdentity();
 const token=await issueIngressCapability({
   signer:issuer,subject:author.author,className:'established',
   now:1000000,ttlMs:40000
 });
 assert.equal((await verifyIngressCapability(token,{
   expectedIssuer:issuer.author,now:1000200,subject:author.author,
   className:'established'
 })).valid,true);
 for(const [reason,request] of [
   ['wrong-operator',{expectedIssuer:attacker.author,now:1000200}],
   ['subject-mismatch',{expectedIssuer:issuer.author,subject:attacker.author,now:1000200}],
   ['expired',{expectedIssuer:issuer.author,now:1040001}],
   ['different-class',{expectedIssuer:issuer.author,now:1000200,className:'sponsored'}]
 ]){
   const result=await verifyIngressCapability(token,request);
   assert.equal(result.valid,false,reason);
 }
 const obj=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));
 obj.body.className='sponsored';
 const altered=Buffer.from(JSON.stringify(obj)).toString('base64url');
 assert.equal((await verifyIngressCapability(altered,{
   expectedIssuer:issuer.author,now:1000200
 })).valid,false,'modifying tier invalidates signature');
 const spoof=await issueIngressCapability({
   signer:attacker,subject:author.author,className:'established',now:1000000
 });
 assert.equal((await verifyIngressCapability(spoof,{
   expectedIssuer:issuer.author,now:1000200
 })).valid,false,'attacker signed token is not trusted');
 await assert.rejects(issueIngressCapability({
   signer:issuer,subject:author.author,className:'entry',now:1000000
 }),/capability requires/);
});

test('bounded gateway protects real separate Helia/OrbitDB established worker through entry flood, forged headers and entry crash',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'w9-ingress-lab-'));
 const issuer=await generateIdentity(),owner=await generateIdentity(),
   outsider=await generateIdentity();
 let entry,established,gateway;
 try{
   const config=path.join(root,'protected-operator.json');
   await writeFile(config,JSON.stringify({
     mode:'pinned-ingress-capability',issuer:issuer.author
   }),{mode:0o600});
   entry=await launch('entry',path.join(root,'entry'),null);
   established=await launch('established',path.join(root,'established'),config);
   const protectedUrl='http://127.0.0.1:'+established.port;
   const entryUrl='http://127.0.0.1:'+entry.port;
   // This lab has TWO independent real Helia/OrbitDB workers, not one
   // shared unrestricted DB or an operator-assigned global user role.
   gateway=await createBoundedIngress({
     workers:{entry:[entryUrl],established:[protectedUrl]},
     expectedIssuer:issuer.author,entryPerMinute:5,
     protectedPerMinute:12,proofAttemptsPerMinute:12,
     proofGlobalPerMinute:16,maxEntryInFlight:3,
     secret:Buffer.alloc(32,0x77)
   });
   const token=await issueIngressCapability({
     signer:issuer,subject:owner.author,className:'established'
   });
   const strangerEvent=await signed(outsider,'A new free entry post',
     {tier:'established',claimedKarma:999999,country:'US'});
   const unverified=await send(gateway.url,strangerEvent,{
     headers:{'x-forwarded-for':'11.22.33.44',
       'x-real-ip':'99.88.77.66','x-w9-class-name':'established'}
   });
   assert.equal(unverified.status,200,JSON.stringify(unverified));
   assert.equal(unverified.body.id,strangerEvent.id);
   const priv=await signed(owner,'A protected signed message');
   const accepted=await send(gateway.url,priv,{token});
   assert.equal(accepted.status,200,JSON.stringify(accepted));
   assert.equal(accepted.body.id,priv.id);
   assert.equal((await send(gateway.url,await signed(outsider,'Bogus other user'),{
     token
   })).status,403,'capability subject must match signed event author');
   const forged=await issueIngressCapability({
     signer:outsider,subject:outsider.author,className:'established'
   });
   assert.equal((await send(gateway.url,await signed(outsider,'Bogus issuer'),{
     token:forged
   })).status,403,'unapproved operator cannot grant tier status');
   // Worker independently checks operator token, not just gateway's claim.
   const directly=await fetch(protectedUrl+'/publish',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify(await signed(owner,'Direct bypass without proof'))
   });
   assert.equal(directly.status,403);
   const flood=await Promise.all(Array.from({length:80},(_,i)=>
     send(gateway.url,{
       id:'sha256:'+i.toString(16).padStart(64,'0'),
       payload:{author:outsider.author,kind:'post',
         title:'fake-'+i},signature:'fabricated'
     },{
       headers:{'x-forwarded-for':'203.0.'+i+'.1',
         'x-real-ip':'198.51.100.'+i}
     }).then(r=>r.status).catch(()=>0)));
   assert.ok(flood.filter(status=>status===429).length>=60,
     'preparse budget denies heavy untrusted burst before OrbitDB');
   const afterFlood=await send(gateway.url,
     await signed(owner,'Qualified posting still available'),{token});
   assert.equal(afterFlood.status,200,JSON.stringify(afterFlood));
   assert.equal((await (await fetch(protectedUrl+'/health')).json()).stored,2);
   const exit=once(entry.child,'exit').catch(()=>{});
   entry.child.kill('SIGKILL');await exit;
   const afterDeath=await send(gateway.url,
     await signed(owner,'Qualified publishing survives dead entry process'),
     {token});
   assert.equal(afterDeath.status,200,JSON.stringify(afterDeath));
   const healthy=await (await fetch(protectedUrl+'/health')).json();
   assert.equal(healthy.stored,3);
   assert.equal(gateway.counters.established,3);
   assert.ok(gateway.counters.limited>=60);
   assert.equal(gateway.counters.entry,1);
 }finally{
   await gateway?.close();
   await Promise.all([kill(entry),kill(established)]);
   await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
});

test('bounded gateway rejects more than 20 configured physical worker endpoints and remote untrusted URLs',async()=>{
 const issuer=await generateIdentity();
 await assert.rejects(createBoundedIngress({
   expectedIssuer:issuer.author,
   workers:{entry:Array.from({length:20},(_,i)=>
     'http://127.0.0.1:'+(10000+i)),
   established:['http://127.0.0.1:30000']}
 }),/20 physical/);
 await assert.rejects(createBoundedIngress({
   expectedIssuer:issuer.author,
   workers:{entry:['http://evil.example:9230']}
 }),/Only explicitly configured loopback/);
});

const ingressScript=new URL('./isolated-ingress-process.mjs',import.meta.url).pathname;
async function launchIngress(lane,file){
 const child=spawn(process.execPath,[ingressScript,lane,file,'0'],{
   stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stderr.on('data',b=>stderr+=b.toString());
 try{
  const ready=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Ingress startup timed out: '+stderr)),15000);
   const ondata=data=>{
    stdout+=data.toString();
    const m=stdout.match(/ISOLATED_INGRESS_READY ([^\n]+)\n/);
    if(m){
      clearTimeout(timer);child.stdout.off('data',ondata);
      resolve(JSON.parse(m[1]));
    }
   };
   child.stdout.on('data',ondata);
   child.once('exit',code=>{
     clearTimeout(timer);
     reject(Error('Ingress exited '+code+': '+stderr));
   });
  });
  return {...ready,child};
 }catch(error){child.kill('SIGKILL');throw error;}
}
test('distinct entry/protected ingress processes retain protected publication after entry gateway itself dies',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'w9-gateway-process-'));
 const issuer=await generateIdentity(),author=await generateIdentity(),
   outsider=await generateIdentity();
 let entryWorker,protectedWorker,entryGateway,protectedGateway;
 try{
  const trusted=path.join(tmp,'trusted.json');
  await writeFile(trusted,JSON.stringify({
    mode:'pinned-ingress-capability',issuer:issuer.author
  }),{mode:0o600});
  entryWorker=await launch('entry',path.join(tmp,'entry'),null);
  protectedWorker=await launch('established',path.join(tmp,'established'),trusted);
  const eFile=path.join(tmp,'entry-gateway.json'),
    pFile=path.join(tmp,'protected-gateway.json');
  await writeFile(eFile,JSON.stringify({
    issuer:issuer.author,
    workers:{entry:['http://127.0.0.1:'+entryWorker.port]}
  }),{mode:0o600});
  await writeFile(pFile,JSON.stringify({
    issuer:issuer.author,
    workers:{established:['http://127.0.0.1:'+protectedWorker.port]}
  }),{mode:0o600});
  entryGateway=await launchIngress('entry',eFile);
  protectedGateway=await launchIngress('protected',pFile);
  assert.notEqual(entryGateway.pid,protectedGateway.pid);
  const eUrl='http://127.0.0.1:'+entryGateway.port;
  const pUrl='http://127.0.0.1:'+protectedGateway.port;
  const proof=await issueIngressCapability({
    signer:issuer,subject:author.author,className:'established'
  });
  assert.equal((await send(eUrl,await signed(outsider,'Free entry'))).status,200);
  assert.equal((await send(pUrl,await signed(author,'Protected writer'),{
    token:proof})).status,200);
  assert.equal((await send(pUrl,await signed(outsider,'Bad entry in protected lane'))).status,403);
  assert.equal((await send(eUrl,await signed(author,'No privilege crossing'),{
    token:proof})).status,403);
  const invalid=await Promise.all(Array.from({length:100},(_,i)=>
    send(eUrl,{id:'sha256:'+i.toString(16).padStart(64,'0'),
      payload:{author:outsider.author},signature:'invalid'}
    ).then(r=>r.status).catch(()=>0)));
  const refused=invalid.filter(code=>code===429||code===0).length;
  assert.ok(refused>70,
    'excess connections may be rejected as TCP refusal or explicit HTTP 429');
  const entryStatus=await (await fetch(
    'http://127.0.0.1:'+entryWorker.port+'/health')).json();
  assert.equal(entryStatus.stored,1,
    'entry flood must never allocate durable records for invalid signatures');
  const exit=once(entryGateway.child,'exit').catch(()=>{});
  entryGateway.child.kill('SIGKILL');await exit;
  // Protected endpoint is a distinct executable with its own request
  // loop, quota counters and no shared gateway state.
  assert.equal((await send(pUrl,await signed(author,
    'Protected independent gateway after entry gateway failure'),{
      token:proof
    })).status,200);
  const status=await (await fetch(
    'http://127.0.0.1:'+protectedWorker.port+'/health')).json();
  assert.equal(status.stored,2);
 }finally{
  await Promise.all([kill(entryGateway),kill(protectedGateway)]);
  await Promise.all([kill(entryWorker),kill(protectedWorker)]);
  await rm(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
});
