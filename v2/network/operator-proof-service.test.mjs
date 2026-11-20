import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {generateIdentity,signEvent} from '../core/events.js';
import {verifyIngressCapability} from './ingress-capability.mjs';
import {createBoundedIngress} from './bounded-ingress.mjs';
import {
 importOperatorSigningKey,loadOperatorProofConfig,createOperatorProofService
} from './operator-proof-service.mjs';

const script=new URL('./isolated-tier-worker.mjs',import.meta.url).pathname;
const post=async(url,body,token=null)=>{
 const res=await fetch(url,{method:'POST',
   headers:{'content-type':'application/json',
     ...(token?{'x-w9-operator-capability':token}:{})},
   body:JSON.stringify(body),signal:AbortSignal.timeout(7000)});
 return {status:res.status,data:await res.json()};
};
async function runWorker(cls,dir,conf=null){
 const child=spawn(process.execPath,[script,cls,dir,'0',...(conf?[conf]:[])],
   {stdio:['ignore','pipe','pipe']});
 let output='',errors='';
 child.stderr.on('data',b=>errors+=b);
 try{
  const report=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Worker timeout: '+errors)),20000);
   child.stdout.on('data',b=>{
    output+=b;
    const match=output.match(/ISOLATED_TIER_READY ([^\n]+)\n/);
    if(match){clearTimeout(timeout);resolve(JSON.parse(match[1]));}
   });
   child.once('exit',code=>{
    clearTimeout(timeout);reject(Error('Worker exited '+code+': '+errors));});
  });
  return {child,...report};
 }catch(e){child.kill('SIGKILL');throw e;}
}
async function stop(proc){
 if(!proc||proc.child.exitCode!==null||proc.child.signalCode!==null)return;
 const done=once(proc.child,'exit').catch(()=>{});
 proc.child.kill('SIGTERM');
 await Promise.race([done,new Promise(r=>setTimeout(r,3000))]);
 if(proc.child.exitCode===null&&proc.child.signalCode===null)
  proc.child.kill('SIGKILL');
}
test('private persistent issuer key is explicitly loaded and bound to a PINNED operator identity',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-issuer-config-'));
 try{
  const who=await generateIdentity({extractable:true}),other=await generateIdentity();
  const pem=Buffer.from(await crypto.subtle.exportKey('pkcs8',who.privateKey)).toString('base64');
  const policy={roots:[other.author],scope:'commons',groupPins:[]};
  const file=path.join(dir,'config.json');
  await writeFile(file,JSON.stringify({issuer:who.author,pkcs8:pem,policy}),{mode:0o600});
  const loaded=await loadOperatorProofConfig(file);
  assert.equal(loaded.signer.author,who.author);
  assert.equal(loaded.policy.roots[0],other.author);
  await assert.rejects(importOperatorSigningKey({issuer:other.author,pkcs8:pem}),
    /does not match/);
  await chmod(file,0o644);
  await assert.rejects(loadOperatorProofConfig(file),/private/);
  await chmod(file,0o600);
  await writeFile(file,JSON.stringify({issuer:who.author,pkcs8:pem,
    policy:{...policy,roots:[]}}),{mode:0o600});
  await assert.rejects(loadOperatorProofConfig(file),/No operator-pinned/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('real signed invite and acceptance earn a protected *local* ingress credential, self-claims and invalid evidence do not',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'w9-proof-gateway-'));
 let entry,protectedWorker,gateway,issuer;
 try{
  const issuerKey=await generateIdentity(),trusted=await generateIdentity(),
    invited=await generateIdentity(),attacker=await generateIdentity();
  const policy={roots:[trusted.author],scope:'commons',
    minInviteScore:30,groupPins:[],ttlMs:60000};
  const protectedFile=path.join(root,'protected.json');
  await writeFile(protectedFile,JSON.stringify({
    mode:'pinned-ingress-capability',issuer:issuerKey.author
  }),{mode:0o600});
  entry=await runWorker('entry',path.join(root,'entry'));
  protectedWorker=await runWorker('sponsored',path.join(root,'protected'),protectedFile);
  issuer=await createOperatorProofService({
    signer:issuerKey,policy,attemptsPerMinute:10
  });
  gateway=await createBoundedIngress({
    workers:{entry:['http://127.0.0.1:'+entry.port],
      sponsored:['http://127.0.0.1:'+protectedWorker.port]},
    expectedIssuer:issuerKey.author,entryPerMinute:6,
    protectedPerMinute:12
  });
  const now=Date.now();
  const inv=await signEvent(trusted,{kind:'invitation',
    body:{invitee:invited.author,scope:'commons',expiresAt:now+30000},
    time:now-2000});
  const accept=await signEvent(invited,{kind:'accept',
    body:{invitation:inv.id},time:now-1000});
  const request={subject:invited.author,
    evidence:{kind:'bilateral-invitation',events:[inv,accept]}};
  const proof=await post(issuer.url+'/qualify',request);
  assert.equal(proof.status,200,JSON.stringify(proof));
  assert.equal(proof.data.className,'sponsored');
  assert.equal(proof.data.method,'accepted-invitation');
  assert.equal((await verifyIngressCapability(proof.data.credential,{
    expectedIssuer:issuerKey.author,subject:invited.author,
    className:'sponsored'
  })).valid,true);
  const record=await signEvent(invited,{body:{title:'Invited signed publication',
    text:'Independent issuer verifies sponsor and acceptance before routing'}});
  const delivered=await post(gateway.url+'/publish',record,proof.data.credential);
  assert.equal(delivered.status,200,JSON.stringify(delivered));
  const hacked=await signEvent(attacker,{body:{title:'Untrusted entry',
    text:'Cannot use another author receipt',tier:'sponsored',claimedKarma:5000}});
  assert.equal((await post(gateway.url+'/publish',hacked,proof.data.credential)).status,
    403);
  assert.equal((await post(issuer.url+'/qualify',{
    subject:attacker.author,
    evidence:{kind:'stake4karma',wallet:'0xFake',reportedBalance:1000000}
  })).status,403,'unverified self-described stake never grants protected lane');
  assert.equal((await post(issuer.url+'/qualify',{
    subject:invited.author,
    evidence:{kind:'bilateral-invitation',events:[inv]}
  })).status,403);
  const protectedHealth=await (await fetch(
    'http://127.0.0.1:'+protectedWorker.port+'/health')).json();
  assert.equal(protectedHealth.stored,1);
  assert.equal(issuer.counters.accepted,1);
  assert.equal(issuer.counters.unqualified,2);
  // Invalidate issuer itself, leave separately running existing credential.
  await issuer.close();issuer=null;
  const next=await signEvent(invited,{body:{title:'Protected worker continues',
    text:'Issuer failure cannot delete or revoke existing original signature'}});
  assert.equal((await post(gateway.url+'/publish',next,proof.data.credential)).status,
    200);
 }finally{
  await gateway?.close();await issuer?.close();
  await Promise.all([stop(entry),stop(protectedWorker)]);
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
});

test('optional testnet contract pin issues sponsored capability over bounded challenge/qualify HTTP, rejects nonce replay',async()=>{
 const {createHash}=await import('node:crypto');
 const {Stake4KarmaTestnetVerifier}=await import('./stake4karma-testnet-verifier.mjs');
 const {signCredential}=await import('./vendor/stake4karma-sdk-v0.5.0.mjs');
 const operator=await generateIdentity(),author=await generateIdentity();
 const contract='0x'+'2'.repeat(40),wallet='0x'+'1'.repeat(40);
 const bytecode='0x6001600055';
 const pub=Buffer.from(author.author.slice(8),'base64url').toString('hex');
 const codeHashSha256=createHash('sha256').update(Buffer.from(bytecode.slice(2),'hex')).digest('hex');
 const word=x=>BigInt(x).toString(16).padStart(64,'0');
 const provider={
  async request({method}){
   if(method==='eth_getCode')return bytecode;
   if(method==='eth_chainId')return '0x14a34';
   if(method==='eth_call')return '0x'+pub+word(20000)+word(1)+word(0)+word(0);
   throw Error('Disallowed RPC method');
  }
 };
 const stakeVerifier=new Stake4KarmaTestnetVerifier({
  config:{chainId:84532,contract,codeHashSha256,
   minimumAmountWei:'10000',rpcUrl:'https://example.test/'},
  operator:operator.author,provider
 });
 const service=await createOperatorProofService({
  signer:operator,policy:{roots:[],scope:'commons',groupPins:[]},
  stakeVerifier
 });
 try{
  const challengeReply=await post(service.url+'/challenge',{subject:author.author});
  assert.equal(challengeReply.status,200,JSON.stringify(challengeReply));
  assert.equal(challengeReply.data.chainId,84532);
  assert.equal(challengeReply.data.contract,contract);
  const challenge=challengeReply.data.challenge;
  const signature=await signCredential({
   chainId:84532,contract,wallet,publicKey:'0x'+pub,
   privateKey:author.privateKey,challenge
  });
  const request={subject:author.author,evidence:{
   kind:'stake4karma-testnet',challenge,proof:signature
  }};
  const accepted=await post(service.url+'/qualify',request);
  assert.equal(accepted.status,200,JSON.stringify(accepted));
  assert.equal(accepted.data.className,'sponsored');
  assert.equal(accepted.data.method,'pinned-base-sepolia-stake');
  assert.equal((await verifyIngressCapability(accepted.data.credential,{
   expectedIssuer:operator.author,subject:author.author,className:'sponsored'
  })).valid,true);
  assert.equal((await post(service.url+'/qualify',request)).status,403);
  assert.equal((await post(service.url+'/qualify',{
   subject:author.author,evidence:{kind:'stake4karma-testnet',
    challenge,proof:{...signature,signature:'0x'+'0'.repeat(128)}}
  })).status,403);
 }finally{await service.close();}
});
