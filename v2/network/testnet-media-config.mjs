// Explicit operator-only setup for TESTNET media issuer. No global
// default contract, no mainnet support and no automatic on-chain deploy.
// "inspect" obtains current runtime bytecode hash from an operator-chosen
// HTTPS RPC; the operator must compare it to independently verified source.
// "init" creates a NEW private 0600 issuer key, never overwriting any file.
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {generateIdentity} from '../core/events.js';
import {createPinnedRpcProvider} from './stake4karma-testnet-verifier.mjs';
import {validateTestnetMediaConfig} from './testnet-media-issuer.mjs';
const [mode,...args]=process.argv.slice(2);
const addr=/^0x[0-9a-fA-F]{40}$/;
const hash=/^[0-9a-f]{64}$/;
const pos=/^[1-9][0-9]{0,45}$/;
if(mode==='inspect'&&args.length===2){
 const [rpcUrl,contract]=args;
 if(!addr.test(contract||''))throw Error('Exact Base Sepolia contract required');
 const {validateStake4KarmaConfig}=await import('./stake4karma-testnet-verifier.mjs');
 validateStake4KarmaConfig({
  chainId:84532,contract,codeHashSha256:'0'.repeat(64),
  minimumAmountWei:'1',rpcUrl
 });
 const provider=createPinnedRpcProvider(rpcUrl);
 const chain=await provider.request({method:'eth_chainId'});
 if(Number(BigInt(chain))!==84532)throw Error('Remote RPC is not Base Sepolia (84532)');
 const code=await provider.request({method:'eth_getCode',params:[contract,'latest']});
 if(!/^0x(?:[0-9a-fA-F]{2})+$/.test(code))
  throw Error('Contract has no inspectable runtime bytecode');
 console.log(JSON.stringify({network:'Base Sepolia',chainId:84532,
  contract:contract.toLowerCase(),codeHashSha256:
   createHash('sha256').update(Buffer.from(code.slice(2),'hex')).digest('hex'),
  byteLength:(code.length-2)/2,warning:'Untrusted RPC hash ONLY. Compare against independently reviewed on-chain bytecode and verified Solidity source.'}));
}else if(mode==='init'&&args.length===7){
 const [output,rpcUrl,contract,codeHashSha256,
  tier100AmountWei,tier1000AmountWei,audience]=args;
 if(!output.startsWith('/')||!addr.test(contract||'')||!hash.test(codeHashSha256||'')||
    !pos.test(tier100AmountWei||'')||!pos.test(tier1000AmountWei||''))
  throw Error('Explicit private output, verified Base Sepolia contract/hash and test-ETH wei thresholds required');
 const signer=await generateIdentity({extractable:true});
 const pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',signer.privateKey))
  .toString('base64');
 const config={
  issuer:signer.author,pkcs8,
  stake4karma:{chainId:84532,rpcUrl,contract:contract.toLowerCase(),
   codeHashSha256,minimumAmountWei:tier100AmountWei},
  media:{audience,tier100AmountWei,tier1000AmountWei}
 };
 validateTestnetMediaConfig(config);
 const file=await open(output,'wx',0o600);
 try{await file.writeFile(JSON.stringify(config,null,2)+'\n');
  await file.sync();}finally{await file.close();}
 console.log(JSON.stringify({ok:true,privateConfigFile:output,
  issuer:signer.author,chainId:84532,contract:config.stake4karma.contract,
  simulatedTier100TestEthWei:tier100AmountWei,
  simulatedTier1000TestEthWei:tier1000AmountWei,
  mediaGatewayConfig:{
   WEB9000_MEDIA_STAKE_MODE:'base-sepolia-testnet',
   WEB9000_ENABLE_TESTNET_MEDIA:'1',
   WEB9000_MEDIA_STAKE_ISSUER:signer.author,
   WEB9000_MEDIA_STAKE_AUDIENCE:audience
  },
  warning:'Keep private issuer file secret. No real-dollar valuation. No existing WEB9000 peer is changed; no real contract was deployed.'}));
}else{
 throw Error('Usage: node testnet-media-config.mjs inspect HTTPS_RPC BASE_SEPOLIA_CONTRACT | init /abs/NEW/private-config.json HTTPS_RPC BASE_SEPOLIA_CONTRACT VERIFIED_RUNTIME_SHA256 SIMULATED_$100_TEST_ETH_WEI SIMULATED_$1000_TEST_ETH_WEI AUDIENCE');
}
