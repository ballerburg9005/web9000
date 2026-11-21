import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateIdentity} from '../core/events.js';
import {signCredential} from './vendor/stake4karma-sdk-v0.5.0.mjs';
import {createTestnetMediaIssuer,validateTestnetMediaConfig} from './testnet-media-issuer.mjs';
import {verifyMediaStakeGrant} from './media-stake-grant.mjs';
import {MiB,KiB} from '../core/media-resource-policy.js';

const contract='0x'+'2'.repeat(40),wallet='0x'+'1'.repeat(40),code='0x6001600055';
const codeHashSha256=createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex');
const digest=x=>createHash('sha256').update(x).digest('hex');
const cfg={chainId:84532,contract,codeHashSha256,
 minimumAmountWei:'100',rpcUrl:'https://operator-rpc.example/'};
const media={audience:'testnet-media-audience',tier100AmountWei:'1000',
 tier1000AmountWei:'10000'};
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const json=async(url,data)=>{
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
 return {status:r.status,data:await r.json()};
};
async function fixture(amount=1500,{wrongChain=false,active=true,codeOverride=null}={}){
 const issuer=await generateIdentity(),subject=await generateIdentity();
 const pub=Buffer.from(subject.author.slice(8),'base64url').toString('hex');
 const provider={async request({method,params}){
  if(method==='eth_getCode')return codeOverride||code;
  if(method==='eth_chainId')return wrongChain?'0x1':'0x14a34';
  if(method==='eth_call')return '0x'+pub+word(amount)+word(active?1:0)+word(0)+word(0);
  throw Error('Unexpected RPC method '+method);
 }};
 const service=await createTestnetMediaIssuer({
  signer:issuer,stakeConfig:cfg,mediaConfig:media,provider
 });
 const file=(bytes=5*MiB,mediaType='video/mp4')=>({
  subject:subject.author,mediaType,bytes,sha256:digest('one exact test media file')
 });
 const signed=async(filePayload)=>{
  const response=await json(service.url+'/challenge',filePayload);
  assert.equal(response.status,200,JSON.stringify(response));
  const {challenge}=response.data;
  const proof=await signCredential({
   chainId:84532,contract,wallet,privateKey:subject.privateKey,
   publicKey:'0x'+pub,challenge
  });
  return {file:filePayload,challenge,proof};
 };
 return {service,issuer,subject,file,signed};
}
test('Base Sepolia issuer maps independent active TEST ETH position to simulated $100, signs exact media hash; production rejects token',async()=>{
 const f=await fixture(1500);
 try{
  const health=await(await fetch(f.service.url+'/health')).json();
  assert.equal(health.mode,'base-sepolia-testnet');
  assert.equal(health.chainId,84532);
  assert.equal(health.tier100AmountWei,'1000');
  assert.ok(health.disclaimer.includes('SIMULATED USD'));
  const request=await f.signed(f.file(5*MiB));
  const r=await json(f.service.url+'/grant',request);
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.data.simulatedTierUsd,100);
  assert.equal(r.data.lockedTestEthWei,'1500');
  const fields={expectedIssuer:f.issuer.author,audience:media.audience,
   type:request.file.mediaType,bytes:request.file.bytes};
  const checked=await verifyMediaStakeGrant(r.data.grant,{
   ...fields,mode:'base-sepolia-testnet'});
  assert.equal(checked.valid,true,checked.reason);
  assert.equal(checked.usdCents,10000);
  assert.equal(checked.mode,'base-sepolia-testnet');
  assert.equal((await verifyMediaStakeGrant(r.data.grant,fields)).valid,false,
   'production gateway must NEVER accept testnet grants');
  assert.equal((await json(f.service.url+'/grant',request)).status,403,
   'challenge may not issue two grants');
 }finally{await f.service.close();}
});
test('simulated $100 tier cannot buy a 21 MiB video; $1000 tier permits 21 MiB and a maximum 100 MiB file',async()=>{
 const f=await fixture(1500);
 try{
  assert.equal((await json(f.service.url+'/grant',
   await f.signed(f.file(21*MiB)))).status,403);
 }finally{await f.service.close();}
 const full=await fixture(12000);
 try{
  for(const size of [21*MiB,100*MiB]){
   const req=await full.signed(full.file(size));
   const out=await json(full.service.url+'/grant',req);
   assert.equal(out.status,200,JSON.stringify(out));
   assert.equal(out.data.simulatedTierUsd,1000);
   assert.equal((await verifyMediaStakeGrant(out.data.grant,{
    expectedIssuer:full.issuer.author,audience:media.audience,
    type:'video/mp4',bytes:size,mode:'base-sepolia-testnet'
   })).valid,true);
  }
 }finally{await full.service.close();}
});
test('challenge cannot be changed to another size, digest, author, or wallet identity',async()=>{
 const f=await fixture();
 try{
  const issued=await f.signed(f.file(5*MiB));
  for(const alternate of [
   {...issued.file,bytes:100*MiB},
   {...issued.file,sha256:digest('different media')},
   {...issued.file,subject:(await generateIdentity()).author}
  ]){
   const result=await json(f.service.url+'/grant',{...issued,file:alternate});
   assert.equal(result.status,403);
  }
  const attacker=(await generateIdentity());
  const wrong=await signCredential({
   chainId:84532,contract,wallet,privateKey:attacker.privateKey,
   publicKey:'0x'+Buffer.from(attacker.author.slice(8),'base64url').toString('hex'),
   challenge:issued.challenge
  });
  assert.equal((await json(f.service.url+'/grant',{
   ...issued,proof:wrong
  })).status,403);
 }finally{await f.service.close();}
});
test('fails closed on wrong contract code, wrong chain, inactive position, insufficient stake, or unconfigured values',async()=>{
 for(const opts of [
  {wrongChain:true},{active:false},{codeOverride:'0x6000'},{amount:999}
 ]){
  const {amount,...rest}=opts;
  const f=await fixture(amount??1500,rest);
  try{
   const out=await json(f.service.url+'/grant',await f.signed(f.file(600*KiB,'image/png')));
   assert.equal(out.status,403,JSON.stringify({opts,out}));
  }finally{await f.service.close();}
 }
 for(const invalid of [
  {...cfg,chainId:1},{...cfg,minimumAmountWei:'0'}
 ]){
  assert.throws(()=>validateTestnetMediaConfig({
   issuer:'x',pkcs8:'y',stake4karma:invalid,media
  }));
 }
 assert.throws(()=>validateTestnetMediaConfig({
  issuer:'x',pkcs8:'y',stake4karma:cfg,
  media:{...media,tier1000AmountWei:'999'}
 }),/increasing/);
});
test('private testnet issuer configuration is 0600, reloads exact signer and refuses overwrite',async()=>{
 const {mkdtemp,stat,readFile,rm,chmod}=await import('node:fs/promises');
 const {spawnSync}=await import('node:child_process');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {loadTestnetMediaIssuerConfig}=await import('./testnet-media-issuer.mjs');
 const root=await mkdtemp(join(tmpdir(),'w9-testnet-private-'));
 const file=join(root,'issuer.json');
 try{
  const command=[new URL('./testnet-media-config.mjs',import.meta.url).pathname,
   'init',file,'https://operator-rpc.example/',contract,codeHashSha256,
   media.tier100AmountWei,media.tier1000AmountWei,media.audience];
  const first=spawnSync(process.execPath,command,{encoding:'utf8',timeout:7000});
  assert.equal(first.status,0,first.stderr);
  assert.equal((await stat(file)).mode&0o077,0,'issuer private signing material must be 0600');
  const declared=JSON.parse(first.stdout);
  const loaded=await loadTestnetMediaIssuerConfig(file);
  assert.equal(loaded.signer.author,declared.issuer);
  assert.equal(loaded.media.tier1000AmountWei,media.tier1000AmountWei);
  const bytes=await readFile(file);
  const repeat=spawnSync(process.execPath,command,{encoding:'utf8',timeout:7000});
  assert.notEqual(repeat.status,0,'private issuer key must not silently rotate');
  assert.deepEqual(await readFile(file),bytes);
  await chmod(file,0o644);
  await assert.rejects(loadTestnetMediaIssuerConfig(file),/0600/);
 }finally{await rm(root,{recursive:true,force:true});}
});
