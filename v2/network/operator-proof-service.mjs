// Isolated, operator-local, independently verified credential issuer.
// This process is a separate resource plane from entry and protected
// publication workers. An overrun/failed issuer never makes ordinary posts
// invalid and does not revoke already minted short-lived credentials.
//
// Optional unaudited Base Sepolia Stake4Karma v0.5 verification is
// separately configured with an exact contract/code-hash/chain pin.
 // No mainnet staking, user-supplied RPC, or global karma authority.
import http from 'node:http';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {issueVerifiedTrustCapability,validateOperatorTrustPolicy} from './operator-trust-proof.mjs';
import {issueIngressCapability} from './ingress-capability.mjs';
import {Stake4KarmaTestnetVerifier,validateStake4KarmaConfig} from './stake4karma-testnet-verifier.mjs';

const MAX_BODY=48*1024;
const MAX_CONFIG=16*1024;
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const fail=(res,status,reason)=>{
 if(res.writableEnded||res.destroyed)return;
 res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',
  connection:'close'});
 res.end(JSON.stringify({ok:false,error:reason}));
};
async function loadRestricted(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute operator-owned secret file required');
 const stat=await lstat(file);
 if(!stat.isFile()||(stat.mode&0o077)!==0)
   throw Error('Operator secret file must be regular and private (0600)');
 if(stat.size<1||stat.size>MAX_CONFIG)throw Error('Operator configuration file size exceeds budget');
 return JSON.parse((await readFile(file)).toString('utf8'));
}
export async function importOperatorSigningKey({issuer,pkcs8}={}){
 if(!AUTHOR.test(issuer||'')||typeof pkcs8!=='string'||
    pkcs8.length>512||!/^[A-Za-z0-9+/=]+$/.test(pkcs8))
   throw Error('Invalid persisted operator signing key');
 const signer=await crypto.subtle.importKey('pkcs8',Buffer.from(pkcs8,'base64'),
   'Ed25519',false,['sign']);
 // Prove the private key actually matches the PINNED public issuer.
 const pub=await crypto.subtle.importKey('raw',Buffer.from(issuer.slice(8),'base64url'),
   'Ed25519',false,['verify']);
 const msg=new TextEncoder().encode('WEB9000/operator-issuer-configuration/v1');
 const signature=await crypto.subtle.sign('Ed25519',signer,msg);
 if(!await crypto.subtle.verify('Ed25519',pub,signature,msg))
   throw Error('Operator private key does not match pinned public identity');
 return {author:issuer,privateKey:signer};
}
export async function loadOperatorProofConfig(file){
 const config=await loadRestricted(file);
 if(!config||typeof config!=='object'||Array.isArray(config)||
    !['issuer,pkcs8,policy','issuer,pkcs8,policy,stake4karma'].includes(
      Object.keys(config).sort().join(',')))
   throw Error('Invalid operator issuer configuration');
 const signer=await importOperatorSigningKey(config);
 const policy=validateOperatorTrustPolicy(config.policy);
 const stakeConfig=config.stake4karma?
   validateStake4KarmaConfig(config.stake4karma):null;
 if(!policy.roots.length&&!policy.groupPins.length&&!stakeConfig)
   throw Error('No operator-pinned invitation, group trust or testnet contract');
 return {signer,policy,stakeConfig};
}
async function boundedBody(req){
 const len=req.headers['content-length'];
 if(req.headers['transfer-encoding']||typeof len!=='string'||
    !/^[0-9]{1,5}$/.test(len)||Number(len)<1||Number(len)>MAX_BODY)
   throw Error('invalid-content-length');
 let size=0;const parts=[];
 for await(const part of req){
   size+=part.length;if(size>MAX_BODY)throw Error('oversized');
   parts.push(part);
 }
 if(size!==Number(len))throw Error('invalid-content-length');
 return Buffer.concat(parts,size);
}
export async function createOperatorProofService({
 signer,policy,stakeVerifier=null,port=0,host='127.0.0.1',now=()=>Date.now(),
 attemptsPerMinute=24,maxInFlight=2
}={}){
 if(!signer?.privateKey||!AUTHOR.test(signer.author||'')||
    !['127.0.0.1','::1'].includes(host)||
    !Number.isSafeInteger(port)||port<0||port>65535||
    !Number.isSafeInteger(attemptsPerMinute)||attemptsPerMinute<1||
    attemptsPerMinute>1000||!Number.isSafeInteger(maxInFlight)||
    maxInFlight<1||maxInFlight>16)
   throw Error('Invalid operator proof service configuration');
 const p=validateOperatorTrustPolicy(policy);
 let pending=0,epoch=-1,attempts=0,stopping=false;
 const counters={accepted:0,unqualified:0,limited:0,invalid:0};
 const server=http.createServer({maxHeaderSize:4096},async(req,res)=>{
  if(!['/qualify','/challenge'].includes(req.url)||req.method!=='POST'){
   fail(res,404,'not-a-credential-endpoint');return;
  }
  if(stopping||pending>=maxInFlight){
   counters.limited++;fail(res,429,'bounded-proof-issuer-capacity');return;
  }
  const t=now(),window=Math.floor(t/60000);
  if(!Number.isSafeInteger(t)||t<0){
   fail(res,503,'invalid-operator-clock');return;
  }
  if(window!==epoch){epoch=window;attempts=0;}
  if(attempts>=attemptsPerMinute){
   counters.limited++;fail(res,429,'bounded-proof-issuer-rate');return;
  }
  attempts++;pending++;
  try{
   let bytes;
   try{bytes=await boundedBody(req);}catch{
    counters.invalid++;fail(res,413,'bounded-proof-envelope-required');return;
   }
   let request;
   try{request=JSON.parse(bytes.toString('utf8'));}catch{
    counters.invalid++;fail(res,422,'malformed-proof-evidence');return;
   }
   if(req.url==='/challenge'){
     if(!stakeVerifier||!request||
        Object.keys(request).sort().join(',')!=='subject'){
       counters.invalid++;fail(res,404,'stake4karma-testnet-not-configured');return;
     }
     let challenge;
     try{challenge=await stakeVerifier.newChallenge(request.subject);}catch{
       counters.limited++;fail(res,429,'bounded-testnet-challenge-capacity');return;
     }
     res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',
       connection:'close'});
     res.end(JSON.stringify({ok:true,challenge,...stakeVerifier.publicConfig}));
     return;
   }
   if(!request||typeof request!=='object'||Array.isArray(request)||
      Object.keys(request).sort().join(',')!=='evidence,subject'){
    counters.invalid++;fail(res,422,'malformed-proof-request');return;
   }
   const result=request.evidence?.kind==='stake4karma-testnet'?
     (stakeVerifier?await stakeVerifier.verify(request.subject,request.evidence):
       {qualified:false,reason:'stake4karma-testnet-not-configured'}):
     await issueVerifiedTrustCapability({
       signer,policy:p,subject:request.subject,evidence:request.evidence,now:t
     });
   if(!result.qualified){
    counters.unqualified++;fail(res,403,result.reason);return;
   }
   const credential=result.credential||
     await issueIngressCapability({signer,subject:request.subject,
       className:result.className,now:t,ttlMs:p.ttlMs});
   counters.accepted++;
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',
     connection:'close'});
   res.end(JSON.stringify({ok:true,credential,
     className:result.className,expiresInMs:p.ttlMs,method:result.method}));
  }catch{
   counters.invalid++;fail(res,422,'unverifiable-proof-evidence');
  }finally{pending--;}
 });
 server.maxConnections=16;server.headersTimeout=3000;
 server.requestTimeout=5000;server.keepAliveTimeout=1000;
 server.maxRequestsPerSocket=8;
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(port,host,resolve);
 });
 return {
  host,port:server.address().port,
  get counters(){return {...counters};},
  get url(){return 'http://'+host+':'+server.address().port;},
  async close(){
    stopping=true;server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
 };
}
