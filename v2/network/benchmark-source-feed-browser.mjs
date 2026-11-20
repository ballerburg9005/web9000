// Explicit, disposable stress benchmark for the MAXIMUM signed CIDR feed.
// First PREPARE under a generous isolated build budget, then run a REAL
// Chromium browser+WebSocket accepting peer under --memory/--cpus limits.
// Never opens or modifies hosted WEB9000, existing peer keys or OrbitDB.
//
//   node benchmark-source-feed-browser.mjs prepare /scratch/max-feed.json 131072
//   node benchmark-source-feed-browser.mjs browser /scratch/max-feed.json
//
// Keep the prepared private test key in a temporary 0700 directory, delete
// it with the rest of the fixture after the test.
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {signSourceProvenance,digestRules} from './source-provenance.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {generateIdentity} from '../core/events.js';
import {signSourceFeedBundle,verifySourceFeedDocument} from './source-feed-bundle.js';
import {classifyObservedIp} from './source-feed.js';

const [mode,filepath,requested]=process.argv.slice(2);
if(!['prepare','browser'].includes(mode)||!filepath||!path.isAbsolute(filepath))
 throw Error('Usage: benchmark-source-feed-browser.mjs prepare|browser /absolute/test-fixture.json [rule-count]');
const t0=performance.now();
const miB=n=>+(n/1048576).toFixed(2);
const report=(phase,details={})=>{
 const m=process.memoryUsage();
 console.log('SOURCEBENCH '+JSON.stringify({
  phase,elapsedSeconds:+((performance.now()-t0)/1000).toFixed(3),
  rssMiB:miB(m.rss),heapUsedMiB:miB(m.heapUsed),...details
 }));
};
if(mode==='prepare'){
 const number=requested===undefined?131072:Number(requested);
 if(!Number.isSafeInteger(number)||number<3000||number>131072)
  throw Error('Expected 3000..131072 unique CIDR entries');
 const signer=await generateIdentity({extractable:true}),now=Date.now();
 const rules=Array.from({length:number},(_,i)=>({
  cidr:(100+Math.floor(i/65536))+'.'+(Math.floor(i/256)%256)+'.'+
   (i%256)+'.0/24',
  networkKind:'vpn',country:'ZZ',asn:'AS0'
 }));
 report('rules-generated',{rules:rules.length});
 const feed=await signSourceFeedBundle(signer,{
  revision:1,issuedAt:now-1000,expiresAt:now+86400000,rules
 });
 const digest=await verifySourceFeedDocument(feed,{
   expectedIssuer:signer.author,now
 });
 if(!digest.valid)throw Error('Cannot verify synthetic signed browser fixture');
 const synthetic=Buffer.from('WEB9000 synthetic rule generator, '+number+' networks');
 const provenance=await signSourceProvenance(signer,{
   version:1,revision:1,feedDigest:digest.digest,
   previousFeedDigest:null,rulesSha256:await digestRules(rules),
   rulesCount:number,createdAt:now-1000,expiresAt:now+86400000,
   transform:'WEB9000/synthetic-source-benchmark/v1',
   sources:[{category:'other',uri:'https://fixture.invalid/synthetic-only',
    license:'SYNTHETIC-TEST-DATA',sha256:createHash('sha256').update(synthetic).digest('hex'),
    bytes:synthetic.byteLength,retrievedAt:now-1000}]
 });
 const privatePkcs8=Buffer.from(await crypto.subtle.exportKey(
  'pkcs8',signer.privateKey)).toString('base64');
 const fixture={author:signer.author,privatePkcs8,feed,provenance};
 await writeFile(filepath,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
 report('signed-fixture',{rules:number,chunks:feed.chunks.length,
  wireMiB:miB(Buffer.byteLength(JSON.stringify(feed))),
  file:filepath,notice:'TEMPORARY PRIVATE TEST SIGNING KEY; delete fixture'});
}else{
 // The Chromium profile, source socket and JavaScript browser module are
 // all local inside a disposable, network-disabled container.
 const puppeteer=(await import('puppeteer-core')).default;
 const {createBrowserBridge}=await import('./browser-bridge.mjs');
 const {Replica}=await import('../core/replica.js');
 const fixture=JSON.parse(await readFile(filepath,'utf8'));
 const privateKey=await crypto.subtle.importKey('pkcs8',
  Buffer.from(fixture.privatePkcs8,'base64'),'Ed25519',false,['sign']);
 const signer={author:fixture.author,privateKey};
 const verified=await verifySourceFeedDocument(fixture.feed,{
  expectedIssuer:signer.author
 });
 if(!verified.valid)throw Error('Maximum-size fixture signature invalid');
 report('fixture-verified',{rules:verified.rules.length,
  chunks:fixture.feed.chunks.length});
 // Test that CIDR classification actually builds the fast prefix index.
 const lookupStart=performance.now();
 const observed=classifyObservedIp(verified.rules.at(-1).cidr.replace(/\.0\/24$/,'.23'),verified);
 if(observed.networkKind!=='vpn')throw Error('Largest synthetic CIDR was not matched');
 report('prefix-index-ready',{indexSeconds:
  +((performance.now()-lookupStart)/1000).toFixed(3)});
 const index={address:'/orbitdb/disposable-source-stress',
  publish:async()=>{throw Error('No stress fixture publication permitted');},
  loadInto:async()=>[],onUpdate:()=>()=>{}};
 const bridge=await createBrowserBridge({
  index,replica:new Replica(),host:'127.0.0.1',port:0,
  sourceObserver:{signer,feed:fixture.feed,feedIssuer:signer.author,
    provenance:fixture.provenance}
 });
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const requestedModules=new Set([
  '/v2/network/browser-mesh.js','/v2/network/source-feed-bundle.js',
  '/v2/network/source-provenance.js','/v2/network/source-feed.js',
  '/v2/network/source-receipt.js','/v2/core/events.js',
  '/v2/core/content-ratings.js'
 ]);
 const config=JSON.stringify({url:bridge.url,author:signer.author});
 const html='<!doctype html><meta charset="utf-8"><title>WEB9000 browser source stress</title>'+
  '<script type="module">'+
  'import {BrowserPeerMesh} from "/v2/network/browser-mesh.js";'+
  'const cfg='+config+';const start=performance.now();'+
  'window.benchmarkErrors=[];window.benchmarkComplete=null;'+
  'window.feedResult=null;window.provenanceReady=false;'+
  'const finish=()=>{if(window.feedResult&&window.provenanceReady)'+
  'window.benchmarkComplete={...window.feedResult,provenanceVerified:true,'+
  'seconds:(performance.now()-start)/1000,'+
  'heapUsedBytes:performance.memory?.usedJSHeapSize||null};};'+
  'const mesh=new BrowserPeerMesh({'+
  'onSourceFeed:feed=>{window.feedResult={rules:feed.rules.length,'+
  'revision:feed.revision,format:feed.format||"v1"};finish();},'+
  'onSourceProvenance:p=>{window.provenanceReady=p.sources.length===1;finish();},'+
  'onError:(url,e)=>window.benchmarkErrors.push(String(e))});'+
  'mesh.connect([cfg.url],{sourcePins:{[cfg.url]:cfg.author}});'+
  '</script>';
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html);return;
   }
   if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
   if(!requestedModules.has(req.url)){
    res.writeHead(404).end();return;
   }
   const filename=path.resolve(root,'.'+req.url);
   if(!filename.startsWith(root+path.sep))
    throw Error('Invalid test module path');
   const data=await readFile(filename);
   res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});
   res.end(data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  const binary=['/usr/bin/chromium','/usr/bin/google-chrome',
   '/usr/bin/chromium-browser'].find(executablePath=>existsSync(executablePath));
  if(!binary)throw Error('No real Chromium binary available');
  browser=await puppeteer.launch({
   executablePath:binary,headless:true,protocolTimeout:120000,
   userDataDir:'/tmp/w9-source-bench-chrome-profile',
   env:{...process.env,HOME:'/tmp',XDG_CONFIG_HOME:'/tmp/w9-config',
    XDG_CACHE_HOME:'/tmp/w9-cache'},
   args:['--no-sandbox','--disable-setuid-sandbox',
    '--disable-dev-shm-usage','--disable-gpu',
    '--disable-crash-reporter','--disable-breakpad',
    '--disable-background-networking','--disable-extensions',
    '--enable-precise-memory-info']
  });
  const page=await browser.newPage();
  const jsErrors=[];
  page.on('pageerror',e=>jsErrors.push('PAGE: '+e.message));
  page.on('console',msg=>{if(msg.type()==='error')
   jsErrors.push('CONSOLE: '+msg.text());});
  page.on('requestfailed',req=>jsErrors.push(
   'FAILED REQUEST: '+req.url()+' '+(req.failure()?.errorText||'')));
  page.on('response',res=>{if(res.status()>=400)jsErrors.push(
   'HTTP '+res.status()+' '+res.url());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/',{
   waitUntil:'domcontentloaded',timeout:15000});
  try{
   await page.waitForFunction(()=>Array.isArray(window.benchmarkErrors),{
    timeout:12000,polling:200});
  }catch(error){
   throw Error('Real browser did not load WEB9000 browser peer module: '+
    JSON.stringify({jsErrors,rootUrl:'http://127.0.0.1:'+server.address().port}));
  }
  report('browser-module-loaded',{});
  try{
   await page.waitForFunction(()=>window.benchmarkComplete&&
    typeof window.benchmarkComplete.rules==='number',{
     timeout:120000,polling:200
   });
  }catch(error){
   const probe=await page.evaluate(()=>({
    errors:window.benchmarkErrors,
    complete:window.benchmarkComplete
   })).catch(()=>null);
   throw Error('Browser did not finish signed manifest/chunks: '+
    JSON.stringify({jsErrors,probe}));
  }
  const result=await page.evaluate(()=>({
   ...window.benchmarkComplete,errors:window.benchmarkErrors
  }));
  const metrics=await page.metrics();
  if(result.rules!==verified.rules.length||result.errors.length||jsErrors.length)
   throw Error('Constrained browser did not verify entire signed dataset: '+
    JSON.stringify({result,jsErrors}));
  let cgroupPeak=null;
  try{cgroupPeak=Number((await readFile('/sys/fs/cgroup/memory.peak','utf8')).trim());}
  catch{}
  report('real-chromium-complete',{
   ...result,jsHeapMiB:miB(metrics.JSHeapUsedSize),
   performanceMemoryMiB:result.heapUsedBytes?miB(result.heapUsedBytes):null,
   cgroupPeakMiB:cgroupPeak?miB(cgroupPeak):null,
   chromeBinary:binary
  });
 }finally{
  await browser?.close();
  await bridge.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
