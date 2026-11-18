// Browser-level test of the original classic imageboard interaction model.
// Two unrelated web origins publish into one voluntary test peer.
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
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

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=await mkdtemp(path.join(os.tmpdir(),'w9-classic-'));
const servers=[];let browser,libp2p,helia,orbitdb,index,bridge;
function serve(){
 const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg'};
 const server=createServer(async(req,res)=>{
   const url=new URL(req.url,'http://local.invalid');
   const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   try{const bytes=await readFile(filename);res.writeHead(200,{'content-type':mime[path.extname(filename)]||'application/octet-stream'});res.end(bytes);}
   catch{res.writeHead(404).end();}
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{
   servers.push(server);resolve('http://127.0.0.1:'+server.address().port+'/v2/classic.html');
 }));
}
async function eventually(fn,name,timeout=25000){
 const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(120);}
 throw Error('Timeout: '+name);
}
async function ready(page){
 try{
   await page.waitForSelector('html[data-web9000-classic-ready="1"]',{timeout:15000});
 }catch(err){
   console.error('Classic readiness diagnostics',
     await page.evaluate(()=>({
       url:location.href,html:document.documentElement.outerHTML.slice(0,600),
       feed:document.querySelector('#feedStatus')?.textContent,
       entryScript:document.querySelector('script[type=module]')?.src
     })));
   throw err;
 }
}
async function connect(page,url){
 await page.evaluate(()=>document.getElementById('joinNetwork').click());
 await page.evaluate(()=>{document.getElementById('peerURLs').value='';});
 await page.type('#peerURLs',url);
 await page.evaluate(()=>document.getElementById('connectPeers').click());
 await eventually(()=>page.evaluate(()=>document.querySelector('#peerStatus')?.textContent.includes('1 peer(s)')),'connected browser peer',20000);
}
try{
 libp2p=await createLibp2p({addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
   services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}});
 helia=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(base,'blocks'))});
 orbitdb=await createOrbitDB({ipfs:helia,directory:path.join(base,'orbitdb')});
 index=await openPublicIndex(orbitdb,'web9000-classic-live-test');
 bridge=await createBrowserBridge({index,replica:new Replica(),port:0});
 const originA=await serve(),originB=await serve();
 const chromium=[process.env.CHROME_BIN,process.env.PUPPETEER_EXECUTABLE_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(x=>x&&existsSync(x));
 if(!chromium)throw Error('Browser not installed');
 browser=await puppeteer.launch({executablePath:chromium,headless:true,protocolTimeout:12000,args:['--no-sandbox','--disable-setuid-sandbox']});
 const errors=[];
 const a=await browser.newPage(),b=await browser.newPage();
 for(const [name,page] of [['a',a],['b',b]])page.on('pageerror',e=>errors.push(name+': '+e.message));
 await a.goto(originA,{waitUntil:'domcontentloaded'});await ready(a);
 console.log('CLASSIC checkpoint 1: initial page ready');
 assert.ok((await a.$$('.post')).length>=20,'original visual demo board');
 console.log('CLASSIC checkpoint 2: demo tile grid rendered');
 await a.focus('.post[data-index="0"]');await a.keyboard.press('ArrowRight');
 assert.equal(await a.evaluate(()=>document.activeElement.dataset.index),'1','arrow navigates image tiles');
 await a.keyboard.press('Enter');
 assert.equal(await a.$$('.post-container.expanded').then(x=>x.length),1,'expanded row under thumbnail');
 const layout=await a.evaluate(()=>{
   const grid=document.querySelector('#imageGrid').getBoundingClientRect();
   const panel=document.querySelector('.expanded-body').getBoundingClientRect();
   const image=document.querySelector('.expanded-body .attachments img').getBoundingClientRect();
   return {gridWidth:grid.width,bodyWidth:panel.width,imgWidth:image.width};
 });
 assert.ok(layout.bodyWidth>=layout.gridWidth*.7,
   'expanded post must have a usable full-row content area: '+JSON.stringify(layout));
 assert.ok(layout.imgWidth>=100,'demo image must render at a readable size');
 console.log('CLASSIC checkpoint 3: expanded row and keyboard passed');
 await a.evaluate(()=>document.querySelector('.post.selected').click());
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-container.expanded').length),0,
   'clicking the selected tile must collapse it');
 await a.evaluate(()=>document.querySelector('.post[data-index="1"]').click());
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-container.expanded').length),1);

 await a.keyboard.press('Escape');
 assert.equal(await a.$$('.post-container.expanded').then(x=>x.length),0);
 console.log('CLASSIC checkpoint 4: row collapsed');
 // Explicitly opt into the raw/unverified lane, including comments from
 // another independent identity. The public default remains filtered.
 await a.evaluate(()=>document.getElementById('showUnverified').click());
 await a.evaluate(()=>document.getElementById('postNew').click());
 await a.type('#composeTitle','My first actual cats post');
 await a.type('#composeText','This is real signed text, not placeholder debug output.');
 await a.type('#composeTags','cats, memes');
 await a.type('#composePollQuestion','Is this a cat?');
 await a.type('#composePollOptions','Yes\nNo');
 await a.evaluate(()=>{
   const input=document.querySelector('#composeStart');
   input.value='2030-04-05T15:30';
   input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await a.type('#composeLocation','A local meetup');
 console.log('CLASSIC checkpoint 5: composed native form');
 await a.evaluate(()=>document.getElementById('postForm').requestSubmit());
 await eventually(()=>a.evaluate(()=>[...document.querySelectorAll('.post-headline')].some(x=>x.textContent==='My first actual cats post')),'signed classic post rendered');
 console.log('CLASSIC checkpoint 6: signed local post visible');
 await connect(a,bridge.url);
 await eventually(()=>bridge.replica.list().some(x=>x.payload.body.title==='My first actual cats post'),'offline classic post delivery');
 console.log('CLASSIC checkpoint 7: offline post reached mirror');
 // Open the origin author's own post so incoming comments have a displayed
 // thread to appear in. The earlier test mistakenly inspected a closed row.
 await a.evaluate(()=>document.querySelector('.post[data-index="0"]').click());
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.comments-section').length),1);
 await b.goto(originB,{waitUntil:'domcontentloaded'});await ready(b);
 console.log('CLASSIC checkpoint 8: second browser ready');
 await b.evaluate(()=>document.getElementById('showUnverified').click());
 console.log('CLASSIC checkpoint 9: second browser opted into raw lane');
 await connect(b,bridge.url);
 await eventually(()=>b.evaluate(()=>[...document.querySelectorAll('.post-headline')].some(x=>x.textContent==='My first actual cats post')),'remote signed classic post rendered');
 console.log('CLASSIC checkpoint 10: second browser received real post');
 await b.evaluate(()=>document.querySelector('.post[data-index="0"]').click());
 assert.ok((await b.$$eval('.poll button',x=>x.length))>=2,'native poll UI');
 assert.ok((await b.$$eval('.schedule',x=>x.length))>=1,'native date UI');
 console.log('CLASSIC checkpoint 11: post details, poll and schedule visible');
 await b.type('.comment-form textarea','A separate, real signed comment');
 await b.evaluate(()=>document.querySelector('.comment-form button').click());
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='reply' &&
   e.payload.body.text==='A separate, real signed comment'),'remote comment accepted by peer');
 await eventually(()=>a.evaluate(()=>[...document.querySelectorAll('.comment-text')].some(x=>x.textContent==='A separate, real signed comment')),'remote signed comment rendered');
 console.log('CLASSIC checkpoint 12: signed comment received');
 await b.evaluate(()=>document.querySelector('.reactions button').click());
 await eventually(()=>bridge.replica.list().some(x=>x.payload.kind==='reaction'),'signed reaction through OrbitDB');
 console.log('CLASSIC checkpoint 13: signed reaction received');
 assert.deepEqual(errors,[]);
 const artifacts=path.join(path.dirname(fileURLToPath(import.meta.url)),'test-artifacts');
 await mkdir(artifacts,{recursive:true});
 await b.setViewport({width:1440,height:900});
 await b.evaluate(()=>scrollTo(0,0));await sleep(100);
 await b.screenshot({path:path.join(artifacts,'classic-desktop.png'),fullPage:true});
 await b.setViewport({width:390,height:844});
 await sleep(100);
 const overflow=await b.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 assert.ok(overflow<=2,'classic mobile layout has no horizontal overflow '+overflow);
 await b.evaluate(()=>scrollTo(0,0));
 await b.screenshot({path:path.join(artifacts,'classic-mobile.png'),fullPage:true});
 console.log('PASS classic seven-column board navigation, post composition, schedule, poll, comments, reactions and two-origin signed replication');
}finally{
 try{await browser?.close();}catch{}
 for(const server of servers)await new Promise(resolve=>server.close(resolve));
 try{await bridge?.close();}catch{}
 try{await index?.close();}catch{}
 try{await orbitdb?.stop();}catch{}
 try{await helia?.stop();}catch{}
 try{await libp2p?.stop();}catch{}
 await rm(base,{recursive:true,force:true});
}
