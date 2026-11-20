import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateIdentity} from '../core/events.js';
import {signCredential} from './vendor/stake4karma-sdk-v0.5.0.mjs';
import {Stake4KarmaTestnetVerifier,validateStake4KarmaConfig} from
  './stake4karma-testnet-verifier.mjs';

const wallet='0x'+'1'.repeat(40);
const contract='0x'+'2'.repeat(40);
const code='0x6001600055';
const hash=createHash('sha256').update(Buffer.from(code.slice(2),'hex'))
  .digest('hex');
const config={chainId:84532,contract,codeHashSha256:hash,
  minimumAmountWei:'10000',rpcUrl:'https://example.test/'};
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const pos=(subject,{amount=20000,active=true,key=null}={})=>
  '0x'+(key||Buffer.from(subject.slice(8),'base64url').toString('hex'))+
  word(amount)+word(active?1:0)+word(0)+word(0);
const provider=(subject,options={})=>({
  async request({method,params}){
    if(method==='eth_getCode'){
      assert.equal(params[0],contract);
      return options.code||code;
    }
    if(method==='eth_chainId')return options.chain||'0x14a34';
    if(method==='eth_call'){
      assert.equal(params[0].to,contract);
      return pos(subject,options);
    }
    throw Error('Unexpected method '+method);
  }
});
test('pinned testnet stake receipt verifies actual credential signature and independently queried active escrow, not claimed balance',async()=>{
 const operator=await generateIdentity(),subject=await generateIdentity();
 const v=new Stake4KarmaTestnetVerifier({
   config,operator:operator.author,provider:provider(subject.author)
 });
 const challenge=await v.newChallenge(subject.author);
 const proof=await signCredential({
   chainId:84532,contract,wallet,
   publicKey:'0x'+Buffer.from(subject.author.slice(8),'base64url').toString('hex'),
   privateKey:subject.privateKey,challenge
 });
 const verified=await v.verify(subject.author,{
   kind:'stake4karma-testnet',challenge,proof,
   fakeKarma:1000000000
 });
 assert.equal(verified.qualified,true,JSON.stringify(verified));
 assert.equal(verified.className,'sponsored');
 assert.equal(verified.amountWei,'20000');
 assert.equal((await v.verify(subject.author,{
   kind:'stake4karma-testnet',challenge,proof
 })).qualified,false,'same issuer nonce cannot be replayed');
 assert.equal((await v.verify((await generateIdentity()).author,{
   kind:'stake4karma-testnet',challenge,proof
 })).qualified,false,'original WEB9000 signer must equal stake-bound key');
});

test('testnet pin rejects bad escrow bytecode, wrong chain, inactive coins and insufficient locked amount',async()=>{
 const issuer=await generateIdentity(),owner=await generateIdentity();
 const publicKey='0x'+Buffer.from(owner.author.slice(8),'base64url').toString('hex');
 for(const options of [
   {code:'0x6000'},
   {chain:'0x1'},
   {amount:9999},
   {active:false},
   {key:'a'.repeat(64)}
 ]){
   const verifier=new Stake4KarmaTestnetVerifier({
     config,operator:issuer.author,provider:provider(owner.author,options)
   });
   const challenge=await verifier.newChallenge(owner.author);
   const proof=await signCredential({
     chainId:84532,contract,wallet,publicKey,privateKey:owner.privateKey,challenge
   });
   const result=await verifier.verify(owner.author,{
     kind:'stake4karma-testnet',challenge,proof
   });
   assert.equal(result.qualified,false,JSON.stringify({options,result}));
 }
});
test('stake4karma operator cannot configure arbitrary contract, user-supplied RPC, ETH mainnet or zero bond',async()=>{
 for(const bad of [
   {...config,chainId:1},
   {...config,minimumAmountWei:'0'},
   {...config,contract:'0x'+'0'.repeat(40)},
   {...config,codeHashSha256:'0'.repeat(63)},
   {...config,rpcUrl:'http://public.example.org/'}
 ])assert.throws(()=>validateStake4KarmaConfig(bad));
 const id=await generateIdentity();
 const verifier=new Stake4KarmaTestnetVerifier({
   config,operator:id.author,provider:provider(id.author)
 });
 const challenge=await verifier.newChallenge(id.author);
 assert.equal((await verifier.verify(id.author,{kind:'stake4karma-testnet',
   challenge:{...challenge,expiresAt:challenge.expiresAt+50},
   proof:{}})).qualified,false,'client cannot extend issued challenge');
});
