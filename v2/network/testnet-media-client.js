// Browser-compatible, explicitly initiated Base Sepolia (84532) media
// proof flow. User's Ed25519 key never leaves browser local identity.
// A wallet transaction occurs ONLY on a separate, explicit deposit click.
// The selected media peer independently pins the operator's issuer public
// key and audience, and refuses all testnet grants in production mode.
import {signCredential,depositNative,readPosition,
 assertCompatibleWalletKey} from './vendor/stake4karma-sdk-v0.5.0.mjs';
import {MEDIA_BASE_LIMITS,MEDIA_PHYSICAL_LIMITS,MiB} from '../core/media-resource-policy.js';

const ADDR=/^0x[0-9a-fA-F]{40}$/;
const PUB=/^ed25519:[A-Za-z0-9_-]{43}$/;
const AUTHOR=/^[a-z0-9][a-z0-9-]{2,80}$/;
const uint=(value)=>typeof value==='string'&&/^[1-9][0-9]{0,45}$/.test(value);
const hex=(buffer)=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
const decodePublic=(author)=>{
 if(!PUB.test(author||''))throw Error('WEB9000 Ed25519 identity required');
 const str=author.slice(8).replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(str);
 if(raw.length!==32)throw Error('WEB9000 public key is invalid');
 return '0x'+Array.from(raw,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
};
export function normalizeTestnetIssuerUrl(value,baseOrigin=null){
 const url=new URL(value,baseOrigin||undefined);
 if(!['http:','https:'].includes(url.protocol)||
    url.username||url.password||url.hash||url.search||
    !url.hostname||url.pathname.length>128||url.pathname.includes('..'))
  throw Error('Select a testnet issuer root URL without credentials, query or fragment');
 const dev=new Set(['localhost','127.0.0.1','[::1]']);
 if(url.protocol==='http:'&&!dev.has(url.hostname))
  throw Error('Testnet issuer requires HTTPS outside local development');
 return url.href.replace(/\/$/,'');
}
const readJson=async(response)=>{
 let result;
 try{result=await response.json();}catch{throw Error('Testnet peer returned invalid JSON');}
 if(!response.ok||result?.ok===false)
  throw Error(result?.error||'Testnet peer rejected request ('+response.status+')');
 return result;
};
export async function readTestnetMediaTerms({
 issuerUrl,mediaUrl,fetchImpl=fetch
}={}){
 const root=normalizeTestnetIssuerUrl(issuerUrl);
 const media=normalizeTestnetIssuerUrl(mediaUrl);
 const [issuerReply,peerReply]=await Promise.all([
  fetchImpl(root+'/health',{signal:AbortSignal.timeout(8000)}),
  fetchImpl(media+'/health',{signal:AbortSignal.timeout(8000)})
 ]);
 const issuer=await readJson(issuerReply),peer=await readJson(peerReply);
 if(issuer.mode!=='base-sepolia-testnet'||issuer.chainId!==84532||
    !ADDR.test(issuer.contract||'')||!uint(issuer.tier100AmountWei)||
    !uint(issuer.tier1000AmountWei)||
    BigInt(issuer.tier1000AmountWei)<=BigInt(issuer.tier100AmountWei)||
    !PUB.test(issuer.issuer||'')||
    !AUTHOR.test(issuer.audience||'')||
    peer.stakeAdmissionEnabled!==true||
    peer.stakeGrantMode!=='base-sepolia-testnet'||
    peer.stakeGrantIssuer!==issuer.issuer||
    peer.stakeGrantAudience!==issuer.audience)
  throw Error('Media peer has NOT pinned this Base Sepolia testnet grant issuer and audience');
 return {issuer,peer,issuerUrl:root,mediaUrl:media};
}
export function requiredSimulatedTestnetTier(file){
 if(!file||!Object.hasOwn(MEDIA_BASE_LIMITS,file.type)||
    !Number.isSafeInteger(file.size)||
    file.size<=MEDIA_BASE_LIMITS[file.type]||
    file.size>MEDIA_PHYSICAL_LIMITS[file.type]||
    !['image/','video/'].some(prefix=>file.type.startsWith(prefix)))
  throw Error('Select exactly one image/video that needs a testnet stake grant');
 return file.type.startsWith('video/')&&file.size>20*MiB?1000:100;
}
export async function requestTestnetMediaGrant({
 issuerUrl,mediaUrl,identity,wallet,file,fetchImpl=fetch
}={}){
 const tier=requiredSimulatedTestnetTier(file);
 const terms=await readTestnetMediaTerms({issuerUrl,mediaUrl,fetchImpl});
 if(!identity?.privateKey||!PUB.test(identity.author||'')||
    !ADDR.test(wallet||''))
  throw Error('Selected WEB9000 signing identity and linked wallet address required');
 // File.arrayBuffer is deliberately invoked only after a user action.
 // SHA-256 is computed locally: never send media bytes to the issuer.
 const checksum=hex(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
 const data={subject:identity.author,mediaType:file.type,
  bytes:file.size,sha256:checksum};
 const challenge=await readJson(await fetchImpl(terms.issuerUrl+'/challenge',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(data),signal:AbortSignal.timeout(12000)
 }));
 if(challenge.mode!=='base-sepolia-testnet'||challenge.chainId!==84532||
    challenge.contract.toLowerCase()!==terms.issuer.contract.toLowerCase()||
    challenge.issuer!==terms.issuer.issuer||
    challenge.audience!==terms.issuer.audience||
    !challenge.challenge||typeof challenge.challenge.nonce!=='string')
  throw Error('Issuer changed Base Sepolia contract, audience or signing key');
 const signature=await signCredential({
  chainId:84532,contract:terms.issuer.contract,
  wallet,publicKey:decodePublic(identity.author),
  privateKey:identity.privateKey,challenge:challenge.challenge
 });
 const issued=await readJson(await fetchImpl(terms.issuerUrl+'/grant',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({file:data,challenge:challenge.challenge,proof:signature}),
  signal:AbortSignal.timeout(12000)
 }));
 if(issued.mode!=='base-sepolia-testnet'||
    issued.simulatedTierUsd<tier||
    issued.issuer!==terms.issuer.issuer||
    issued.audience!==terms.issuer.audience||
    typeof issued.grant!=='string'||issued.grant.length>2048)
  throw Error('Untrusted or insufficient issuer testnet grant');
 return {grant:issued.grant,simulatedTierUsd:issued.simulatedTierUsd,
  lockedTestEthWei:issued.lockedTestEthWei,contract:terms.issuer.contract,
  chainId:84532,mediaPeer:terms.mediaUrl};
}
export async function depositTestnetMediaStake({
 issuerUrl,mediaUrl,identity,file,walletProvider,confirmDeposit=null
}={}){
 const tier=requiredSimulatedTestnetTier(file);
 if(!walletProvider||typeof walletProvider.request!=='function')
  throw Error('Connect an EIP-1193 browser wallet on Base Sepolia');
 // Request wallet access FIRST, directly in the user-click callback, before
 // asynchronous issuer requests can lose user-gesture attribution.
 const accounts=await walletProvider.request({method:'eth_requestAccounts'});
 const wallet=accounts?.[0];
 if(!ADDR.test(wallet||''))throw Error('No wallet account selected');
 const {issuer}=await readTestnetMediaTerms({issuerUrl,mediaUrl});
 const chain=await walletProvider.request({method:'eth_chainId'});
 if(Number(BigInt(chain))!==84532)
  throw Error('Switch your wallet to Base Sepolia (chain 84532) before depositing test ETH');
 const publicKey=decodePublic(identity?.author);
 const position=await readPosition({
  provider:walletProvider,contract:issuer.contract,wallet
 });
 assertCompatibleWalletKey(position,publicKey);
 const min=BigInt(tier===1000?issuer.tier1000AmountWei:issuer.tier100AmountWei);
 const existing=position.active?position.amount:0n;
 if(existing>=min)
  return {wallet,alreadyQualified:true,transactionHash:null,
   requiredTestEthWei:min.toString(),existingTestEthWei:existing.toString()};
 const added=min-existing;
 if(confirmDeposit!==null){
  if(typeof confirmDeposit!=='function'||
     await confirmDeposit({
      contract:issuer.contract,chainId:84532,asset:'TEST ETH',
      amountWei:added.toString(),simulatedTierUsd:tier,wallet
     })!==true)
   throw Error('Test ETH deposit not approved by the user');
 }
 // The selected user confirms this TESTNET transaction in their wallet.
 // Do not sign, approve, submit or estimate actual mainnet funds silently.
 const transactionHash=await depositNative({
  provider:walletProvider,chainId:84532,contract:issuer.contract,
  from:wallet,publicKey,amount:added
 });
 return {wallet,alreadyQualified:false,transactionHash,
  requiredTestEthWei:min.toString(),existingTestEthWei:existing.toString()};
}
