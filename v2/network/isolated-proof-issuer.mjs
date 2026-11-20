// Separate small credential-issuance process. It must run in its OWN
// CPU/RAM/PID-limited container, away from entry and protected publication.
// Usage: node isolated-proof-issuer.mjs /run/private/issuer.json [port]
import {loadOperatorProofConfig,createOperatorProofService} from './operator-proof-service.mjs';
import {Stake4KarmaTestnetVerifier} from './stake4karma-testnet-verifier.mjs';
const file=process.argv[2],port=Number(process.argv[3]??18767);
if(!file||!Number.isSafeInteger(port)||port<1||port>65535)
 throw Error('Usage: node isolated-proof-issuer.mjs /absolute/private-config.json [port]');
const {signer,policy,stakeConfig}=await loadOperatorProofConfig(file);
const stakeVerifier=stakeConfig?new Stake4KarmaTestnetVerifier({
  config:stakeConfig,operator:signer.author
}):null;
const service=await createOperatorProofService({
  signer,policy,stakeVerifier,port
});
console.log('ISOLATED_PROOF_ISSUER_READY '+JSON.stringify({
 port:service.port,pid:process.pid,operator:signer.author,
 roots:policy.roots.length,groupPins:policy.groupPins.length,
 stake4karmaTestnetEnabled:!!stakeVerifier
}));
let closing=false;
async function close(){
 if(closing)return;closing=true;
 await service.close();process.exit(0);
}
process.on('SIGTERM',()=>{close().catch(()=>process.exit(1));});
process.on('SIGINT',()=>{close().catch(()=>process.exit(1));});
