// Opt-in WEB9000 -> Stake4Karma v0.5 TESTNET adapter.
// Source SDK: ballerburg9005/stake4karma @
// cce170d99f105b8f7a67d7102586c64c70eff9e3, src/stake.js, MIT.
// Its unaudited escrow source code and RPC results are NOT a production bond.
//
// Trust is anchored in OPERATOR configuration: Base Sepolia 84532 ONLY,
// exact deployed contract, exact SHA-256 of the runtime bytecode, explicit
// minimum amount, a private verifier-issued nonce, and a pinned RPC service.
// No client balance, URL, contract, chain or claimed wallet is authoritative.
// A verified bond earns only local SPONSORED bandwidth, NEVER group legitimacy.
import {createHash} from 'node:crypto';
import {createChallenge,verifyCredential,NATIVE_ASSET} from './vendor/stake4karma-sdk-v0.5.0.mjs';

const ADDR=/^0x[0-9a-fA-F]{40}$/;
const CODE_HASH=/^[0-9a-f]{64}$/;
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const MAX_CHALLENGES=512;
const reason=error=>({qualified:false,reason:error});
const dataEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function validateStake4KarmaConfig(config){
 if(!config||typeof config!=='object'||Array.isArray(config)||
   Object.keys(config).sort().join(',')!==
    'chainId,codeHashSha256,contract,minimumAmountWei,rpcUrl'||
   config.chainId!==84532||!ADDR.test(config.contract||'')||
   config.contract.toLowerCase()==='0x'+'0'.repeat(40)||
   !CODE_HASH.test(config.codeHashSha256||'')||
   typeof config.minimumAmountWei!=='string'||
   !/^[1-9][0-9]{0,45}$/.test(config.minimumAmountWei))
   throw Error('Pin Base Sepolia contract, code hash and positive minimum test ETH');
 const url=new URL(config.rpcUrl);
 if(url.protocol!=='https:'||url.username||url.password||
   url.hash||url.search||url.pathname!=='/'||url.port)
   throw Error('Pinned RPC endpoint must be a simple HTTPS origin');
 return Object.freeze({...config,contract:config.contract.toLowerCase(),
   rpcUrl:url.toString()});
}

export function createPinnedRpcProvider(url,{fetchImpl=fetch}={}){
 const u=new URL(url);
 if(u.protocol!=='https:')throw Error('HTTPS pin required');
 let nextId=0;
 return {async request({method,params=[]}){
   if(!['eth_chainId','eth_getCode','eth_call'].includes(method))
     throw Error('Read-only pinned contract verifier RPC only');
   const id=++nextId;
   const response=await fetchImpl(u.toString(),{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
     signal:AbortSignal.timeout(3500),redirect:'error'
   });
   if(!response.ok||!response.body)throw Error('Pinned RPC unreachable');
   // Never trust an external node to return arbitrarily large JSON into
   // the proof worker's limited RAM.
   const reader=response.body.getReader(),parts=[];
   let size=0;
   try{
     for(;;){
       const {done,value}=await reader.read();
       if(done)break;
       size+=value.byteLength;
       if(size>65536)throw Error('RPC result exceeds resource budget');
       parts.push(value);
     }
   }finally{await reader.cancel().catch(()=>{});}
   const raw=Buffer.concat(parts.map(x=>Buffer.from(x)),size).toString('utf8');
   const json=JSON.parse(raw);
   if(json.jsonrpc!=='2.0'||json.id!==id||json.error||
      typeof json.result!=='string')
     throw Error('Malformed or rejected pinned RPC response');
   return json.result;
 }};
}

export class Stake4KarmaTestnetVerifier{
 #config;#provider;#audience;#now;#outstanding=new Map();
 constructor({config,operator,provider=null,now=()=>Date.now()}={}){
   this.#config=validateStake4KarmaConfig(config);
   if(!AUTHOR.test(operator||'')||typeof now!=='function')
     throw Error('Operator signing identity is required to bind audience');
   this.#audience='web9000-ingress/'+operator;
   this.#provider=provider||createPinnedRpcProvider(this.#config.rpcUrl);
   this.#now=now;
 }
 get publicConfig(){
   return {chainId:this.#config.chainId,contract:this.#config.contract,
     asset:NATIVE_ASSET,minimumAmountWei:this.#config.minimumAmountWei,
     expectedAudience:this.#audience};
 }
 async newChallenge(subject){
   const now=this.#now();
   if(!AUTHOR.test(subject||'')||!Number.isSafeInteger(now)||now<0)
     throw Error('Original signed WEB9000 subject required');
   for(const [nonce,item] of this.#outstanding)
     if(item.challenge.expiresAt<=Math.floor(now/1000))
       this.#outstanding.delete(nonce);
   if(this.#outstanding.size>=MAX_CHALLENGES)
     throw Error('Proof challenge queue is full');
   const challenge=createChallenge(this.#audience,{
     ttlSeconds:90,now:Math.floor(now/1000)
   });
   this.#outstanding.set(challenge.nonce,{subject,challenge});
   return challenge;
 }
 async verify(subject,evidence){
   try{
     if(!AUTHOR.test(subject||'')||evidence?.kind!=='stake4karma-testnet'||
       !evidence.challenge||!evidence.proof)
       return reason('invalid-testnet-credential-request');
     const {challenge,proof}=evidence;
     if(typeof challenge.nonce!=='string')return reason('missing-issuer-nonce');
     const stored=this.#outstanding.get(challenge.nonce);
     if(!stored||stored.subject!==subject||
        !dataEqual(stored.challenge,challenge))
       return reason('unissued-mismatched-or-replayed-challenge');
     const claimantKey='0x'+Buffer.from(subject.slice(8),'base64url').toString('hex');
     if(proof.publicKey?.toLowerCase()!==claimantKey.toLowerCase())
       return reason('stake-key-does-not-match-original-author');
     const raw=await this.#provider.request({method:'eth_getCode',
       params:[this.#config.contract,'latest']});
     if(typeof raw!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(raw))
       return reason('contract-code-absent-or-invalid');
     const hash=createHash('sha256').update(Buffer.from(raw.slice(2),'hex'))
       .digest('hex');
     if(hash!==this.#config.codeHashSha256)
       return reason('operator-pinned-contract-code-mismatch');
     const result=await verifyCredential({
       provider:this.#provider,chainId:this.#config.chainId,
       contract:this.#config.contract,asset:NATIVE_ASSET,
       expectedAudience:this.#audience,
       minimumAmount:BigInt(this.#config.minimumAmountWei),
       challenge,proof,now:Math.floor(this.#now()/1000),
       // Atomic consume; this process is a SINGLE bounded issuer.
       consumeNonce:async(aud,nonce)=>{
         if(aud!==this.#audience)return false;
         const prior=this.#outstanding.get(nonce);
         if(!prior||prior.subject!==subject)return false;
         this.#outstanding.delete(nonce);return true;
       }
     });
     if(!result.ok)return reason('stake-proof-'+result.reason);
     return {qualified:true,verification:'independent',subject,
       className:'sponsored',method:'pinned-base-sepolia-stake',
       // Never quote simulated values as real coins or USD.
       amountWei:result.amount.toString(),asset:NATIVE_ASSET,
       contract:this.#config.contract,chainId:this.#config.chainId};
   }catch{return reason('stake-testnet-verification-unavailable');}
 }
}
