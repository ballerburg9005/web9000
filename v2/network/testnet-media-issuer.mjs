// Test-ETH collateral -> SIMULATED $100 / $1000 media tiers on Base Sepolia.
// Fully independent, OPERATOR-OPTIONAL issuer process. Never exposes private
// signing keys to a browser, media gateway or claimant. Requires an EXACT
// operator-pinned testnet escrow contract, runtime-code SHA256 and HTTPS RPC.
// Only "base-sepolia-testnet" media grants are issued. They MUST NOT be
// accepted by a gateway pinned to production real-money grants.
import {createServer} from 'node:http';
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {Stake4KarmaTestnetVerifier,validateStake4KarmaConfig} from './stake4karma-testnet-verifier.mjs';
import {importOperatorSigningKey} from './operator-proof-service.mjs';
import {signMediaStakeGrant} from './media-stake-grant.mjs';
import {MEDIA_PHYSICAL_LIMITS,MEDIA_BASE_LIMITS} from '../core/media-resource-policy.js';

const PUB=/^ed25519:[A-Za-z0-9_-]{43}$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_BODY=5*1024,MAX_PENDING=128;
const shape=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const reply=(res,status,body)=>{
 if(res.writableEnded||res.destroyed)return;
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type',
  'access-control-allow-methods':'GET,POST,OPTIONS'});
 res.end(JSON.stringify(body));
};
const fail=(res,status,error)=>reply(res,status,{ok:false,error});
const weiValue=(x)=>typeof x==='string'&&/^[1-9][0-9]{0,45}$/.test(x);
export function validateTestnetMediaConfig(config){
 if(!shape(config,['issuer','pkcs8','stake4karma','media']))
  throw Error('Private testnet media config requires issuer, pkcs8, stake4karma and media');
 const stake=validateStake4KarmaConfig(config.stake4karma);
 const m=config.media;
 if(!shape(m,['audience','tier100AmountWei','tier1000AmountWei'])||
    typeof m.audience!=='string'||
    !/^[a-z0-9][a-z0-9-]{2,80}$/.test(m.audience)||
    !weiValue(m.tier100AmountWei)||!weiValue(m.tier1000AmountWei)||
    BigInt(m.tier100AmountWei)<BigInt(stake.minimumAmountWei)||
    BigInt(m.tier1000AmountWei)<=BigInt(m.tier100AmountWei))
  throw Error('Explicit distinct, increasing simulated test-ETH thresholds are required');
 return {stake,media:Object.freeze({...m})};
}
export async function loadTestnetMediaIssuerConfig(file){
 if(!isAbsolute(file))throw Error('Absolute, operator-private 0600 config path required');
 const st=await lstat(file);
 if(!st.isFile()||(st.mode&0o077)!==0||st.size<1||st.size>16000)
  throw Error('Private testnet media issuer must use a bounded 0600 config');
 const config=JSON.parse(await readFile(file,'utf8'));
 const {stake,media}=validateTestnetMediaConfig(config);
 const signer=await importOperatorSigningKey(config);
 return {stake,media,signer};
}
function admissibleFile(file){
 return shape(file,['subject','mediaType','bytes','sha256'])&&
 PUB.test(file.subject||'')&&SHA.test(file.sha256||'')&&
 Object.hasOwn(MEDIA_PHYSICAL_LIMITS,file.mediaType)&&
 Number.isSafeInteger(file.bytes)&&
 file.bytes>MEDIA_BASE_LIMITS[file.mediaType]&&
 file.bytes<=MEDIA_PHYSICAL_LIMITS[file.mediaType]&&
 (file.mediaType.startsWith('video/')||file.mediaType.startsWith('image/'));
}
async function boundedBody(req){
 const length=req.headers['content-length'];
 if(req.headers['transfer-encoding']||typeof length!=='string'||
    !/^[0-9]{1,4}$/.test(length)||Number(length)<1||Number(length)>MAX_BODY)
  throw Error('bounded-body-required');
 let received=0,parts=[];
 for await(const piece of req){
  received+=piece.length;
  if(received>MAX_BODY)throw Error('request-exceeds-size-budget');
  parts.push(piece);
 }
 if(received!==Number(length))throw Error('invalid-content-length');
 return JSON.parse(Buffer.concat(parts,received).toString('utf8'));
}
export async function createTestnetMediaIssuer({
 signer,stakeConfig,mediaConfig,provider=null,host='127.0.0.1',
 port=0,now=()=>Date.now(),attemptsPerMinute=24,maxInFlight=2
}={}){
 if(!signer?.privateKey||!PUB.test(signer.author||'')||
    !['127.0.0.1','::1'].includes(host)||
    !Number.isSafeInteger(port)||port<0||port>65535||
    !Number.isSafeInteger(attemptsPerMinute)||attemptsPerMinute<1||attemptsPerMinute>500||
    !Number.isSafeInteger(maxInFlight)||maxInFlight<1||maxInFlight>8)
  throw Error('Testnet issuer requires bounded loopback service and operator signing key');
 const {stake,media}=validateTestnetMediaConfig({
  issuer:signer.author,pkcs8:'operator-key-not-exported',
  stake4karma:stakeConfig,media:mediaConfig
 });
 const verifier=new Stake4KarmaTestnetVerifier({
  config:stake,operator:signer.author,provider,now
 });
 const pending=new Map(),stats={requested:0,issued:0,rejected:0,limited:0};
 let inFlight=0,epoch=-1,attempts=0;
 const server=createServer({maxHeaderSize:4096},async(req,res)=>{
  if(req.method==='OPTIONS'){
   reply(res,204,{});return;
  }
  if(req.method==='GET'&&req.url==='/health'){
   reply(res,200,{ok:true,mode:'base-sepolia-testnet',
    issuer:signer.author,audience:media.audience,
    chainId:84532,contract:stake.contract,
    asset:'test ETH',tier100AmountWei:media.tier100AmountWei,
    tier1000AmountWei:media.tier1000AmountWei,
    disclaimer:'SIMULATED USD tiers. No real-dollar value, payout or mainnet stake.'});
   return;
  }
  if(req.method!=='POST'||!['/challenge','/grant'].includes(req.url)){
   fail(res,404,'unknown-testnet-media-endpoint');return;
  }
  const t=now(),window=Math.floor(t/60000);
  if(window!==epoch){epoch=window;attempts=0;}
  if(!Number.isSafeInteger(t)||t<0||inFlight>=maxInFlight||
     attempts>=attemptsPerMinute){
   stats.limited++;fail(res,429,'testnet-issuer-capacity-exhausted');return;
  }
  attempts++;inFlight++;
  try{
   let body;
   try{body=await boundedBody(req);}
   catch{stats.rejected++;fail(res,422,'invalid-bounded-json-body');return;}
   if(req.url==='/challenge'){
    if(!admissibleFile(body)){
     stats.rejected++;fail(res,422,'invalid-file-specific-testnet-grant-request');return;
    }
    for(const [nonce,item] of pending)
     if(item.challenge.expiresAt*1000<=t)pending.delete(nonce);
    if(pending.size>=MAX_PENDING){
     stats.limited++;fail(res,429,'testnet-challenge-capacity-exhausted');return;
    }
    let challenge;
    try{challenge=await verifier.newChallenge(body.subject);}
    catch{stats.limited++;fail(res,429,'testnet-verifier-capacity-exhausted');return;}
    pending.set(challenge.nonce,{file:body,challenge});
    stats.requested++;
    reply(res,200,{ok:true,challenge,issuer:signer.author,
     audience:media.audience,chainId:84532,contract:stake.contract,
     testnetUsd100AmountWei:media.tier100AmountWei,
     testnetUsd1000AmountWei:media.tier1000AmountWei,
     mode:'base-sepolia-testnet',
     disclaimer:'100/1000 tiers use operator-set TEST ETH, not real USD.'});
    return;
   }
   if(!shape(body,['file','challenge','proof'])||
      !admissibleFile(body.file)||!body.challenge||
      typeof body.challenge.nonce!=='string'){
    stats.rejected++;fail(res,422,'invalid-testnet-grant-proof-envelope');return;
   }
   const saved=pending.get(body.challenge.nonce);
   // A challenge authorizes exactly one file, not an arbitrary new 100 MiB
   // replacement after a lower-size bond check.
   if(!saved||JSON.stringify(saved.file)!==JSON.stringify(body.file)||
      JSON.stringify(saved.challenge)!==JSON.stringify(body.challenge)){
    stats.rejected++;fail(res,403,'challenge-not-issued-for-this-exact-file');return;
   }
   pending.delete(body.challenge.nonce);
   const verified=await verifier.verify(body.file.subject,{
    kind:'stake4karma-testnet',challenge:body.challenge,proof:body.proof
   });
   if(!verified.qualified){
    stats.rejected++;fail(res,403,'testnet-escrow-proof-'+verified.reason);return;
   }
   const amount=BigInt(verified.amountWei);
   const tier=amount>=BigInt(media.tier1000AmountWei)?1000:
    amount>=BigInt(media.tier100AmountWei)?100:0;
   const required=body.file.mediaType.startsWith('image/')?100:
    body.file.bytes>20*1024*1024?1000:100;
   if(tier<required){
    stats.rejected++;fail(res,403,'insufficient-test-ETH-for-simulated-tier');return;
   }
   const evidenceSha256=createHash('sha256').update(JSON.stringify({
    chainId:84532,contract:verified.contract,
    wallet:body.proof.wallet,subject:body.file.subject,
    amountWei:verified.amountWei,challenge:body.challenge
   })).digest('hex');
   const token=await signMediaStakeGrant({
    signer,subject:body.file.subject,audience:media.audience,
    mediaType:body.file.mediaType,bytes:body.file.bytes,
    sha256:body.file.sha256,stakeUsdCents:tier*100,
    evidenceSha256,mode:'base-sepolia-testnet',now:now(),ttlMs:60000
   });
   stats.issued++;
   reply(res,200,{ok:true,mode:'base-sepolia-testnet',grant:token,
    simulatedTierUsd:tier,lockedTestEthWei:verified.amountWei,
    expiresInMs:60000,issuer:signer.author,audience:media.audience});
  }catch{
   stats.rejected++;fail(res,503,'testnet-verifier-or-issuer-failed');
  }finally{inFlight--;}
 });
 server.maxConnections=16;
 server.headersTimeout=3000;server.requestTimeout=7500;
 server.keepAliveTimeout=1000;server.maxRequestsPerSocket=8;
 await new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(port,host,resolve);
 });
 return {
  host,port:server.address().port,get url(){return 'http://'+host+':'+server.address().port;},
  get stats(){return {...stats,pending:pending.size};},
  async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 };
}
if(process.argv[1]&&/testnet-media-issuer\.mjs$/.test(process.argv[1])){
 const file=process.argv[2],port=Number(process.argv[3]??18769);
 if(!file||!Number.isSafeInteger(port)||port<1||port>65535)
  throw Error('Usage: node testnet-media-issuer.mjs /abs/private/testnet-issuer.json [loopback-port]');
 const config=await loadTestnetMediaIssuerConfig(file);
 const service=await createTestnetMediaIssuer({
  signer:config.signer,stakeConfig:config.stake,
  mediaConfig:config.media,port
 });
 console.log('TESTNET_MEDIA_ISSUER_READY '+JSON.stringify({
  port:service.port,issuer:config.signer.author,
  audience:config.media.audience,chainId:84532,
  contract:config.stake.contract,mode:'base-sepolia-testnet'
 }));
 const stop=async()=>{await service.close();process.exit(0);};
 process.once('SIGTERM',()=>{stop().catch(()=>process.exit(1));});
 process.once('SIGINT',()=>{stop().catch(()=>process.exit(1));});
}
