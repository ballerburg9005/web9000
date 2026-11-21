import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {File} from 'node:buffer';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {generateIdentity} from '../core/events.js';
import {createTestnetMediaIssuer} from './testnet-media-issuer.mjs';
import {createImageGateway} from './media-node.mjs';
import {
 normalizeTestnetIssuerUrl,requestTestnetMediaGrant,
 readTestnetMediaTerms,depositTestnetMediaStake
} from './testnet-media-client.js';
import {MiB,KiB} from '../core/media-resource-policy.js';

const contract='0x'+'4'.repeat(40),wallet='0x'+'2'.repeat(40);
const bytecode='0x6001600055';
const codeHashSha256=createHash('sha256').update(Buffer.from(bytecode.slice(2),'hex')).digest('hex');
const cfg={chainId:84532,contract,codeHashSha256,
 minimumAmountWei:'100',rpcUrl:'https://reader.example/'};
const media={audience:'testnet-media-integration',
 tier100AmountWei:'1000',tier1000AmountWei:'10000'};
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68]);
const largeImage=()=>{
 const bytes=Buffer.alloc(600*KiB,55);PNG.copy(bytes,0);
 return new File([bytes],'source.png',{type:'image/png'});
};
test('testnet browser helper -> signed challenge -> active fake Base Sepolia contract -> exact-file grant -> real Helia media upload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w9-testnet-media-roundtrip-'));
 let issuer,ipfs,gateway,production;
 try{
  const operator=await generateIdentity(),subject=await generateIdentity();
  const pub=Buffer.from(subject.author.slice(8),'base64url').toString('hex');
  let lockedTestEthWei=1500;
  const provider={async request({method}){
   if(method==='eth_getCode')return bytecode;
   if(method==='eth_chainId')return '0x14a34';
   if(method==='eth_call')return '0x'+pub+word(lockedTestEthWei)+word(1)+word(0)+word(0);
   throw Error('Unexpected RPC method');
  }};
  issuer=await createTestnetMediaIssuer({
   signer:operator,stakeConfig:cfg,mediaConfig:media,provider
  });
  const libp2p=await createLibp2p({
   addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],
   streamMuxers:[yamux()],services:{identify:identify()}
  });
  ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(join(dir,'blocks'))});
  gateway=await createImageGateway({
   ipfs,host:'127.0.0.1',port:0,manifestFile:join(dir,'testnet-manifest.json'),
   uploadEnabled:true,richMediaEnabled:true,maxTotal:128*MiB,
   stakeGrantMode:'base-sepolia-testnet',
   stakeGrantAudience:media.audience,stakeGrantIssuer:operator.author
  });
  const issuerUrl=issuer.url,mediaUrl='http://127.0.0.1:'+gateway.port;
  const file=largeImage();
  assert.equal(normalizeTestnetIssuerUrl(mediaUrl+'/v2/media/'),
   mediaUrl+'/v2/media');
  const terms=await readTestnetMediaTerms({issuerUrl,mediaUrl});
  assert.equal(terms.issuer.contract,contract);
  const request=await requestTestnetMediaGrant({
   issuerUrl,mediaUrl,identity:subject,wallet,file
  });
  assert.equal(request.simulatedTierUsd,100);
  assert.equal(request.lockedTestEthWei,'1500');
  const permitted=await fetch(mediaUrl+'/upload',{method:'POST',headers:{
   'content-type':'image/png','x-web9000-media-grant':request.grant
  },body:Buffer.from(await file.arrayBuffer())});
  assert.equal(permitted.status,201,await permitted.text());
  const health=await(await fetch(mediaUrl+'/health')).json();
  assert.equal(health.stakeGrantMode,'base-sepolia-testnet');
  assert.equal(health.imageStakeLimit,MiB);

  // A larger, independently verified ACTIVE escrow amount, rather than a
  // client self-claim, unlocks the simulated 1,000 tier. Exercise the REAL
  // 21 MiB UnixFS disk-spooled ingress and HTTP 206 range delivery.
  lockedTestEthWei=12000;
  // The default CI path uses >20 MiB; an explicit separately capped
  // stress container can exercise the EXACT 100 MiB testnet entitlement.
  const videoBytes=Buffer.alloc(
   process.env.WEB9000_BENCH_TESTNET_MEDIA_100==='1'?100*MiB:21*MiB+128,42);
  videoBytes.writeUInt32BE(24,0);
  videoBytes.write('ftyp',4,'ascii');
  videoBytes.write('isom',8,'ascii');
  const videoFile=new File([videoBytes],'journalism-demo.mp4',{type:'video/mp4'});
  const videoGrant=await requestTestnetMediaGrant({
   issuerUrl,mediaUrl,identity:subject,wallet,file:videoFile
  });
  assert.equal(videoGrant.simulatedTierUsd,1000);
  const videoResp=await fetch(mediaUrl+'/upload',{method:'POST',headers:{
   'content-type':'video/mp4','x-web9000-media-grant':videoGrant.grant
  },body:videoBytes});
  const videoInfo=await videoResp.json();
  assert.equal(videoResp.status,201,JSON.stringify(videoInfo));
  const range=await fetch(mediaUrl+'/ipfs/'+videoInfo.cid.slice(7),{
   headers:{range:'bytes=1048575-1048623'}});
  assert.equal(range.status,206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),
   videoBytes.subarray(1048575,1048624));
  if(process.env.WEB9000_BENCH_TESTNET_MEDIA_100==='1')
   console.log('TESTNET_MEDIA_100_MIB_VERIFIED '+JSON.stringify({
    bytes:videoBytes.length,cid:videoInfo.cid,
    simulatedTierUsd:videoGrant.simulatedTierUsd,
    signatureSource:'mock Base Sepolia contract, real crypto grant',
    delivery:'real Helia/UnixFS HTTP 206'
   }));

  production=await createImageGateway({
   ipfs,host:'127.0.0.1',port:0,manifestFile:join(dir,'production-manifest.json'),
   uploadEnabled:true,richMediaEnabled:true,maxTotal:20*MiB,
   stakeGrantMode:'production',stakeGrantAudience:media.audience,
   stakeGrantIssuer:operator.author
  });
  const prodUrl='http://127.0.0.1:'+production.port;
  const denied=await fetch(prodUrl+'/upload',{method:'POST',headers:{
   'content-type':'image/png','x-web9000-media-grant':request.grant
  },body:Buffer.from(await file.arrayBuffer())});
  assert.equal(denied.status,403,'testnet grant must not promote production admission');
  await assert.rejects(readTestnetMediaTerms({issuerUrl,mediaUrl:prodUrl}),
   /NOT pinned/);
  // Invalid issuer key must fail rather than sending the user's signed proof
  // to an unrelated endpoint.
  assert.equal(issuer.stats.issued,2);
 }finally{
  await production?.close();await gateway?.close();
  await issuer?.close();await ipfs?.stop();
  await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
test('explicit test ETH deposit never sends a mainnet transaction; already qualified lock sends none',async()=>{
 const operator=await generateIdentity(),subject=await generateIdentity();
 const pub=Buffer.from(subject.author.slice(8),'base64url').toString('hex');
 const provider={async request({method}){
  if(method==='eth_getCode')return bytecode;
  if(method==='eth_chainId')return '0x14a34';
  if(method==='eth_call')return '0x'+pub+word(1500)+word(1)+word(0)+word(0);
  throw Error('Unrecognized');
 }};
 const issuer=await createTestnetMediaIssuer({
  signer:operator,stakeConfig:cfg,mediaConfig:media,provider
 });
 const {createServer}=await import('node:http');
 const mediaProxy=createServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({stakeAdmissionEnabled:true,
   stakeGrantMode:'base-sepolia-testnet',stakeGrantAudience:media.audience,
   stakeGrantIssuer:operator.author}));
 });
 await new Promise(resolve=>mediaProxy.listen(0,'127.0.0.1',resolve));
 const mediaUrl='http://127.0.0.1:'+mediaProxy.address().port;
 const file=largeImage(),sent=[];
 const walletProvider={async request({method,params}){
  sent.push(method);
  if(method==='eth_requestAccounts')return [wallet];
  if(method==='eth_chainId')return '0x14a34';
  if(method==='eth_call')return '0x'+pub+word(1500)+word(1)+word(0)+word(0);
  if(method==='eth_sendTransaction')throw Error('Already-qualified wallet MUST NOT submit deposit');
 }};
 try{
  const result=await depositTestnetMediaStake({
   issuerUrl:issuer.url,mediaUrl,identity:subject,file,walletProvider
  });
  assert.equal(result.alreadyQualified,true);
  assert.equal(result.transactionHash,null);
  assert.equal(sent.includes('eth_sendTransaction'),false);
  const fakeMainnet={request:async({method})=>{
   if(method==='eth_requestAccounts')return [wallet];
   if(method==='eth_chainId')return '0x1';
   throw Error('Unexpected chain RPC');
  }};
  await assert.rejects(depositTestnetMediaStake({
   issuerUrl:issuer.url,mediaUrl,identity:subject,file,
   walletProvider:fakeMainnet
  }),/Switch your wallet to Base Sepolia/);
 }finally{
  await issuer.close();
  await new Promise(resolve=>mediaProxy.close(resolve));
 }
});

test('explicit browser-wallet deposit requests ONLY a Base Sepolia transaction and binds WEB9000 Ed25519 key',async()=>{
 const operator=await generateIdentity(),subject=await generateIdentity();
 const blankKey='0'.repeat(64);
 const provider={async request({method}){
  if(method==='eth_getCode')return bytecode;
  if(method==='eth_chainId')return '0x14a34';
  if(method==='eth_call')return '0x'+blankKey+word(0)+word(0)+word(0)+word(0);
  throw Error('Unexpected contract RPC');
 }};
 const issuer=await createTestnetMediaIssuer({
  signer:operator,stakeConfig:cfg,mediaConfig:media,provider
 });
 const {createServer}=await import('node:http');
 const mediaProxy=createServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({stakeAdmissionEnabled:true,
   stakeGrantMode:'base-sepolia-testnet',
   stakeGrantAudience:media.audience,stakeGrantIssuer:operator.author}));
 });
 await new Promise(resolve=>mediaProxy.listen(0,'127.0.0.1',resolve));
 const mediaUrl='http://127.0.0.1:'+mediaProxy.address().port;
 const transactions=[],called=[];
 const walletProvider={async request({method,params}){
  called.push(method);
  if(method==='eth_requestAccounts')return [wallet];
  if(method==='eth_chainId')return '0x14a34';
  if(method==='eth_call')return '0x'+blankKey+word(0)+word(0)+word(0)+word(0);
  if(method==='eth_sendTransaction'){
   transactions.push(params[0]);return '0x'+'e'.repeat(64);
  }
  throw Error('Unexpected wallet method '+method);
 }};
 try{
  const result=await depositTestnetMediaStake({
   issuerUrl:issuer.url,mediaUrl,identity:subject,
   file:largeImage(),walletProvider
  });
  assert.equal(result.alreadyQualified,false);
  assert.equal(result.transactionHash,'0x'+'e'.repeat(64));
  assert.equal(transactions.length,1);
  assert.equal(transactions[0].to,contract);
  assert.equal(transactions[0].from,wallet);
  assert.equal(transactions[0].value,'0x3e8','simulated 100 tier locks 1000 test wei');
  assert.equal(transactions[0].data.slice(0,10),'0x42ef5fbb',
   'transaction uses Stake4Karma depositNative selector, not raw transfer');
  assert.ok(called.indexOf('eth_chainId')<called.indexOf('eth_sendTransaction'));
 }finally{
  await issuer.close();await new Promise(resolve=>mediaProxy.close(resolve));
 }
});
