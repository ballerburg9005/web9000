import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateIdentity,signEvent} from '../core/events.js';

const workerPath=new URL('./isolated-tier-worker.mjs',import.meta.url).pathname;
async function startWorker(cls,store,allowlist){
  const args=[workerPath,cls,store,'0',...(allowlist?[allowlist]:[])];
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='',settled=false;
  child.stderr.on('data',b=>{stderr+=b.toString();});
  const ready=new Promise((resolve,reject)=>{
    const watchdog=setTimeout(()=>reject(Error('Worker startup timed out: '+stderr)),15000);
    child.stdout.on('data',data=>{
      stdout+=data.toString();
      const match=stdout.match(/ISOLATED_TIER_READY ([^\n]+)\n/);
      if(match&&!settled){
        settled=true;clearTimeout(watchdog);
        resolve({child,...JSON.parse(match[1]),get stderr(){return stderr;}});
      }
    });
    child.once('exit',code=>{
      if(!settled){clearTimeout(watchdog);reject(Error('Worker exited '+code+': '+stderr));}
    });
  });
  try{return await ready;}catch(error){child.kill('SIGKILL');throw error;}
}
async function probe(worker,path,body){
  const url='http://127.0.0.1:'+worker.port+path;
  const response=await fetch(url,{method:body?'POST':'GET',
    ...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{}),
    signal:AbortSignal.timeout(3000)});
  return {status:response.status,data:await response.json()};
}
async function stop(worker){
  if(!worker||worker.child.exitCode!==null||worker.child.signalCode!==null)return;
  worker.child.kill('SIGTERM');
  await Promise.race([
    once(worker.child,'exit').catch(()=>{}),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
  if(worker.child.exitCode===null)worker.child.kill('SIGKILL');
}
test('separate real Helia/OrbitDB processes protect a curated tier after entry is flooded and force-killed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'w9-isolated-workers-'));
  let entry,protectedWorker;
  try{
    const trusted=await generateIdentity(),unknown=await generateIdentity();
    const allowedFile=path.join(root,'curator.json');
    await writeFile(allowedFile,JSON.stringify([trusted.author]),{mode:0o600});
    entry=await startWorker('entry',path.join(root,'entry'),null);
    protectedWorker=await startWorker('established',path.join(root,'established'),allowedFile);
    assert.notEqual(entry.pid,protectedWorker.pid);
    assert.notEqual(entry.address,protectedWorker.address,
      'distinct physical OrbitDB logs and stores');
    const legitimate=await signEvent(trusted,{body:{
      title:'An independently authorized publication',
      text:'This must not be erased by entry traffic.'
    }});
    const unapproved=await signEvent(unknown,{body:{
      title:'Cannot gain protected publication through user-controlled request body',
      text:'No operator-issued proof.'
    }});
    const established=await probe(protectedWorker,'/publish',legitimate);
    assert.equal(established.status,200,JSON.stringify(established));
    assert.equal((await probe(protectedWorker,'/publish',unapproved)).status,403,
      'forged privilege declaration cannot enter established worker');
    const accepted=await probe(entry,'/publish',unapproved);
    assert.equal(accepted.status,200);
    const abuse=Array.from({length:100},(_,i)=>probe(entry,'/publish',{
      id:'sha256:'+i.toString(16).padStart(64,'0'),
      payload:{author:unknown.author,kind:'post',title:'invalid'},
      signature:'invalid'
    }).then(x=>x.status).catch(()=>0));
    await Promise.all(abuse);
    const beforeKill=await probe(protectedWorker,'/health');
    assert.equal(beforeKill.status,200);
    assert.equal(beforeKill.data.stored,1);
    assert.equal(beforeKill.data.className,'established');
    entry.child.kill('SIGKILL'); // simulate a permanently failed entry worker
    await once(entry.child,'exit').catch(()=>{});
    const afterKill=await probe(protectedWorker,'/health');
    assert.equal(afterKill.status,200,
      'protected process remains responsive after entry worker crashes');
    assert.equal(afterKill.data.stored,1);
    const another=await signEvent(trusted,{body:{
      title:'Protected publishing continues after entry failure',
      text:'Independent executable, store and libp2p identity.'
    }});
    assert.equal((await probe(protectedWorker,'/publish',another)).status,200);
    const final=await probe(protectedWorker,'/health');
    assert.equal(final.data.stored,2);
    assert.ok(final.data.counters.accepted>=2);
  }finally{
    await Promise.all([stop(entry),stop(protectedWorker)]);
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});
