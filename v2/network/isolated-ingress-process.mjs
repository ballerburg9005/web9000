// Opt-in operator-provisioned, separately runnable ingress lane.
// For actual deployment each executable needs its OWN OS cgroup/connection
// budget. No tier is selected from requests or author claims.
// Does NOT replace the existing WEB9000 public peer or browser bridge.
// Lab: node isolated-ingress-process.mjs entry|protected /tmp/config.json 0
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createBoundedIngress} from './bounded-ingress.mjs';

const lane=process.argv[2],file=process.argv[3],port=Number(process.argv[4]??0);
if(!['entry','protected'].includes(lane)||typeof file!=='string'||
   !path.isAbsolute(file)||!Number.isSafeInteger(port)||port<0||port>65535)
  throw Error('Usage: isolated-ingress-process.mjs entry|protected /abs/operator-owned-config.json [port]');
const bytes=await readFile(file);
if(bytes.length>8192)throw Error('Operator gateway configuration exceeds size limit');
const config=JSON.parse(bytes.toString('utf8'));
if(!config||typeof config!=='object'||Array.isArray(config)||
   !config.issuer||!config.workers||Object.keys(config).sort().join(',')!=='issuer,workers')
  throw Error('Malformed operator-owned gateway config');
const gateway=await createBoundedIngress({
  workers:config.workers,expectedIssuer:config.issuer,
  lane,port,host:'127.0.0.1'
});
console.log('ISOLATED_INGRESS_READY '+JSON.stringify({
  lane,port:gateway.port,pid:process.pid
}));
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  await gateway.close();
  process.exit(0);
}
process.on('SIGTERM',()=>stop().catch(()=>process.exit(1)));
process.on('SIGINT',()=>stop().catch(()=>process.exit(1)));
