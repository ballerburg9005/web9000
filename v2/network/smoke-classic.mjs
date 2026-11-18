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
import {generateIdentity,signEvent} from '../core/events.js';
import {DEMO_CATALOG} from '../demo-catalog.js';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=await mkdtemp(path.join(os.tmpdir(),'w9-classic-'));
const servers=[];let browser,libp2p,helia,orbitdb,index,bridge,demoIdentity,demoCid,demoBytes;
function serve(){
 const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg'};
 const server=createServer(async(req,res)=>{
   const url=new URL(req.url,'http://local.invalid');
   if(url.pathname==='/v2/demo.json'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({version:1,space:'demo',author:demoIdentity.author}));
     return;
   }
   if(url.pathname==='/v2/peers.json'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({format:'web9000-peer-suggestions-v1',
       peers:[{name:'ephemeral independent test peer',url:bridge.url,
         mediaUrl:'http://'+req.headers.host+'/v2/media'}]}));
     return;
   }
   if(url.pathname==='/v2/media/ipfs/'+demoCid){
     res.writeHead(200,{'content-type':'image/jpeg','content-length':demoBytes.length});
     res.end(demoBytes);return;
   }
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
 demoIdentity=await generateIdentity();
 demoBytes=await readFile(path.join(root,'thumb','thumb01.jpg'));
 demoCid=CID.createV1(raw.code,await sha256.digest(demoBytes)).toString();
 for(const [i,spec] of DEMO_CATALOG.entries()){
   const fields={presentation:spec.type,tags:spec.tags,demo:true,
     ...(spec.poll?{poll:spec.poll}:{}),
     ...(spec.schedule?{schedule:spec.schedule}:{}),
     ...(spec.positions?{positions:spec.positions}:{}),
     ...(spec.price?{price:spec.price}:{}),
     ...(spec.video?{demoVideo:spec.video}:{})};
   const record=await signEvent(demoIdentity,{kind:'post',space:'demo',
     body:{title:spec.title,text:spec.text,fields,media:spec.noThumb?[]:['ipfs://'+demoCid]},
     time:Date.UTC(2026,10,17,12)-i*600000});
   await index.publish(record);
 }
 for(const name of ['Photography Circle','Commons Documentation Guild']){
   await index.publish(await signEvent(demoIdentity,{kind:'group',space:'groups',body:{
     name,description:'Experimental signed group for local community decisions',
     governance:'democracy',quorum:{numerator:50,denominator:100}
   }}));
 }
 bridge=await createBrowserBridge({index,replica:new Replica(),port:0});
 const originA=await serve(),originB=await serve();
 const chromium=[process.env.CHROME_BIN,process.env.PUPPETEER_EXECUTABLE_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(x=>x&&existsSync(x));
 if(!chromium)throw Error('Browser not installed');
 browser=await puppeteer.launch({executablePath:chromium,headless:true,protocolTimeout:12000,args:['--no-sandbox','--disable-setuid-sandbox']});
 const errors=[];
 const a=await browser.newPage(),b=await browser.newPage();
 for(const [name,page] of [['a',a],['b',b]])page.on('pageerror',e=>errors.push(name+': '+e.message));
 await a.goto(originA,{waitUntil:'domcontentloaded'});await ready(a);
 assert.equal(await a.$eval('#spaceName',e=>e.value),'demo','new sessions open the dedicated signed demo namespace');
 assert.equal(await a.$$eval('.post',e=>e.length),0,'no local fake fixture posts before a peer connects');
 await connect(a,bridge.url);
 await eventually(()=>a.evaluate(()=>document.querySelectorAll('.post').length===24),
   '24 signed seed posts replicated from independent OrbitDB peer');
 console.log('CLASSIC checkpoint 1: initial page ready and real database synced');
 assert.ok((await a.$$('.post')).length>=20,'original visual demo board');
 console.log('CLASSIC checkpoint 2: demo tile grid rendered');
 const kinds=await a.$$eval('.post-icons',els=>els.map(e=>e.textContent));
 for(const expected of ['Meetup','Poll','Jobs','Offer','Project','Text','Video'])
   assert.ok(kinds.some(value=>value.includes(expected)), 'missing sample content icon: '+expected);
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-small.demo-label').length),24);
 await a.evaluate(()=>document.querySelector('.post[data-index="2"]').click());
 assert.ok((await a.$$eval('.poll button',els=>els.length))>=3,'sample poll has choices');
 assert.ok((await a.$$eval('.reactions button',els=>els.length))>=5,'sample preview has voting and flagging bar');
 assert.ok((await a.$$eval('.comment-form textarea',els=>els.length))===1,'sample has comment form');
 const beforeScore=await a.$eval('.reactions .score',e=>Number(e.textContent));
 await a.evaluate(()=>document.querySelector('.reactions button').click());
 await eventually(()=>a.evaluate(before=>Number(document.querySelector('.reactions .score')?.textContent)===before+2,beforeScore), 'signed demo reaction applied');
 const afterScore=await a.$eval('.reactions .score',e=>Number(e.textContent));
 assert.equal(afterScore,beforeScore+2,'signed demonstration post can be voted on like real content');
 assert.equal(await a.evaluate(()=>document.querySelector('.post-container.expanded')!==null),true);
 await a.evaluate(()=>document.querySelector('.post.selected').click());
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-container.expanded').length),0);
 await a.evaluate(()=>document.getElementById('mockKarmaButton').click());
 assert.equal(await a.evaluate(()=>document.getElementById('mockDialog').open),true);
 await a.evaluate(()=>{
   document.getElementById('mockEnabled').click();
   document.getElementById('mockScore').value='42';
   document.getElementById('saveMockKarma').click();
 });
 await eventually(()=>a.evaluate(()=>document.querySelector('#mockRoster')?.textContent.includes('42/100')),
   'mock numerical key score stored');
 assert.equal(await a.evaluate(()=>document.querySelector('#mockModeLabel')?.hidden),false,
   'simulated reputation must always show a conspicuous test-mode label');
 await a.evaluate(()=>document.getElementById('closeMockDialog').click());

 await a.focus('.post[data-index="0"]');await a.keyboard.press('ArrowRight');
 assert.equal(await a.evaluate(()=>document.activeElement.dataset.index),'1','arrow navigates image tiles');
 await a.keyboard.press('Enter');
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-container.expanded').length),1,'expanded row under thumbnail');
 await eventually(()=>a.evaluate(()=>{
   const image=document.querySelector('.expanded-body .attachments img');
   return !!image && image.complete && image.naturalWidth>0 && image.getBoundingClientRect().width>=300;
 }),'expanded gallery image loads and is visually large',12000);
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
 assert.equal(await a.$$eval('.post-container.expanded',x=>x.length),0);
 console.log('CLASSIC checkpoint 4: row collapsed');
 await a.evaluate(()=>document.getElementById('clansButton').click());
 await eventually(()=>a.evaluate(()=>document.querySelectorAll('.group-entry').length>=2),
   'signed group charters listed in clans panel');
 await a.evaluate(()=>document.getElementById('closeClans').click());
 await a.focus('#searchPosts');
 assert.equal(await a.$eval('#searchPanel',e=>e.hidden),false,'search filters open on focus');
 assert.ok(await a.$$eval('.cloud-tag',x=>x.length)>=5,'tag cloud is derived from signed posts');
 await a.type('#searchPosts','cats');
 assert.ok((await a.$$eval('.post',x=>x.length))<24,'full-text search filters signed posts');
 await a.evaluate(()=>document.getElementById('resetSearch').click());
 await a.evaluate(()=>document.getElementById('closeSearch').click());
 await a.evaluate(()=>document.getElementById('disconnectPeers').click());
 await eventually(()=>a.evaluate(()=>document.getElementById('peerStatus').textContent.includes('0 peer(s)')),
   'disconnected for offline posting');
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
 await connect(b,bridge.url);
 await eventually(()=>bridge.replica.list().some(e=>e.payload.body.title==='My first actual cats post'),'second origin connected to raw peer');
 const publishedAuthor=bridge.replica.list().find(e=>e.payload.body.title==='My first actual cats post').payload.author;
 await b.evaluate(author=>{
   document.getElementById('mockKarmaButton').click();
   document.getElementById('mockIdentity').value=author;
   document.getElementById('mockScore').value='18';
   document.getElementById('saveMockKarma').click();
   document.getElementById('mockEnabled').click();
 },publishedAuthor);
 await eventually(()=>b.evaluate(()=>[...document.querySelectorAll('.post-headline')]
   .some(e=>e.textContent==='My first actual cats post')),'independent peer appears under mock key-score qualification');
 assert.equal(await b.evaluate(()=>document.getElementById('showUnverified').checked),false,
   'mock-score qualification must not secretly enable raw/unverified feed');
 await b.evaluate(()=>{
   document.getElementById('mockEnabled').click();
   document.getElementById('closeMockDialog').click();
 });
 await eventually(()=>b.evaluate(()=>![...document.querySelectorAll('.post-headline')]
   .some(e=>e.textContent==='My first actual cats post')),'mock mode disabled restores default unknown-author suppression');
 await b.evaluate(()=>document.getElementById('showUnverified').click());
 console.log('CLASSIC checkpoint 9: second browser opted into raw lane');
 await eventually(()=>b.evaluate(()=>[...document.querySelectorAll('.post-headline')].some(x=>x.textContent==='My first actual cats post')),'remote signed classic post rendered');
 console.log('CLASSIC checkpoint 10: second browser received real post');
 await b.evaluate(()=>document.querySelector('.post[data-index="0"]').click());
 assert.ok((await b.$$eval('.poll button',x=>x.length))>=2,'native poll UI');
 assert.ok((await b.$$eval('.schedule',x=>x.length))>=1,'native date UI');
 console.log('CLASSIC checkpoint 11: post details, poll and schedule visible');
 await b.type('.comment-form textarea','A separate, real signed comment',{delay:4});
 assert.equal(await b.$eval('.comment-form textarea',el=>el.value),'A separate, real signed comment',
   'incoming peer data must not destroy the focused comment draft');
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