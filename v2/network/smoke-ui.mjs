// Full browser smoke: two independent HTTP origins, real IndexedDB/Ed25519,
// one optional signed-record peer. Never uses the legacy browser's static state.
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {createOrbitDB} from '@orbitdb/core';
import {openPublicIndex} from './orbit-index.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {Replica} from '../core/replica.js';
import {verifyEvent} from '../core/events.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const directory=await mkdtemp(path.join(os.tmpdir(),'w9-browser-ui-'));
let browser,peer,index,helia,orbitdb,bridge;
const servers=[];
async function serveStatic(){
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4'};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      const pathname=decodeURIComponent(url.pathname==='/v2/'?'/v2/index.html':url.pathname);
      const filename=path.resolve(repo,'.'+pathname);
      if(!filename.startsWith(repo+path.sep)){res.writeHead(403).end();return;}
      const data=await readFile(filename);
      res.writeHead(200,{'content-type':mime[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'});
      res.end(data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  servers.push(server);return 'http://127.0.0.1:'+server.address().port+'/v2/';
}
async function eventually(test,label,ms=25000){
  const until=Date.now()+ms;
  while(Date.now()<until){
    if(await test())return;
    await sleep(150);
  }
  throw Error('Timed out: '+label);
}
async function ready(page){
  await page.waitForFunction(()=>document.querySelector('#identityKey')?.textContent.startsWith('ed25519:'),{timeout:20000});
}
async function createPost(page,title,body,media=''){
  await page.click('#composeButton');
  await page.type('#postTitle',title);
  await page.type('#postText',body);
  if(media)await page.type('#postMedia',media);
  await page.click('#composeForm button[type="submit"]');
  await page.waitForFunction(title=>[...document.querySelectorAll('#feed h3')].some(x=>x.textContent===title),{timeout:15000},title);
}
async function connect(page,url){
  await page.click('#managePeers');
  await page.type('#networkEndpoints',url);
  await page.click('#connectPeers');
  await page.waitForFunction(()=>document.querySelector('#statPeers')?.textContent==='1',{timeout:15000});
}
try{
  const libp2p=peer=await createLibp2p({
    addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  helia=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(directory,'blocks'))});
  orbitdb=await createOrbitDB({ipfs:helia,directory:path.join(directory,'orbitdb')});
  index=await openPublicIndex(orbitdb,'web9000-real-browser-integration');
  bridge=await createBrowserBridge({index,replica:new Replica(),port:0});
  const firstOrigin=await serveStatic(),secondOrigin=await serveStatic();
  const pathCandidates=[
    process.env.CHROME_BIN,process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'
  ];
  const executablePath=pathCandidates.find(x=>x&&existsSync(x));
  if(!executablePath)throw Error('No Chromium/Chrome executable on CI runner');
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const errors=[];
  const first=await browser.newPage();first.on('pageerror',e=>errors.push('origin1: '+e.message));
  await first.goto(firstOrigin,{waitUntil:'domcontentloaded'});await ready(first);
  const titleA='Local publication survives and reaches an independent peer';
  await createPost(first,titleA,'A signed record that is created while the peer is disconnected.');
  await connect(first,bridge.url);
  await eventually(()=>bridge.replica.list().some(x=>x.payload.body?.title===titleA),'offline outbox arrival');
  const saved=bridge.replica.list().find(x=>x.payload.body?.title===titleA);
  assert.equal(await verifyEvent(saved),true);

  const second=await browser.newPage();second.on('pageerror',e=>errors.push('origin2: '+e.message));
  await second.goto(secondOrigin,{waitUntil:'domcontentloaded'});await ready(second);
  const id1=await first.$eval('#identityKey',x=>x.textContent);
  const id2=await second.$eval('#identityKey',x=>x.textContent);
  assert.notEqual(id1,id2,'browser origins must have independent storage/identities');
  await connect(second,bridge.url);
  await second.waitForFunction(title=>[...document.querySelectorAll('#feed h3')].some(x=>x.textContent===title),{timeout:15000},titleA);

  const titleB='Signed IPFS reference from another website origin';
  const cid='ipfs://bafybeigdyrzt3cu5z4z4bz3hyjipfxzabfqb4zl3nkrhuxuu7pn7efq3aa';
  await createPost(second,titleB,'An independently authored metadata-only image listing.',cid);
  await first.waitForFunction(title=>[...document.querySelectorAll('#feed h3')].some(x=>x.textContent===title),{timeout:15000},titleB);
  assert.ok((await first.$$eval('.media-count', els=>els.map(e=>e.textContent))).some(s=>s.includes('IPFS')));
  assert.deepEqual(errors,[],'browser page errors');

  console.log('PASS two distinct browser origins publish, sync, store, sign and render records over replaceable peers');
}finally{
  try{await browser?.close();}catch(e){console.error('browser cleanup',e);}
  for(const server of servers)await new Promise(resolve=>server.close(resolve));
  try{await bridge?.close();}catch(e){console.error('bridge cleanup',e);}
  try{await index?.close();}catch(e){console.error('index cleanup',e);}
  try{await orbitdb?.stop();}catch(e){console.error('orbitdb cleanup',e);}
  try{await helia?.stop();}catch(e){console.error('helia cleanup',e);}
  try{await peer?.stop();}catch{}
  await rm(directory,{recursive:true,force:true});
}
