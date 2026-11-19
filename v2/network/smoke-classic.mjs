// Browser-level test of the original classic imageboard interaction model.
// Two unrelated web origins publish into one voluntary test peer.
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
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
import {createImageGateway} from './media-node.mjs';
import {Replica} from '../core/replica.js';
import {generateIdentity,signEvent} from '../core/events.js';
import {createGroupProof,verifyGroupProof} from '../core/group-proof.js';
import {DEMO_CATALOG} from '../demo-catalog.js';
import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=await mkdtemp(path.join(os.tmpdir(),'w9-classic-'));
const servers=[];
let browser,libp2p,helia,orbitdb,index,bridge,mediaGateway,demoIdentity,demoCid,demoBytes;
function serve({firstPartyMedia=false,externalMediaClaim=false}={}){
 const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript',
   '.jpg':'image/jpeg','.mp4':'video/mp4','.mp3':'audio/mpeg'};
 const server=createServer(async(req,res)=>{
   const url=new URL(req.url,'http://local.invalid');
   if(url.pathname==='/v2/demo.json'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({version:1,space:'demo',author:demoIdentity.author,
       ...(firstPartyMedia?{
         autoConnectSameOrigin:true,
         galleryPeer:'http://127.0.0.1:'+server.address().port+'/v2/media/'
       }:{}),
       ...(externalMediaClaim?{
         autoConnectSameOrigin:true,
         galleryPeer:'http://127.0.0.1:'+mediaGateway.port+'/'
       }:{})
     }));
     return;
   }
   if(url.pathname==='/v2/peers.json'){
     res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({format:'web9000-peer-suggestions-v1',
       peers:[{name:'ephemeral independent test peer',url:bridge.url,
         mediaUrl:'http://127.0.0.1:'+mediaGateway.port}]}));
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
 mediaGateway=await createImageGateway({ipfs:helia,port:0,host:'127.0.0.1',
   manifestFile:path.join(base,'media-manifest.json'),uploadEnabled:true,
   richMediaEnabled:true,maxTotal:30*1024*1024});
 const fixture=await fetch('http://127.0.0.1:'+mediaGateway.port+'/upload',
   {method:'POST',headers:{'content-type':'image/jpeg'},body:demoBytes});
 assert.equal(fixture.status,201,'actual media peer retains the original test-image CID');
 assert.equal((await fixture.json()).cid,'ipfs://'+demoCid);
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
 await a.evaluate(()=>{
   document.querySelector('#debugConsoleButton').click();
   document.querySelector('#debugSource').value='system';
   document.querySelector('#debugSource').dispatchEvent(new Event('change'));
 });
 await a.waitForFunction(()=>document.querySelector('#debugEntries')?.textContent.includes('ipfs-media'));
 const mediaBeforeConsent=await a.evaluate(()=>{
   const entries=[...document.querySelectorAll('#debugEntries .debug-record')];
   entries.find(b=>b.textContent.includes('ipfs-media')).click();
   return JSON.parse(document.querySelector('#debugRaw').textContent);
 });
 assert.equal(mediaBeforeConsent.preferredGateway,null,
   'peer suggestion must NOT silently approve media-download gateway');
 assert.equal(mediaBeforeConsent.voluntarilyApprovedBackups.length,0);
 assert.ok(await a.$eval('#mediaPeerUrl',e=>e.value.length>0),
   'site may present media peer as an unapproved form suggestion');
 await a.evaluate(()=>document.querySelector('#closeDebug').click());
 // Migrate legacy persisted media URLs. Older releases saved form
 // suggestions as approved preferences, with no evidence of consent.
 const legacyMediaURL=await a.$eval('#mediaPeerUrl',el=>el.value);
 await a.evaluate(async url=>{
   const {openLocal,setItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{
     await setItem(db,'classic-media-url',url);
     await setItem(db,'classic-media-approved-v1',false);
   }finally{db.close();}
 },legacyMediaURL);
 await a.reload({waitUntil:'domcontentloaded'});await ready(a);
 await a.evaluate(()=>{
   document.querySelector('#debugConsoleButton').click();
   document.querySelector('#debugSource').value='system';
   document.querySelector('#debugSource').dispatchEvent(new Event('change'));
   [...document.querySelectorAll('#debugEntries .debug-record')]
     .find(b=>b.textContent.includes('ipfs-media')).click();
 });
 const migratedPolicy=await a.$eval('#debugRaw',el=>JSON.parse(el.textContent));
 assert.equal(migratedPolicy.preferredGateway,null,
   'legacy stored suggestions must not be treated as approved media hosts');
 assert.equal(migratedPolicy.mediaApprovalRecorded,false);
 assert.equal(await a.$eval('#mediaPeerUrl',el=>el.value),legacyMediaURL,
   'old gateway URL remains visible for explicit reader review');
 await a.evaluate(()=>document.querySelector('#closeDebug').click());
 // Any state persistence before consent must save a pending URL WITHOUT
 // resurrecting it as a media source or losing the visible review option.
 // Do NOT toggle the raw lane: later integration steps intentionally enable
 // it to admit an unfamiliar author's comments.
 await a.evaluate(()=>document.querySelector('#viewStyle').dispatchEvent(
   new Event('change',{bubbles:true})));
 await eventually(()=>a.evaluate(async expected=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return (await getItem(db,'classic-media-pending-url'))===expected;}
   finally{db.close();}
 },legacyMediaURL),'pending gateway persisted after unrelated preferences change');
 await a.reload({waitUntil:'domcontentloaded'});await ready(a);
 assert.equal(await a.$eval('#mediaPeerUrl',el=>el.value),legacyMediaURL,
   'pending legacy URL survives unrelated store() and a second reload');
 await a.evaluate(()=>{
   document.querySelector('#debugConsoleButton').click();
   document.querySelector('#debugSource').value='system';
   document.querySelector('#debugSource').dispatchEvent(new Event('change'));
   [...document.querySelectorAll('#debugEntries .debug-record')]
     .find(b=>b.textContent.includes('ipfs-media')).click();
 });
 const afterPendingWrite=await a.$eval('#debugRaw',el=>JSON.parse(el.textContent));
 assert.equal(afterPendingWrite.preferredGateway,null,
   'unapproved URL remains inactive even after other preference writes');
 await a.evaluate(()=>document.querySelector('#closeDebug').click());
 await connect(a,bridge.url);
 await a.evaluate(()=>{
   document.querySelector('#debugConsoleButton').click();
   document.querySelector('#debugSource').value='system';
   document.querySelector('#debugSource').dispatchEvent(new Event('change'));
   [...document.querySelectorAll('#debugEntries .debug-record')]
     .find(b=>b.textContent.includes('ipfs-media')).click();
 });
 const connectedPolicy=await a.$eval('#debugRaw',el=>JSON.parse(el.textContent));
 assert.equal(connectedPolicy.preferredGateway,legacyMediaURL,
   'Connect action must explicitly approve selected gateway');
 assert.equal(connectedPolicy.mediaApprovalRecorded,true);
 await a.evaluate(()=>document.querySelector('#closeDebug').click());
 await eventually(()=>a.evaluate(()=>document.querySelectorAll('.post').length===24),
   '24 signed seed posts replicated from independent OrbitDB peer');
 console.log('CLASSIC checkpoint 1: initial page ready and real database synced');
 assert.ok((await a.$$('.post')).length>=20,'original visual demo board');
 console.log('CLASSIC checkpoint 2: demo tile grid rendered');
 const kinds=await a.$$eval('.post-icons',els=>els.map(e=>e.textContent));
 for(const expected of ['Meetup','Poll','Jobs','Offer','Project'])
   assert.ok(kinds.some(value=>value.includes(expected)), 'missing sample content icon: '+expected);
 assert.equal(await a.evaluate(()=>document.querySelectorAll('.post-small.demo-label').length),24);
 assert.equal(await a.evaluate(()=>[...document.querySelectorAll('.post-icons')]
   .some(e=>/(^| · )(▣ Image|☰ Text|▶ Video|♪ Sound)/.test(e.textContent))),false,
   'obvious media-type labels are CSS/JS-hidden; only useful metadata gets badges');
 await a.evaluate(()=>document.getElementById('showSearchOptions').click());
 const excludes=await a.evaluate(()=>[...document.querySelectorAll('.search-excludes input')].map(x=>({
   width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height,
   label:x.parentElement.getBoundingClientRect().width
 })));
 assert.equal(excludes.length,8);
 assert.ok(excludes.every(x=>x.width<=18&&x.height<=18&&x.label>x.width+15),
   'type filters must have real tiny checkboxes instead of giant text inputs '+JSON.stringify(excludes));
 await a.evaluate(()=>document.getElementById('closeSearch').click());
 await a.evaluate(()=>{
   document.getElementById('viewStyle').value='blog';
   document.getElementById('viewStyle').dispatchEvent(new Event('change',{bubbles:true}));
 });
 await eventually(()=>a.evaluate(()=>document.querySelector('#imageGrid')?.classList.contains('blog')),
   'blog grid change committed');
 const blogGeometry=await a.evaluate(()=>{
   const tile=document.querySelector('.post'),heading=tile.querySelector('.post-headline').getBoundingClientRect();
   const preview=tile.querySelector('.post-description'),rect=preview.getBoundingClientRect();
   return {copyW:rect.width,display:getComputedStyle(preview).display,headingTop:heading.top,
     previewTop:rect.top,postTop:tile.getBoundingClientRect().top};
 });
 assert.ok(blogGeometry.copyW>=180&&blogGeometry.display!=='none'&&
   blogGeometry.headingTop-blogGeometry.postTop<=22 &&
   blogGeometry.previewTop>blogGeometry.headingTop,
   'blog view needs a generous readable right-side text description '+JSON.stringify(blogGeometry));
 await a.evaluate(()=>{
   document.getElementById('viewStyle').value='grid';
   document.getElementById('viewStyle').dispatchEvent(new Event('change',{bubbles:true}));
 });

 await eventually(()=>a.evaluate(()=>document.querySelector('#imageGrid')?.classList.contains('grid')&&
   !document.querySelector('#imageGrid')?.classList.contains('blog')), 'classic grid view restored');
 await a.evaluate(()=>document.querySelector('.post[data-index="2"]').click());
 assert.ok((await a.$$eval('.poll button',els=>els.length))>=3,'sample poll has choices');
 assert.ok((await a.$$eval('.reactions button',els=>els.length))>=5,'sample preview has voting and flagging bar');
 assert.ok((await a.$$eval('.comment-form textarea',els=>els.length))===1,'sample has comment form');
 const beforeScore=await a.$eval('.reactions .score',e=>Number(e.textContent));
 await a.evaluate(()=>document.querySelector('.reactions .vote-max').click());
 await eventually(()=>a.evaluate(before=>Number(document.querySelector('.reactions .score')?.textContent)===before+2,beforeScore), 'signed demo reaction applied');
 assert.equal(await a.evaluate(()=>document.querySelector('.reactions .vote-max')?.classList.contains('selected')),true,
   'the selected vote has persistent highlighted styling');
 assert.equal(await a.evaluate(()=>document.querySelector('.reactions .vote-max')?.getAttribute('aria-pressed')),'true');
 const afterScore=await a.$eval('.reactions .score',e=>Number(e.textContent));
 assert.equal(afterScore,beforeScore+2,'signed demonstration post can be voted on like real content');
 assert.equal(await a.evaluate(()=>document.querySelector('.post-container.expanded')!==null),true);
 assert.equal(await a.evaluate(()=>!!document.querySelector('.detail-close')),false,
   'the redundant Close button must be absent; selected tile and Escape close details');
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
 const mediaOrder=await a.evaluate(()=>{
   const body=document.querySelector('.expanded-body');
   return [...body.children].map(x=>x.className);
 });
 assert.equal(mediaOrder[0],'post-main-media',
   'primary image/video/audio must appear above post title and metadata');
 assert.equal(mediaOrder[1],'post-detail-heading');
 assert.ok(mediaOrder.indexOf('reactions')>mediaOrder.indexOf('details-line'));
 assert.ok(mediaOrder.indexOf('label-row')>mediaOrder.indexOf('reactions'));
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
 await a.setViewport({width:1440,height:520});
 await a.evaluate(()=>document.querySelector('.post[data-index="15"]').click());
 const openedScroll=await a.evaluate(()=>{
   const tile=document.querySelector('.post.selected').getBoundingClientRect();
   const top=document.getElementById('topHeader').getBoundingClientRect().height+5;
   return {top:tile.top,expected:top};
 });
 assert.ok(Math.abs(openedScroll.top-openedScroll.expected)<=17,
   'opening a post must anchor its grid row under sticky header: '+JSON.stringify(openedScroll));
 await a.evaluate(()=>document.querySelector('.post.selected').click());
 const closedScroll=await a.evaluate(()=>{
   const tile=document.querySelector('.post[data-index="15"]').getBoundingClientRect();
   return {top:tile.top,expected:document.getElementById('topHeader').getBoundingClientRect().height+5};
 });
 assert.ok(Math.abs(closedScroll.top-closedScroll.expected)<=17,
   'closing a post must preserve current grid row, not jump to page top: '+JSON.stringify(closedScroll));
 await a.evaluate(()=>document.querySelector('.post[data-index="14"]').click());
 await a.evaluate(()=>document.querySelector('.post.selected').focus({preventScroll:true}));
 await a.keyboard.press('ArrowRight');
 const navigatedScroll=await a.evaluate(()=>{
   const tile=document.querySelector('.post.selected').getBoundingClientRect();
   return {index:document.querySelector('.post.selected').dataset.index,
     top:tile.top,expected:document.getElementById('topHeader').getBoundingClientRect().height+5};
 });
 assert.equal(navigatedScroll.index,'15');
 assert.ok(Math.abs(navigatedScroll.top-navigatedScroll.expected)<=17,
   'arrow navigation must align selected grid row: '+JSON.stringify(navigatedScroll));
 await a.keyboard.press('Escape');
 // With more than half the selected row already in view, do not force it
 // to the top or jump the page. Only recover a row that is largely clipped.
 await a.evaluate(()=>{
   document.querySelector('.post[data-index="15"]').click();
   window.scrollTo({top:Math.max(0,window.scrollY-62),behavior:'instant'});
 });
 const previous=await a.evaluate(()=>window.scrollY);
 await a.evaluate(()=>document.querySelector('.post.selected')?.click());
 const retained=await a.evaluate(()=>window.scrollY);
 assert.ok(Math.abs(previous-retained)<=3,
   'closing a post with a mostly visible row should preserve scroll: '+
     JSON.stringify({previous,retained}));
 await a.evaluate(()=>{
   document.querySelector('.post[data-index="15"]').click();
   window.scrollBy({top:240,behavior:'instant'});
 });
 const visibility=await a.evaluate(()=>{
   const r=document.querySelector('.post.selected').getBoundingClientRect();
   return {top:r.top,bottom:r.bottom,header:document.getElementById('topHeader').getBoundingClientRect().bottom};
 });
 assert.ok(visibility.bottom<=visibility.header+20,
   'test scroll should genuinely hide the selected grid row '+JSON.stringify(visibility));
 await a.evaluate(()=>document.querySelector('.post.selected')?.click());
 const realigned=await a.evaluate(()=>{
   const r=document.querySelector('.post[data-index="15"]').getBoundingClientRect();
   return {top:r.top,header:document.getElementById('topHeader').getBoundingClientRect().bottom+5};
 });
 assert.ok(Math.abs(realigned.top-realigned.header)<=18,
   'only a clipped row is realigned on close '+JSON.stringify(realigned));
 await a.setViewport({width:1440,height:900});
 console.log('CLASSIC checkpoint 4a: conditional row scroll preservation, clipping and arrow navigation');

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
 assert.equal(await a.evaluate(()=>document.querySelector('#composePreviewDialog').open),true,
   'post composer must show preview before signing');
 assert.equal(await a.evaluate(()=>document.getElementById('confirmPublishPost').disabled),true,
   'publication blocked until explicit permanence acknowledgement');
 await a.evaluate(()=>document.getElementById('composePermanentAck').click());
 assert.equal(await a.evaluate(()=>document.getElementById('confirmPublishPost').disabled),false);
 await a.evaluate(()=>document.getElementById('confirmPublishPost').click());
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
 const replyFocusScroll=await b.evaluate(()=>{
   const before=window.scrollY;
   document.querySelector('.comments-section > .comment-form textarea').focus({preventScroll:true});
   return {before,after:window.scrollY};
 });
 assert.equal(replyFocusScroll.after,replyFocusScroll.before,
   'focusing to write a comment must not trigger any application-driven scroll');
 await b.type('.comment-form textarea','A separate, real signed comment',{delay:4});
 assert.equal(await b.$eval('.comment-form textarea',el=>el.value),'A separate, real signed comment',
   'incoming peer data must not destroy the focused comment draft');
 await b.evaluate(()=>document.querySelector('.comment-form button').click());
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='reply' &&
   e.payload.body.text==='A separate, real signed comment'),'remote comment accepted by peer');
 try{
   await eventually(()=>a.evaluate(()=>[...document.querySelectorAll('.comment-text')].some(x=>x.textContent==='A separate, real signed comment')),'remote signed comment rendered');
 }catch(error){
   const diag=await a.evaluate(async()=>{
     const {openLocal,getItem}=await import('./core/persist.js');
     const db=await openLocal();
     const local=(await getItem(db,'records'))||[];
     db.close();
     return {
       signedReplyInLocalStorage:local.some(e=>e.payload.kind==='reply'&&
         e.payload.body.text==='A separate, real signed comment'),
       localSignedRecords:local.length,
       selectedPost:document.querySelector('.post.selected')?.dataset.id,
       expandedPanel:!!document.querySelector('.post-container.expanded'),
       renderedReplies:[...document.querySelectorAll('.comment-text')].map(e=>e.textContent.slice(0,80)),
       peerStatus:document.querySelector('#peerStatus')?.textContent,
       documentFocus:document.activeElement?.outerHTML?.slice(0,300),
       commentThreadKey:document.querySelector('.comments-section')?.dataset.threadsKey
     };
   });
   console.error('REMOTE COMMENT DELIVERY/RENDER DIAGNOSTICS',JSON.stringify(diag));
   throw error;
 }
 console.log('CLASSIC checkpoint 12: signed comment received');
 const reactionScrollBefore=await b.evaluate(()=>window.scrollY);
 await b.evaluate(()=>document.querySelector('.reactions .vote-max').click());
 await eventually(()=>bridge.replica.list().some(x=>x.payload.kind==='reaction'),'signed reaction through OrbitDB');
 const reactionScrollAfter=await b.evaluate(()=>window.scrollY);
 assert.ok(Math.abs(reactionScrollAfter-reactionScrollBefore)<=3,
   'clicking a signed reaction must not scroll the page: '+
     JSON.stringify({reactionScrollBefore,reactionScrollAfter}));
 console.log('CLASSIC checkpoint 13: signed reaction received without scrolling');

 // Personal social labeling never changes remote record authorship,
 // grants raw-lane admission or publishes a public relationship.
 assert.equal(await b.$eval('.reactions .social-relation-action[data-social-relation="friend"]',
   el=>el.textContent),'Add friend');
 assert.equal(await b.$eval('.reactions .social-relation-action[data-social-relation="foe"]',
   el=>el.textContent),'Add foe');
 await b.evaluate(()=>document.querySelector('.reactions .social-relation-action[data-social-relation="friend"]').click());
 await eventually(()=>b.$eval('.reactions .social-relation-action[data-social-relation="friend"]',
   el=>el.textContent==='Remove friend'),'local friend label applied before asserting');
 await b.evaluate(()=>document.querySelector('.reactions .social-relation-action[data-social-relation="foe"]').click());
 await eventually(()=>b.$eval('.reactions .social-relation-action[data-social-relation="foe"]',
   el=>el.textContent==='Remove foe'),'local foe label applied before asserting');
 assert.equal(await b.$eval('.reactions .social-relation-action[data-social-relation="friend"]',
   el=>el.textContent),'Add friend','friend and foe must be mutually exclusive');
 await b.evaluate(()=>document.querySelector('.reactions .social-relation-action[data-social-relation="foe"]').click());
 await eventually(()=>b.$eval('.reactions .social-relation-action[data-social-relation="foe"]',
   el=>el.textContent==='Add foe'),'local foe label removed before asserting');
 assert.equal(bridge.replica.list().filter(e=>e.payload.kind==='endorse').length,0,
   'local friend/foe preferences must not leak a public social graph');

 // Raw inspection has NO inline post controls. The only entry point is
 // the top-right Debug menu and all dump actions happen inside that console.
 assert.equal(await b.$$eval('.reactions button',items=>
   items.filter(e=>/Dump post|Dump comments|Copy signed record|Trust author/.test(e.textContent)).length),0);
 assert.equal(await b.$eval('.classic-toolbar',e=>e.querySelector('#debugConsoleButton')),null);
 assert.ok(await b.$eval('#topHeader',e=>e.querySelector('#debugConsoleButton')));
 await b.click('#debugConsoleButton');
 assert.equal(await b.$eval('#debugDialog',el=>el.open),true);
 assert.equal(await b.$eval('#debugSource',el=>el.value),'network');
 const history=await b.$eval('#debugEntries .debug-record',el=>el.textContent);
 assert.match(history,/batch|subscribe|hello|event|ack|sync|publish/i,
   'top-right debug immediately displays buffered traffic from before it opened');
 const selectedDump=await b.$eval('.post.selected',el=>el.dataset.id);
 await b.$eval('#debugPostPick',(el,id)=>{el.value=id;el.dispatchEvent(new Event('change'));},selectedDump);
 await b.click('#debugDumpPost');
 assert.equal(await b.$eval('#debugSource',el=>el.value),'dump');
 assert.ok((await b.$eval('#debugRaw',el=>el.textContent)).includes('"signature"'),
   'console post dump must contain full signed event envelope');
 await b.evaluate(()=>{
   document.getElementById('debugKind').value='post';
   document.getElementById('debugKind').dispatchEvent(new Event('input'));
 });
 assert.ok(await b.$$eval('#debugEntries .debug-record',items=>items.length)>=1);
 await b.click('#debugDumpComments');
 assert.equal(await b.$eval('#debugSource',el=>el.value),'dump');
 assert.ok((await b.$eval('#debugRaw',el=>el.textContent))
   .includes('A separate, real signed comment'),'console comment dump exposes the signed discussion tree');
 await b.evaluate(()=>{
   document.getElementById('debugSource').value='network';
   document.getElementById('debugSource').dispatchEvent(new Event('change'));
 });
 assert.ok((await b.$eval('#debugEntries',el=>el.textContent)).includes('batch')||
    (await b.$eval('#debugEntries',el=>el.textContent)).includes('subscribe'),
   'network packet trace should show real WebSocket traffic');
 await b.evaluate(()=>{
   document.getElementById('debugSource').value='social';
   document.getElementById('debugSource').dispatchEvent(new Event('change'));
 });
 assert.ok((await b.$eval('#debugRaw',el=>el.textContent)).includes('origin')||
   (await b.$eval('#debugStatus',el=>el.textContent)).includes('Friend/foe'));
 await b.evaluate(()=>{
   document.getElementById('debugSource').value='system';
   document.getElementById('debugSource').dispatchEvent(new Event('change'));
 });
 assert.ok((await b.$eval('#debugRaw',el=>el.textContent))
   .includes('verifiedRecords'),'system diagnostics inspect local signed event inventory');
 assert.ok((await b.$eval('#debugEntries',el=>el.textContent))
   .includes('ipfs-media'),'system diagnostics expose selected independent media peer');
 await b.click('#closeDebug');
 assert.deepEqual(errors,[]);
 console.log('CLASSIC checkpoint 13a: friend/foe local preferences, raw post/comment dumps, filters and network packet debug console');
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
 // Deliberately close the stable expanded discussion before displaying new
 // feed items. Network updates must never detach active comment editors.
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 // One independent record may refer to a whole image gallery. Navigation
 // changes only the selected attachment and never requires raw-CID input.
 const galleryRecord=await signEvent(demoIdentity,{
   kind:'post',space:'demo',
   body:{title:'Multi-image signed gallery test',text:'Two signed CID references.',
     fields:{presentation:'image',tags:['gallery'],primaryMediaIndex:1},
     media:['ipfs://'+demoCid,'ipfs://'+demoCid]}
 });
 await index.publish(galleryRecord);
 await eventually(()=>b.evaluate(id=>
   !!document.querySelector('.post[data-id="'+id+'"]'),galleryRecord.id),
   'independent gallery record displayed');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),galleryRecord.id);
 assert.equal(await b.$$eval('.gallery-thumb',items=>items.length),2,
   'two CID references should produce gallery navigation thumbnails');
 assert.equal(await b.$eval('.gallery-count',el=>el.textContent),'2 / 2',
   'explicit signed primary media selection wins over first-attachment fallback');
 await b.evaluate(()=>document.querySelector('.gallery-next').click());
 assert.equal(await b.$eval('.gallery-count',el=>el.textContent),'1 / 2');
 await b.evaluate(()=>document.querySelector('.gallery-prev').click());
 assert.equal(await b.$eval('.gallery-count',el=>el.textContent),'2 / 2');
 console.log('CLASSIC checkpoint 14: real multi-image gallery navigation');

 // Discovery claims are metadata only. The reader explicitly adds this
 // volunteer peer, and a broken preferred gateway falls back to the
 // approved independent mirror. No unknown hostname is contacted.
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 const signedProvider=await signEvent(demoIdentity,{kind:'media-provider',
  space:'media-providers',body:{
   gateway:'http://127.0.0.1:'+mediaGateway.port,
   cids:['ipfs://'+demoCid],action:'offer',expiresAt:Date.now()+86400000
  }});
 await index.publish(signedProvider);
 await eventually(()=>b.evaluate(()=>{
   document.getElementById('joinNetwork').click();
   const listed=document.getElementById('mediaProviderSuggestions')
    .textContent.includes('CID claim');
   document.getElementById('closeNetwork').click();
   return listed;
 }), 'signed voluntary provider hint visible without automatically using it');
 await b.evaluate(()=>{
   document.getElementById('joinNetwork').click();
   document.querySelector('#mediaProviderSuggestions button').click();
   document.getElementById('mediaPeerUrl').value='http://127.0.0.1:1';
   document.getElementById('connectPeers').click();
 });
 await eventually(()=>b.evaluate((id,port)=>{
   const img=document.querySelector('.post[data-id="'+id+'"] img.post-thumb');
   return img?.naturalWidth>0&&img.src.startsWith('http://127.0.0.1:'+port+'/ipfs/');
 },galleryRecord.id,mediaGateway.port),
 'browser recovers signed CID image from explicitly approved backup gateway',16000);
 await b.evaluate(port=>{
   document.getElementById('joinNetwork').click();
   document.getElementById('mediaPeerUrl').value='http://127.0.0.1:'+port;
   document.getElementById('mediaMirrorURLs').value='';
   document.getElementById('connectPeers').click();
 },mediaGateway.port);
 console.log('CLASSIC checkpoint 14a: signed provider hints and approved-CID fallback');


 // The compact Clans panel must actually publish a signed founding charter.
 await b.evaluate(()=>{
   document.getElementById('clansButton').click();
   document.getElementById('createGroupDetails').open=true;
   document.getElementById('groupName').value='Chromium test cooperative';
   document.getElementById('groupDescription').value='Test signed charter from a web browser';
   document.getElementById('groupRecommendedSpaces').value='demo, cats, makerspace';
   document.getElementById('createGroupForm').requestSubmit();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='group'&&
    e.payload.body.name==='Chromium test cooperative'),'new signed group charter reaches raw peer');
 await eventually(()=>b.evaluate(()=>document.querySelector('#groupList')?.textContent.includes('Chromium test cooperative')),
    'new voluntary group appears in its creator UI');
 const groupRecord=bridge.replica.list().find(e=>e.payload.kind==='group'&&
   e.payload.body.name==='Chromium test cooperative');
 assert.equal(groupRecord.payload.body.decisionPolicy?.mode,'timed-v1',
   'new groups explicitly choose versioned timed governance, not mutable server settings');
 await b.evaluate(()=>{
   const section=[...document.querySelectorAll('.group-entry')].find(el=>
     el.querySelector('.group-heading strong')?.textContent==='Chromium test cooperative');
   const edit=section.querySelector('.group-edit');edit.open=true;
   const fields=edit.querySelectorAll('input,textarea');
   fields[0].value='Cooperative approved by signer';
   fields[1].value='Signed members decide this description';
   fields[2].value='demo, cats, makerspace, verified-space';
   edit.querySelector('form').requestSubmit();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='proposal'&&
   e.payload.body.group===groupRecord.id&&
   e.payload.body.change.type==='set-group-info'),'signed group-info amendment reaches OrbitDB');
 await eventually(()=>b.evaluate(()=>
   document.querySelector('#groupList')?.textContent.includes('Cooperative approved by signer')),
   'signed quorum-backed group info reaches the real browser',18000);
 await eventually(async()=>{
   const events=bridge.replica.list();
   const update=events.find(e=>e.payload.kind==='proposal'&&
     e.payload.body.group===groupRecord.id&&e.payload.body.change.type==='set-group-info');
   return !!update&&events.some(e=>e.payload.kind==='vote'&&
     e.payload.body.proposal===update.id&&e.payload.body.choice==='approve');
 },'signed approval reaches the independently operated peer');
 const groupProof=await createGroupProof(bridge.replica.list(),groupRecord.id);
 assert.equal((await verifyGroupProof(groupProof)).information.name,
   'Cooperative approved by signer');
 const proofFile=path.join(base,'integration-group-proof.json');
 await writeFile(proofFile,JSON.stringify(groupProof));
 await b.$('#verifyGroupFile').then(input=>input.uploadFile(proofFile));
 await b.evaluate(()=>document.querySelector('#verifyGroupButton').click());
 await eventually(()=>b.evaluate(()=>
   document.querySelector('#groupProofStatus')?.textContent.includes('VALID SIGNATURE CHAIN')),
   'browser independently verifies a quorum-backed group proof',15000);
 await b.evaluate(()=>{
   const section=[...document.querySelectorAll('.group-entry')].find(el=>
     el.querySelector('.group-heading strong')?.textContent==='Cooperative approved by signer');
   const motion=section.querySelector('.group-motions');
   motion.open=true;
   motion.querySelector('input').value='Should we publish more public tutorials?';
   motion.querySelector('textarea').value='Advisory only, 7-day signed voting window';
   motion.querySelector('form').requestSubmit();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='proposal'&&
   e.payload.body.group===groupRecord.id&&e.payload.body.change.type==='resolution'),
   'independently signed time-boxed advisory motion crosses OrbitDB');
 await eventually(()=>b.evaluate(()=>
   document.querySelector('#groupList')?.textContent.includes('Should we publish more public tutorials?')),
   'ordinary timed yes/no motion visible in browser UI',15000);
 console.log('CLASSIC checkpoint 15a: signed group metadata ratification, offline JSON proof verification and 7-day motions');
 await b.evaluate(()=>document.getElementById('closeClans').click());
 console.log('CLASSIC checkpoint 15: group creation publishes an independent signed charter');
 await eventually(()=>b.evaluate(()=>document.querySelector('#recommendedSpaceLinks')?.textContent.includes('/makerspace')),
   'followed group recommendation appears in separate row');
 await b.evaluate(()=>document.getElementById('toggleRecommendedSpaces').click());
 await eventually(()=>b.evaluate(()=>document.querySelector('#recommendedSpaceNav').classList.contains('collapsed')),
   'hide followed group recommendations');
 await b.evaluate(()=>document.getElementById('toggleRecommendedSpaces').click());
 await eventually(()=>b.evaluate(()=>document.querySelector('#recommendedSpaceLinks')?.textContent.includes('/cats')),
   'restore group recommendation chips');

 // Reply threading is a *tree*, not a flat list with an indiscriminate
 // vertical line across text. Verify a second-level signed reply and that
 // collapse changes only that subtree, not the parent or other comments.
 const firstPost=bridge.replica.list().find(e=>e.payload.kind==='post'&&
   e.payload.body.title==='My first actual cats post');
 const firstReply=bridge.replica.list().find(e=>e.payload.kind==='reply'&&
   e.payload.body.text==='A separate, real signed comment');
 assert.ok(firstPost&&firstReply,'original signed post and comment required');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),firstPost.id);
 await b.evaluate(id=>{
   document.querySelector('[data-comment-id="'+id+'"] > .comment-actions .comment-reply').click();
 },firstReply.id);
 const nestedSelector='[data-comment-id="'+firstReply.id+'"] > .comment-form textarea';
 await b.type(nestedSelector,'Nested signed reply with visible threaded indentation',{delay:3});
 await b.evaluate(id=>{
   document.querySelector('[data-comment-id="'+id+'"] > .comment-form button').click();
 },firstReply.id);
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='reply'&&
   e.payload.body.parent===firstReply.id&&
   e.payload.body.text==='Nested signed reply with visible threaded indentation'),
   'independent peer persisted signed nested reply');
 const nestedReply=bridge.replica.list().find(e=>e.payload.kind==='reply'&&
   e.payload.body.parent===firstReply.id&&
   e.payload.body.text.startsWith('Nested signed reply'));
 await eventually(()=>b.evaluate((rootId,nestedId)=>
   !!document.querySelector('[data-comment-id="'+rootId+'"] .comment-children > [data-comment-id="'+nestedId+'"]'),
   firstReply.id,nestedReply.id),'nested reply appears underneath its signed parent');
 const commentGeometry=await b.evaluate((rootId,nestedId)=>{
   const root=document.querySelector('[data-comment-id="'+rootId+'"]');
   const child=document.querySelector('[data-comment-id="'+nestedId+'"]');
   const rootRect=root.getBoundingClientRect(),textRect=root.querySelector(':scope > .comment-text').getBoundingClientRect();
   const childRect=child.getBoundingClientRect();
   return {rail:rootRect.left,body:textRect.left,child:childRect.left};
 },firstReply.id,nestedReply.id);
 assert.ok(commentGeometry.body>commentGeometry.rail+8,
   'root comment text must never overlap its own vertical rail: '+JSON.stringify(commentGeometry));
 assert.ok(commentGeometry.child>commentGeometry.body,
   'nested child rail must be indented past parent text: '+JSON.stringify(commentGeometry));
 await b.evaluate(id=>document.querySelector('[data-comment-id="'+id+'"] .comment-collapse').click(),firstReply.id);
 assert.equal(await b.evaluate(id=>document.querySelector('[data-comment-id="'+id+'"] .comment-children').hidden,firstReply.id),true);
 await b.evaluate(id=>document.querySelector('[data-comment-id="'+id+'"] .comment-collapse').click(),firstReply.id);
 assert.equal(await b.evaluate(id=>document.querySelector('[data-comment-id="'+id+'"] .comment-children').hidden,firstReply.id),false);
 console.log('CLASSIC checkpoint 16: signed nested thread, aligned comment rails and collapse');

 // A viewer's self-signed spam report can hide a post from that viewer only.
 // A second independent viewer still sees the signed original. The first
 // viewer can inspect and locally ignore the allegation from Trash.
 await b.evaluate(()=>document.querySelector('.report-control > summary').click());
 await b.type('.report-form textarea','Automated commercial advertisements copied repeatedly.');
 await b.evaluate(()=>document.querySelector('.report-submit').click());
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='label'&&
   e.payload.body.target===firstPost.id&&e.payload.body.tag==='spam'),'signed spam allegation delivered');
 const reportLabel=bridge.replica.list().find(e=>e.payload.kind==='label'&&
   e.payload.body.target===firstPost.id&&e.payload.body.tag==='spam');
 await eventually(()=>b.evaluate(id=>!document.querySelector('.post[data-id="'+id+'"]'),firstPost.id),
   'reporting viewer hides own flagged post under own moderation policy');
 assert.equal(await a.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),firstPost.id),true,
   'report cannot globally delete the original from another viewer');
 await b.evaluate(()=>document.getElementById('viewAudited').click());
 await eventually(()=>b.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),firstPost.id),
   'signed post is still inspectable in local Trash');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),firstPost.id);
 assert.ok(await b.$$eval('.audit-entry',nodes=>nodes.length)>=1);
 await b.evaluate(id=>{
   const row=document.querySelector('.audit-entry');
   row.querySelector('.audit-actions button').click();
 },reportLabel.id);
 await eventually(()=>b.evaluate(id=>!document.querySelector('.post[data-id="'+id+'"]'),firstPost.id),
   'locally ignored report no longer qualifies as hidden content in Trash');
 await b.evaluate(()=>document.querySelector('[data-sort="new"]').click());
 await eventually(()=>b.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),firstPost.id),
   'locally ignored allegation restores original post in normal view');
 assert.equal(bridge.replica.list().some(e=>e.id===reportLabel.id),true,
   'ignored signed moderation evidence must remain independently stored');
 console.log('CLASSIC checkpoint 17: signed moderation allegation, cross-viewer isolation, audit override');

 // The offer form publishes interoperable named fields with ordinary inputs.
 // They are searchable individually without asking the publisher for JSON.
 await b.evaluate(()=>{
   document.getElementById('postNew').click();
   const select=document.getElementById('composePresentation');
   select.value='offer';select.dispatchEvent(new Event('change',{bubbles:true}));
   document.getElementById('composeTitle').value='Actual interoperable field test';
   document.getElementById('composeText').value='A real signed offer with custom attributes';
   document.getElementById('composePrice').value='$25 / trade';
   document.getElementById('composeAttributes').open=true;
   document.getElementById('addComposeAttribute').click();
   document.querySelector('.attribute-key').value='license';
   document.querySelector('.attribute-value').value='CC0';
   document.getElementById('postForm').requestSubmit();
 });
 await b.evaluate(()=>{
   if(!document.querySelector('#composePreviewDialog').open)throw Error('No offer preview');
   document.getElementById('composePermanentAck').click();
   document.getElementById('confirmPublishPost').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Actual interoperable field test'&&
   e.payload.body.fields.price==='$25 / trade'&&
   e.payload.body.fields.license==='CC0'),'signed offer and custom attribute delivered');
 await b.evaluate(()=>{
   document.getElementById('searchCustomField').value='license';
   document.getElementById('searchCustomField').dispatchEvent(new Event('input',{bubbles:true}));
   document.getElementById('searchPosts').value='CC0';
   document.getElementById('searchPosts').dispatchEvent(new Event('input',{bubbles:true}));
 });
 await eventually(()=>b.evaluate(()=>{
   const titles=[...document.querySelectorAll('.post-headline')].map(x=>x.textContent);
   return titles.length===1&&titles[0]==='Actual interoperable field test';
 }),'specific-attribute search finds signed offer and not unrelated posts');
 await b.evaluate(()=>document.querySelector('.post').click());
 const attributes=await b.evaluate(()=>({
   price:document.querySelector('.listing-price')?.textContent,
   license:document.querySelector('.extra-attributes')?.textContent
 }));
 assert.match(attributes.price,/\$25/,'structured price displays as a human-readable field');
 assert.match(attributes.license,/licenseCC0/i,'custom attribute displays in expanded post, not only in search');
 console.log('CLASSIC checkpoint 18: structured marketplace form and arbitrary attribute search');

 // Exercise long tags and original-style demo media: reveal the last tags
 // only when the inline ellipsis is selected, and keep image/sound badges off.
 await b.evaluate(()=>{
   document.getElementById('searchCustomField').value='';
   document.getElementById('searchPosts').value='';
   document.getElementById('searchPosts').dispatchEvent(new Event('input',{bubbles:true}));
   document.querySelector('.post.selected')?.click();
 });
 const manyTagPost=await signEvent(demoIdentity,{space:'demo',kind:'post',
   body:{title:'24 tags expansion test',text:'Tags should remain in compact vote chips.',
     media:[],fields:{presentation:'text',
       tags:Array.from({length:24},(_,i)=>'testtag'+i)}}});
 await index.publish(manyTagPost);
 await eventually(()=>b.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),manyTagPost.id),
   'signed 24-tag test post delivered');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),manyTagPost.id);
 assert.equal(await b.$$eval('.tag-chip',all=>all.length),20,'tag display is limited to 20 by default');
 assert.equal(await b.$$eval('.tag-more',all=>all.length),1,'one ellipsis reveals additional tags');
 const chipDetails=await b.evaluate(()=>{
   const chip=document.querySelector('.tag-chip');
   return {up:!!chip.querySelector('.tag-up'),down:!!chip.querySelector('.tag-down'),
     children:chip.children.length,addIsChip:document.querySelector('.tag-add')?.closest('.tag-chip')!==null};
 });
 assert.ok(chipDetails.up&&chipDetails.down&&chipDetails.children>=4);
 assert.equal(chipDetails.addIsChip,false,'add-tag must be a link, not an existing tag pill');
 await b.evaluate(()=>document.querySelector('.tag-more').click());
 assert.equal(await b.$$eval('.tag-chip',all=>all.length),24);
 assert.equal(await b.$$eval('.tag-more',all=>all.length),0,'ellipsis disappears after expansion');
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 const soundPost=await signEvent(demoIdentity,{space:'demo',kind:'post',
   body:{title:'Sound controls test',text:'Example static sound clip',
     media:[],fields:{presentation:'audio',demo:true,demoVersion:1,
       demoAudio:'../content/festival_theme.mp3',tags:['sound']}}});
 const videoPost=await signEvent(demoIdentity,{space:'demo',kind:'post',
   body:{title:'Hover video controls test',text:'Example static video clip',
     media:[],fields:{presentation:'video',demo:true,demoVersion:1,
       demoVideo:'../thumb/thumb10.mp4',demoThumb:'../thumb/thumb11.jpg',tags:['video']}}});
 await index.publish(soundPost);
 await index.publish(videoPost);
 await eventually(()=>b.evaluate((audioId,videoId)=>
   !!document.querySelector('.post[data-id="'+audioId+'"] .mini-audio.compact')&&
   !!document.querySelector('.post[data-id="'+videoId+'"] .hover-video'),
   soundPost.id,videoPost.id),'separate signed audio and hover-video examples render');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),soundPost.id);
 assert.equal(await b.$$eval('.mini-audio-toggle',buttons=>buttons.length)>=1,true);
 assert.equal(await b.$$eval('.mini-audio audio',all=>all.length),0,
   'one hidden global audio transport replaces separate tile/expanded elements');
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 await b.click('.post[data-id="'+soundPost.id+'"] .mini-audio-toggle');
 await eventually(()=>b.evaluate(id=>
   !!document.querySelector('.post[data-id="'+id+'"] .mini-audio.playing'),
   soundPost.id),'audio mini-player starts on a real user click');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),soundPost.id);
 assert.ok(await b.evaluate(()=>!!document.querySelector('.post-container .mini-audio.playing')),
   'expanded audio controls reflect the SAME playback session');
 const beforeTime=await b.evaluate(()=>document.querySelector('.post-container .mini-audio-clock').textContent);
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 assert.ok(await b.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"] .mini-audio.playing'),
   soundPost.id),'closing the expanded post must not stop audio');
 const afterTime=await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"] .mini-audio-clock').textContent,
   soundPost.id);
 assert.equal(typeof beforeTime,'string');assert.equal(typeof afterTime,'string');
 await b.click('.post[data-id="'+soundPost.id+'"] .mini-audio-toggle');
 const videoTile='.post[data-id="'+videoPost.id+'"]';
 await b.hover(videoTile);
 await eventually(()=>b.evaluate(id=>{
   const video=document.querySelector('.post[data-id="'+id+'"] .hover-video');
   return video?.src?.endsWith('thumb10.mp4')&&video.muted&&video.loop;
 },videoPost.id),'mouse-hover loads muted looping thumbnail preview');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),videoPost.id);
 assert.equal(await b.$$eval('.mini-video-player video',els=>els.length),1,
   'expanded video uses custom player instead of native controls');
 assert.equal(await b.$eval('.mini-video-player video',el=>el.controls),false);
 assert.equal(await b.$$eval('.mini-video-controls input[type=range]',els=>els.length),2,
   'minimal custom video controls provide seek timeline and volume slider');
 await b.evaluate(()=>document.querySelector('.post.selected')?.click());
 console.log('CLASSIC checkpoint 18a: compact tag voting, signed sound and hover video previews');

 // Export a password-encrypted identity from this classic website, then
 // restore it at a THIRD independent website origin. The restored signer
 // must publish valid events without a centrally registered account.
 const originalSigner=bridge.replica.list().find(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Actual interoperable field test').payload.author;
 await b.evaluate(()=>{
   const create=URL.createObjectURL.bind(URL);
   URL.createObjectURL=blob=>{window.__web9000TestKeyBackupBlob=blob;return create(blob);};
   HTMLAnchorElement.prototype.click=function(){};
   document.getElementById('identityButton').click();
   document.getElementById('identityPassword').value='example-encryption-password-123456';
   document.getElementById('saveIdentityBackup').click();
 });
 await eventually(()=>b.evaluate(()=>
   document.getElementById('identityMessage')?.textContent.includes('Encrypted backup generated')&&
   !!window.__web9000TestKeyBackupBlob),'encrypted identity backup generated by classic UI');
 const exported=await b.evaluate(()=>window.__web9000TestKeyBackupBlob.text());
 const parsed=JSON.parse(exported);
 assert.equal(parsed.format,'WEB9000/identity-backup/v1');
 assert.equal(parsed.author,originalSigner);
 assert.equal(typeof parsed.cipher.data,'string');
 assert.equal(Object.hasOwn(parsed,'privateKey'),false,'unencrypted key must not be serialized');
 await b.evaluate(()=>document.getElementById('closeIdentity').click());
 const originC=await serve(),c=await browser.newPage();
 c.on('pageerror',e=>errors.push('c: '+e.message));
 await c.goto(originC,{waitUntil:'domcontentloaded'});await ready(c);
 const beforeRestore=await c.evaluate(()=>{
   document.getElementById('identityButton').click();
   return document.getElementById('identityPublicKey').textContent;
 });
 assert.notEqual(beforeRestore,originalSigner,'third origin has its own initial signing key');
 await c.evaluate(text=>{
   window.confirm=()=>true;
   document.getElementById('identityPassword').value='example-encryption-password-123456';
   const picker=document.getElementById('identityBackupFile');
   const dt=new DataTransfer();
   dt.items.add(new File([text],'portable-identity.encrypted.json',{type:'application/json'}));
   picker.files=dt.files;
   picker.dispatchEvent(new Event('change',{bubbles:true}));
 },exported);
 await eventually(()=>c.evaluate(author=>
   document.getElementById('identityPublicKey').textContent===author&&
   document.getElementById('identityMessage').textContent.includes('Signing identity restored'),
   originalSigner),'encrypted signing identity restored on independent site');
 await c.evaluate(()=>document.getElementById('closeIdentity').click());
 await connect(c,bridge.url);
 await c.evaluate(()=>{
   document.getElementById('postNew').click();
   document.getElementById('composeTitle').value='Portable key on a third independent website';
   document.getElementById('composeText').value='Signed using the imported key, not a hosted account.';
   document.getElementById('postForm').requestSubmit();
 });
 await c.evaluate(()=>{
   if(!document.querySelector('#composePreviewDialog').open)throw Error('No portable post preview');
   document.getElementById('composePermanentAck').click();
   document.getElementById('confirmPublishPost').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Portable key on a third independent website'&&
   e.payload.author===originalSigner),'third site publishes a correctly signed post with restored key');
 await c.evaluate(()=>{
   document.getElementById('identityButton').click();
   document.getElementById('profileEditor').open=true;
   document.getElementById('profileName').value='Interoperable test author';
   document.getElementById('profileDescription').value='A signed user bio visible on separate static websites.';
   document.getElementById('profileWebsite').value='https://example.org/';
   document.getElementById('publishProfile').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='profile'&&
   e.payload.author===originalSigner&&
   e.payload.body.description.includes('separate static websites')),
   'signed portable profile metadata accepted by independent peer');
 await c.evaluate(()=>document.getElementById('myProfileButton').click());
 await eventually(()=>c.evaluate(()=>document.querySelector('.profile-title')?.textContent===
   'Interoperable test author'),'signed user page displays authored name');
 assert.ok(await c.$eval('.profile-description',el=>el.textContent.includes('separate static websites')));
 assert.ok(await c.$$eval('.profile-stat',items=>items.length)>=4,'profile has karma and posting stats');
 assert.ok(await c.$$eval('.post-headline',els=>els.some(e=>
   e.textContent==='Portable key on a third independent website')));
 console.log('CLASSIC checkpoint 19a: signed personal page and unified grid of authored posts');
 console.log('CLASSIC checkpoint 19: encrypted identity backup and signing across three website origins');

 // The visible author can correct a publication without modifying its
 // immutable original ID, vote totals or thread ancestry. The correction
 // follows the restored private key to any independent website origin.
 const originalPost=bridge.replica.list().find(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Portable key on a third independent website');
 await c.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),originalPost.id);
 assert.equal(await c.$$eval('.correct-post',els=>els.length),1,
   'only the signing key sees a correct-publication action');
 await c.evaluate(()=>{
   document.querySelector('.correct-post').click();
   document.getElementById('composeTitle').value='Portable idea corrected by its actual author';
   document.getElementById('composeText').value='Second immutable signed version; the original must remain.';
   document.getElementById('postForm').requestSubmit();
 });
 assert.equal(await c.evaluate(()=>document.querySelector('#composePreviewDialog').open),true,
   'signed corrections must use the same explicit preview as initial publication');
 assert.match(await c.$eval('.preview-revision-warning',e=>e.textContent),/new immutable event/);
 await c.evaluate(()=>{
   document.getElementById('composePermanentAck').click();
   document.getElementById('confirmPublishPost').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='post'&&
   e.payload.body.fields?.revises===originalPost.id&&
   e.payload.body.title==='Portable idea corrected by its actual author'),
   'signed author correction reaches independent peer');
 const correction=bridge.replica.list().find(e=>e.payload.kind==='post'&&
   e.payload.body.fields?.revises===originalPost.id);
 await eventually(()=>c.evaluate(id=>{
   const card=document.querySelector('.post[data-id="'+id+'"]');
   return card?.querySelector('.post-headline')?.textContent===
     'Portable idea corrected by its actual author'&&
     document.querySelectorAll('.post[data-id="'+id+'"]').length===1;
 },originalPost.id),'original post ID stays fixed while corrected title appears');
 assert.equal(await c.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),correction.id),
   false,'correction is not a duplicate new grid card');
 await c.evaluate(id=>{
   if(!document.querySelector('.post-container.expanded'))
     document.querySelector('.post[data-id="'+id+'"]').click();
 },originalPost.id);
 assert.match(await c.$eval('.publication-history summary',e=>e.textContent),/2 versions/);
 assert.equal(await c.$$eval('.publication-history .history-row',els=>els.length),2);
 await c.evaluate(()=>document.querySelector('.publication-history').open=true);
 await c.evaluate(()=>document.querySelector('.history-readable-version').open=true);
 assert.match(await c.$eval('.history-post-text',e=>e.textContent),
   /Signed using the imported key/,'original readable content remains available to audit');
 assert.equal(await c.$eval('.expanded-body .post-detail-heading h2',e=>e.textContent),
   'Portable idea corrected by its actual author');
 assert.ok(bridge.replica.list().some(e=>e.id===originalPost.id)&&
   bridge.replica.list().some(e=>e.id===correction.id),
   'both signed versions remain independently retrievable');
 // Another static website with the same portable key sees the correction
 // through peer synchronization, not a centralized account or HTTP post.
 await b.evaluate(()=>{
   document.querySelector('.post.selected')?.click();
   document.getElementById('searchCustomField').value='';
   document.getElementById('searchCustomField').dispatchEvent(new Event('input',{bubbles:true}));
   document.getElementById('searchPosts').value='';
   document.getElementById('searchPosts').dispatchEvent(new Event('input',{bubbles:true}));
 });
 await eventually(()=>b.evaluate(id=>
   document.querySelector('.post[data-id="'+id+'"] .post-headline')?.textContent===
    'Portable idea corrected by its actual author',originalPost.id),
   'another independent website shows the signed correction while retaining original ID');

 // Withdrawal is an author-signed request, NOT deletion. The requesting
 // reader sees the original in Trash, but both signed events still exist.
 await c.evaluate(()=>{
   window.confirm=()=>true;window.prompt=()=> 'Retracting to reconsider this claim';
   document.querySelector('.withdraw-post').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='retraction'&&
   e.payload.body.target===originalPost.id&&
   e.payload.body.action==='withdraw'),'author withdrawal reaches independent peer');
 const withdraw=bridge.replica.list().find(e=>e.payload.kind==='retraction'&&
   e.payload.body.target===originalPost.id&&e.payload.body.action==='withdraw');
 await eventually(()=>c.evaluate(id=>
   !!document.querySelector('.post[data-id="'+id+'"]')&&
   !!document.querySelector('.author-withdrawal')&&
   document.getElementById('viewAudited').classList.contains('active'),
   originalPost.id),'author-withdrawn record remains accessible from the local Trash audit');
 assert.equal(await c.evaluate(()=>document.querySelector('.publication-history .history-row')!==null),true);
 assert.ok(bridge.replica.list().some(e=>e.id===originalPost.id)&&
   bridge.replica.list().some(e=>e.id===correction.id)&&
   bridge.replica.list().some(e=>e.id===withdraw.id),
   'withdrawal did not delete or rewrite any prior signed event');
 await eventually(()=>b.evaluate(id=>!document.querySelector('.post[data-id="'+id+'"]'),
   originalPost.id),'an independent viewer honors the signed withdrawal by default');
 // A different client is free to disregard the author's latest preference.
 await c.evaluate(()=>{
   document.querySelector('.post.selected')?.click();
   document.getElementById('showSearchOptions').click();
   document.getElementById('respectWithdrawals').click();
   document.querySelector('[data-sort="new"]').click();
 });
 await eventually(()=>c.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),
   originalPost.id),'reader can independently elect to display author-withdrawn posts');
 await c.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),originalPost.id);
 assert.ok(await c.$eval('.author-withdrawal',el=>el.textContent.includes('original still independently retrievable')));
 // The same author may later sign a restoration; the signed withdrawal is
 // nevertheless still accessible in the immutable timeline.
 await c.evaluate(()=>document.querySelector('.withdraw-post').click());
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='retraction'&&
   e.payload.body.target===originalPost.id&&e.payload.body.action==='restore'),
   'author independently restores ordinary view without erasing withdrawal evidence');
 const restoration=bridge.replica.list().find(e=>e.payload.kind==='retraction'&&
   e.payload.body.target===originalPost.id&&e.payload.body.action==='restore');
 assert.ok(restoration.payload.author===originalSigner);
 assert.ok(bridge.replica.list().some(e=>e.id===withdraw.id));
 await eventually(()=>b.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),
   originalPost.id),'a signed restore request returns content to another independent viewer');
 // Publish a REAL mixed media post: a site-hosted MP3, an actual MP4 clip
 // and a JPEG are read into the local browser FileList, then uploaded as
 // independently stored IPFS blocks/UnixFS from the normal preview UI.
 await c.evaluate(async()=>{
   document.querySelector('.post.selected')?.click();
   document.querySelector('[data-sort="new"]').click();
   document.getElementById('postNew').click();
   document.getElementById('composeTitle').value='Mixed images, sound and video';
   document.getElementById('composeText').value='Each signed CID has a matching MIME type, with video chosen as the primary visual.';
   const dt=new DataTransfer();
   for(const [url,name,type] of [
     ['/content/festival_theme.mp3','tune.mp3','audio/mpeg'],
     ['/thumb/thumb10.mp4','demo.mp4','video/mp4'],
     ['/thumb/thumb01.jpg','photo.jpg','image/jpeg']
   ]){
     const data=await(await fetch(url)).arrayBuffer();
     dt.items.add(new File([data],name,{type}));
   }
   const picker=document.getElementById('composeFiles');
   picker.files=dt.files;
   picker.dispatchEvent(new Event('change',{bubbles:true}));
   document.getElementById('postForm').requestSubmit();
 });
 await eventually(()=>c.evaluate(()=>document.getElementById('composePreviewDialog').open),
   'mixed format preview is available to the human author');
 assert.equal(await c.$$eval('.compose-preview-gallery input[type=radio]',els=>els.length),3);
 assert.equal(await c.$$eval('.compose-preview-gallery img',els=>els.length),1);
 assert.equal(await c.$$eval('.compose-preview-gallery video',els=>els.length),1);
 assert.equal(await c.$$eval('.compose-preview-gallery audio',els=>els.length),1);
 await c.evaluate(()=>{
   const indicator=document.getElementById('composeUploadIndicator');
   window.__web9000UploadProgressSeen=false;
   const observer=new MutationObserver(()=>{
     if(!indicator.hidden)window.__web9000UploadProgressSeen=true;
   });
   observer.observe(indicator,{attributes:true,attributeFilter:['hidden']});
   const radio=document.querySelector('.compose-preview-gallery input[value="1"]');
   radio.click();
   document.getElementById('composePermanentAck').click();
   document.getElementById('confirmPublishPost').click();
 });
 await eventually(()=>bridge.replica.list().some(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Mixed images, sound and video'),
   'audio and video sent through independent media peer and signed metadata published');
 assert.equal(await c.evaluate(()=>window.__web9000UploadProgressSeen),true,
   'author sees a progress indicator during mixed-media transfer');
 await eventually(()=>c.evaluate(()=>
   document.getElementById('composeUploadIndicator').hidden&&
   !document.getElementById('composePreviewDialog').open),
   'transfer progress resets after successful signing and preview closes');
 const mixed=bridge.replica.list().find(e=>e.payload.kind==='post'&&
   e.payload.body.title==='Mixed images, sound and video');
 assert.deepEqual(mixed.payload.body.fields.mediaTypes,
   ['audio/mpeg','video/mp4','image/jpeg']);
 assert.equal(mixed.payload.body.fields.primaryMediaIndex,1);
 assert.equal(mixed.payload.body.media.length,3);
 assert.equal(new Set(mixed.payload.body.media).size,3);
 await eventually(()=>c.evaluate(id=>
   !!document.querySelector('.post[data-id="'+id+'"] .media-video-tile'),
   mixed.id),'video is used as the author-selected primary tile visual');
 await c.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),mixed.id);
 assert.equal(await c.$$eval('.mixed-media-gallery',all=>all.length),1);
 assert.equal(await c.$$eval('.mixed-media-gallery .mixed-attachment-chip',all=>all.length),3);
 assert.equal(await c.$$eval('.mixed-media-gallery .mini-video-player',all=>all.length),1,
   'chosen video renders in custom full-size viewer');
 await c.evaluate(()=>document.querySelector('.mixed-media-gallery .gallery-next').click());
 assert.equal(await c.$$eval('.mixed-media-gallery .gallery-stage img',all=>all.length),1,
   'next mixed attachment displays the JPEG');
 await c.evaluate(()=>document.querySelector('.mixed-media-gallery .gallery-next').click());
 assert.equal(await c.$$eval('.mixed-media-gallery .mini-audio',all=>all.length),1,
   'next mixed attachment shows shared audio mini-player');
 const realUpload=await fetch('http://127.0.0.1:'+mediaGateway.port+
   '/ipfs/'+mixed.payload.body.media[1].slice(7),{headers:{range:'bytes=12-45'}});
 assert.equal(realUpload.status,206);
 assert.equal((await realUpload.arrayBuffer()).byteLength,34);
 // The restored signing key at a different origin can render its own
 // media, while an unrelated viewer must choose whether to download bytes.
 await eventually(()=>b.evaluate(id=>
   !!document.querySelector('.post[data-id="'+id+'"]'),mixed.id),
   'independent browser receives interoperable signed mixed-media post');
 await b.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),mixed.id);
 assert.equal(await b.$$eval('.mixed-gallery-stage .mini-video-player',all=>all.length),1,
   'same portable signing identity sees its selected video on another website');
 await a.evaluate(()=>{
   document.getElementById('spaceName').value='demo';
   document.getElementById('goSpace').click();
   document.querySelector('[data-sort="new"]').click();
   const raw=document.getElementById('showUnverified');
   if(!raw.checked)raw.click();
 });
 await eventually(()=>a.evaluate(id=>!!document.querySelector('.post[data-id="'+id+'"]'),mixed.id),
   'independent viewer can browse a signed post from an unknown author');
 await a.evaluate(id=>document.querySelector('.post[data-id="'+id+'"]').click(),mixed.id);
 assert.equal(await a.$$eval('.mixed-gallery-stage .gallery-load',all=>all.length),1,
   'unknown author rich media requires an explicit reader download click');
 console.log('CLASSIC checkpoint 21: actual mixed JPEG+MP3+MP4 uploads, selected video thumbnail, IPFS UnixFS seek and safe peer replication');
 console.log('CLASSIC checkpoint 20: authenticated corrections and reversible author withdrawal, every signed version retained');

 // A new reader on a FOURTH independent web origin can choose exactly which
 // namespaces to synchronize without granting a gateway or curator authority.
 // This must not delete earlier locally stored signed events when changing
 // scopes, and a scoped client must not ingest valid out-of-scope records.
 const originD=await serve(),d=await browser.newPage();
 d.on('pageerror',e=>errors.push('d: '+e.message));
 await d.goto(originD,{waitUntil:'domcontentloaded'});await ready(d);
 assert.equal(await d.$eval('#peerScopes',e=>e.value),'*',
   'existing users retain wildcard sync until they explicitly opt into scopes');
 await d.evaluate(url=>{
   document.querySelector('#joinNetwork').click();
   document.querySelector('#peerURLs').value=url;
   document.querySelector('#peerScopes').value='demo';
   document.querySelector('#connectPeers').click();
 },bridge.url);
 const stored=async page=>page.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return (await getItem(db,'records')||[]).map(e=>({id:e.id,space:e.payload.space}));}
   finally{db.close();}
 });
 await eventually(async()=>{
   const rows=await stored(d);
   return rows.length>=DEMO_CATALOG.length&&rows.every(e=>e.space==='demo');
 },'fourth-origin reader synchronizes only demo namespace',20000);
 const other=await signEvent(demoIdentity,{space:'scoped-elsewhere',
   body:{title:'Not delivered to fourth-origin scope',text:'Valid, but unrelated namespace'}});
 await index.publish(other);
 await eventually(async()=> (await stored(a)).some(e=>e.id===other.id),
   'wildcard reader receives independently signed other-namespace record',18000);
 await sleep(250);
 assert.equal((await stored(d)).some(e=>e.id===other.id),false,
   'scoped reader rejects unrelated namespace even while another reader receives it');
 await d.reload({waitUntil:'domcontentloaded'});await ready(d);
 assert.equal(await d.$eval('#peerScopes',e=>e.value),'demo',
   'namespace subscription persists after page reload');
 await eventually(()=>d.evaluate(()=>
   document.querySelector('#peerStatus')?.textContent.includes('1 sync scope(s)')),
   'scoped network status survives restart');
 await d.evaluate(()=>{
   document.querySelector('#joinNetwork').click();
   document.querySelector('#peerScopes').value='groups';
   document.querySelector('#connectPeers').click();
 });
 await eventually(async()=> (await stored(d)).some(e=>e.space==='groups'),
   'changing scope obtains historical group namespace without erasing older records',18000);
 const afterScopeChange=await stored(d);
 assert.ok(afterScopeChange.some(e=>e.space==='demo')&&afterScopeChange.some(e=>e.space==='groups'),
   'local previously downloaded records survive subscription changes');
 assert.equal(afterScopeChange.some(e=>e.id===other.id),false,
   'switching to groups does not silently load unrelated namespace');
 console.log('CLASSIC checkpoint 22: fourth-origin opt-in namespace subscriptions, persisted scopes, independent publication and local record retention');

 // The source server suggests a media gateway but cannot approve it by
 // itself. A visible user click on a specific image MUST work, not produce
 // the old 'No independent IPFS media gateway configured' dead end.
 const sampleImage=DEMO_CATALOG.find(spec=>spec.type==='image'&&!spec.noThumb&&!spec.video);
 assert.ok(sampleImage,'demo catalog includes an actual signed CID image');
 const originE=await serve({externalMediaClaim:true}),e=await browser.newPage();
 e.on('pageerror',err=>errors.push('e: '+err.message));
 await e.goto(originE,{waitUntil:'domcontentloaded'});await ready(e);
 assert.equal(await e.$eval('#enableImages',button=>button.hidden),false,
   'page offers one-click explicit media approval rather than an unexplained placeholder');
 assert.match(await e.$eval('#enableImages',button=>button.textContent),/Enable images/);
 await e.evaluate(url=>{
   document.querySelector('#joinNetwork').click();
   document.querySelector('#peerURLs').value=url;
   // Deliberately approve the WebSocket peer WITHOUT approving its suggested
   // media gateway, to reproduce the user's already-connected state.
   document.querySelector('#mediaPeerUrl').value='';
   document.querySelector('#connectPeers').click();
 },bridge.url);
 await eventually(()=>e.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(el=>el.querySelector('.post-headline')?.textContent===title),
 sampleImage.title),'media-consent test origin received signed demo image',20000);
 const candidate=await e.evaluate(title=>{
   const tile=[...document.querySelectorAll('#imageGrid .post')]
     .find(el=>el.querySelector('.post-headline')?.textContent===title);
   return {placeholder:!!tile.querySelector('.post-reveal'),title:tile.textContent.slice(0,80)};
 },sampleImage.title);
 assert.ok(candidate.placeholder,'unapproved media is not downloaded merely from an IPFS CID');
 // Live signed events can trigger a full grid render between clicking a
 // tile and finding its expanded content. Retry the real user gesture until
 // the intended post is expanded, rather than racing that render.
 await eventually(()=>e.evaluate(title=>{
   const expanded=document.querySelector('.expanded-body .media-ref button');
   if(expanded)return true;
   const tile=[...document.querySelectorAll('#imageGrid .post')]
     .find(el=>el.querySelector('.post-headline')?.textContent===title);
   if(!tile)return false;
   const selected=tile.getAttribute('aria-expanded')==='true'||tile.classList.contains('selected');
   if(!selected)tile.click();
   return false;
 },sampleImage.title),'explicitly selected image post has manual load control',12000);
 const manualLabel=await e.$eval('.expanded-body .media-ref button',button=>button.textContent);
 assert.match(manualLabel,/Load image from /,'manual load names the proposed gateway');
 await e.evaluate(()=>document.querySelector('.expanded-body .media-ref button').click());
 await eventually(()=>e.evaluate(()=>[...document.querySelectorAll('.expanded-body .media-ref img')]
   .some(img=>img.complete&&img.naturalWidth>0)),
   'manual image loads from expressly approved suggested gateway',20000);
 const approved=await e.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return {media:await getItem(db,'classic-media-url'),
     consent:await getItem(db,'classic-media-approved-v1')};}
   finally{db.close();}
 });
 assert.equal(approved.media,'http://127.0.0.1:'+mediaGateway.port);
 assert.equal(approved.consent,true);
 assert.equal(await e.$eval('#enableImages',button=>button.hidden),true);
 await sleep(850); // allow bounded session traffic history to flush before reload
 await e.reload({waitUntil:'domcontentloaded'});await ready(e);
 try{
   await eventually(()=>e.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
     .some(el=>el.querySelector('.post-headline')?.textContent===title),sampleImage.title),
     'restored post after reload',20000);
 }catch(error){
   const diagnostic=await e.evaluate(async title=>{
     const {openLocal,getItem}=await import('./core/persist.js');
     const db=await openLocal();
     try{
       return {wanted:title,selected:document.querySelector('#spaceName')?.value,
        posts:[...document.querySelectorAll('#imageGrid .post-headline')].slice(0,30).map(e=>e.textContent),
        peer:document.querySelector('#peerStatus')?.textContent,
        feed:document.querySelector('#feedStatus')?.textContent,
        approved:await getItem(db,'classic-media-approved-v1'),
        media:await getItem(db,'classic-media-url'),
        saved:(await getItem(db,'records')||[]).length,
        urls:await getItem(db,'peer-urls'),
        errors:document.querySelector('#toast')?.textContent};
     }finally{db.close();}
   },sampleImage.title);
   console.error('MISSING_RESTORED_POST',JSON.stringify(diagnostic));
   throw error;
 }
 await e.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .find(el=>el.querySelector('.post-headline')?.textContent===title)
   .scrollIntoView({block:'center',behavior:'instant'}),sampleImage.title);
 try{
   await eventually(()=>e.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
     .some(el=>el.querySelector('.post-headline')?.textContent===title&&
       el.querySelector('.post-thumb')?.naturalWidth>0),sampleImage.title),
     'CID thumbnail is now visible after explicit reader approval and reload',20000);
 }catch(error){
   const diagnostic=await e.evaluate(async title=>{
     const {openLocal,getItem}=await import('./core/persist.js');
     const db=await openLocal();
     const entries=await getItem(db,'records')||[];
     const pref=await getItem(db,'classic-media-url'),consent=await getItem(db,'classic-media-approved-v1');
     db.close();
     const el=[...document.querySelectorAll('#imageGrid .post')].find(card=>
       card.querySelector('.post-headline')?.textContent===title);
     return {title,postCount:document.querySelectorAll('#imageGrid .post').length,
       peer:document.querySelector('#peerStatus').textContent,
       saved:entries.length,mediaPref:pref,consent,selectedSpace:document.querySelector('#spaceName').value,
       tile:el?.outerHTML.slice(0,1050),
       headerEnableHidden:document.querySelector('#enableImages').hidden,
       errorText:document.querySelector('#toast').textContent};
   },sampleImage.title);
   console.error('RELOADED_IMAGE_DIAGNOSTIC',JSON.stringify(diagnostic));
   throw error;
 }
 await e.click('#debugConsoleButton');
 assert.equal(await e.$eval('#debugSource',el=>el.value),'network');
 assert.ok(await e.$$eval('#debugEntries .debug-record',entries=>entries.length)>0,
   'previously captured traffic survives the reload and appears when Debug opens');
 assert.ok(await e.$eval('#debugPostPick',el=>el.options.length)>0);
 await e.click('#debugDumpPost');
 assert.ok((await e.$eval('#debugRaw',el=>el.textContent)).includes('"signature"'));
 await e.click('#debugDumpComments');
 assert.equal(await e.$eval('#debugSource',el=>el.value),'dump');
 await e.$eval('#debugSource',el=>{el.value='network';el.dispatchEvent(new Event('change'));});
 await e.$eval('#debugLive',el=>{el.checked=false;el.dispatchEvent(new Event('change'));});
 const beforePause=await e.$$eval('#debugEntries .debug-record',entries=>entries.length);
 const later=await signEvent(demoIdentity,{kind:'post',space:'demo',
   body:{title:'Live traffic after console opened',text:'Signed update while Debug is paused'}});
 await index.publish(later);
 await eventually(()=>e.evaluate(id=>
   JSON.parse(sessionStorage.getItem('web9000-debug-traffic-v1')||'[]')
     .some(entry=>entry.raw.includes(id)),later.id),
   'new signed network packet buffered while live view is paused');
 assert.equal(await e.$$eval('#debugEntries .debug-record',entries=>entries.length),
   beforePause,'pause stops redrawing while still buffering signed network packets');
 await e.click('#debugRefresh');
 assert.ok(await e.$$eval('#debugEntries .debug-record',entries=>entries.length)>=beforePause);
 assert.equal(await e.$eval('#debugLive',el=>el.checked),false,
   'Refresh does not silently enable live view');
 await e.click('#closeDebug');
 console.log('CLASSIC checkpoint 23: explicit third-party image gateway approval, real CID image and thumbnails, header-only Debug, live pause and buffered traffic after reload');

 // WEB9000's own same-origin media endpoint is not a third-party peer.
 // Its signed CID pictures should simply be visible, on a fresh browser
 // without a hidden opt-in click or a forged approval record.
 const originF=await serve({firstPartyMedia:true}),f=await browser.newPage();
 f.on('pageerror',error=>errors.push('f: '+error.message));
 await f.goto(originF,{waitUntil:'domcontentloaded'});await ready(f);
 assert.equal(await f.$eval('#enableImages',b=>b.hidden),true,
   'same-origin media images must not display Enable images to fresh readers');
 // The site's same-origin WebSocket auto-connect and first-party media must
 // both work without a single reader click on a new browser origin.
 await eventually(()=>f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(tile=>tile.querySelector('.post-headline')?.textContent===title),
   sampleImage.title),'first-party board receives signed images',20000);
 await f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .find(tile=>tile.querySelector('.post-headline')?.textContent===title)
   .scrollIntoView({block:'center',behavior:'instant'}),sampleImage.title);
 await eventually(()=>f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(tile=>tile.querySelector('.post-headline')?.textContent===title&&
     tile.querySelector('img.post-thumb')?.naturalWidth>0),sampleImage.title),
   'first-party signed CID images load without an approval click',20000);
 const siteMediaState=await f.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js'),db=await openLocal();
   try{return {
     autoMedia:document.querySelector('.post[data-index] img.post-thumb')?.src,
     manuallyApproved:await getItem(db,'classic-media-approved-v1'),
     manuallySelectedURL:await getItem(db,'classic-media-url'),
     manualEnableHidden:document.querySelector('#enableImages').hidden
   };}finally{db.close();}
 });
 assert.equal(siteMediaState.manuallyApproved,false,
   'an automatic same-origin image must not forge user approval for third parties');
 assert.equal(siteMediaState.manuallySelectedURL,null,
   'default same-origin media never persists as a user-picked third-party gateway');
 assert.ok(siteMediaState.autoMedia?.startsWith(new URL(originF).origin+'/v2/media/ipfs/'));
 await f.reload({waitUntil:'domcontentloaded'});await ready(f);
 await eventually(()=>f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(tile=>tile.querySelector('.post-headline')?.textContent===title),
   sampleImage.title),'first-party reload obtains signed image post',20000);
 await f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .find(tile=>tile.querySelector('.post-headline')?.textContent===title)
   .scrollIntoView({block:'center',behavior:'instant'}),sampleImage.title);
 await eventually(()=>f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(tile=>tile.querySelector('.post-headline')?.textContent===title&&
     tile.querySelector('img.post-thumb')?.naturalWidth>0),sampleImage.title),
   'same-origin image still auto loads after reload',20000);
 console.log('CLASSIC checkpoint 24: same-origin real IPFS thumbnails load on first visit without clicks, third-party peer suggestions stay opt-in');

 // Multi-axis content ratings are signed and independent of popularity,
 // and age restrictions remain a reader-selected VISUAL policy.
 await f.evaluate(title=>{
   const tile=[...document.querySelectorAll('#imageGrid .post')]
     .find(x=>x.querySelector('.post-headline')?.textContent===title);
   tile.click();
 },sampleImage.title);
 await eventually(()=>f.evaluate(()=>!!document.querySelector('.expanded-body .spider-trigger')),
   'compact spider button sits by signed reaction score',10000);
 assert.equal(await f.$('.content-rating-panel'),null,
   'old massive in-article rating dropdown must be removed entirely');
 const triggerRow=await f.$eval('.expanded-body .reactions',row=>{
   const score=row.querySelector('.score'),spider=row.querySelector('.spider-trigger');
   return {scoreIndex:[...row.children].indexOf(score),
     spiderIndex:[...row.children].indexOf(spider),
     icon:spider?.textContent};
 });
 assert.equal(triggerRow.spiderIndex,triggerRow.scoreIndex+1,
   'single spider icon must follow the numeric popularity score');
 await f.click('.expanded-body .spider-trigger');
 await eventually(()=>f.evaluate(()=>!!document.querySelector('.spider-popup .spider-editor')),
   'spider editor opens as a floating popover',10000);
 const initialRating=await f.evaluate(()=>{
   const popup=document.querySelector('.spider-popup');
   const svg=popup.querySelector('svg.spider-editor');
   const r=popup.getBoundingClientRect();
   const page=document.documentElement;
   return {axes:svg.querySelectorAll('circle.spider-handle').length,
     optIn:document.querySelector('#ratingsEnable').checked,
     fixed:getComputedStyle(popup).position==='fixed',
     fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
     inArticle:!!document.querySelector('.expanded-body .spider-editor'),
     pageOverflow:page.scrollWidth-innerWidth};
 });
 assert.equal(initialRating.axes,5);
 assert.equal(initialRating.optIn,false);
 assert.equal(initialRating.fixed,true);
 assert.equal(initialRating.fits,true,JSON.stringify(initialRating));
 assert.equal(initialRating.inArticle,false);
 assert.equal(initialRating.pageOverflow,0);
 // Drag age suitability from 0 to 18+ (3/6) with genuine mouse movements;
 // verify its accessible slider state and live-language explanation.
 const ageStart=await f.$eval('.spider-handle[data-spider-axis="age"]',el=>{
   const r=el.getBoundingClientRect();
   return {x:r.left+r.width/2,y:r.top+r.height/2};
 });
 const ageEnd=await f.$eval('.spider-editor',svg=>{
   const r=svg.getBoundingClientRect();
   return {x:r.left+140*r.width/280,
     y:r.top+(125-82*3/6)*r.height/256};
 });
 await f.mouse.move(ageStart.x,ageStart.y);
 await f.mouse.down();
 await f.mouse.move(ageEnd.x,ageEnd.y,{steps:9});
 await f.mouse.up();
 assert.equal(await f.$eval('.spider-handle[data-spider-axis="age"]',
   el=>Number(el.getAttribute('aria-valuenow'))),3);
 assert.ok((await f.$eval('.spider-explanation-box',el=>el.textContent))
   .includes('18+'),'dragging updates the plain-language explanation');
 // Keyboard arrow/End edits the remaining axis with the same signed schema.
 await f.$eval('.spider-handle[data-spider-axis="controversy"]',el=>el.focus());
 await f.keyboard.press('End');
 assert.equal(await f.$eval('.spider-handle[data-spider-axis="controversy"]',
   el=>Number(el.getAttribute('aria-valuenow'))),5);
 await f.$eval('.spider-handle[data-spider-axis="democraticUrgency"]',el=>el.focus());
 await f.keyboard.press('End');
 await f.$eval('.spider-handle[data-spider-axis="intellectualImportance"]',el=>el.focus());
 await f.keyboard.press('End');
 await f.keyboard.press('ArrowLeft'); // 4/5
 await f.$eval('.spider-handle[data-spider-axis="spamLikelihood"]',el=>el.focus());
 await f.keyboard.press('ArrowRight');
 await f.click('.spider-submit');
 const ownRatings=async()=>f.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return (await getItem(db,'records')||[])
     .filter(x=>x.payload.kind==='content-rating');}
   finally{db.close();}
 });
 await eventually(async()=>{
   const signed=await ownRatings();return signed.length>0&&signed.at(-1).payload.body.age===3&&
     signed.at(-1).payload.body.axes.controversy===5;
 },'reader dragged and keyboard-edited real signed spider rating',15000);
 assert.equal(await f.$('.spider-popup'),null,'popup closes after signed submission');
 // The exceptional democratic-public-interest alert belongs in Report, not
 // inside the five-dimensional spider editor, and must not modify age/axes.
 await f.click('.report-control > summary');
 const hasAlert=await f.$eval('.report-control select',el=>
   [...el.options].some(x=>x.value==='public-interest-censorship-pressure'));
 assert.equal(hasAlert,true);
 await f.$eval('.report-control select',el=>{
   el.value='public-interest-censorship-pressure';
   el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 assert.equal(await f.$eval('.report-control .report-submit',el=>el.textContent),
   'Sign public-interest alert');
 await f.$eval('.report-control textarea',el=>{
   el.value='Documented public-interest reporting with substantial censorship pressure.';
 });
 await f.click('.report-control .report-submit');
 await eventually(()=>f.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return (await getItem(db,'records')||[]).some(e=>
     e.payload.kind==='label'&&
     e.payload.body.tag==='public-interest-censorship-pressure');}
   finally{db.close();}
 }), 'signed public-interest warning as separate report menu label',12000);
 assert.equal((await ownRatings()).length,1,
   'the public-interest flag MUST NOT create or overwrite an age/spider rating');
 assert.equal(await f.$eval('#ratingsEnable',el=>el.checked),false,
   'publishing a rating never silently enables censorship');
 await f.evaluate(()=>{
   document.querySelector('#ratingsBlurVotes').value='1';
   document.querySelector('#ratingsHideVotes').value='2';
   const enable=document.querySelector('#ratingsEnable');
   enable.checked=true;enable.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await eventually(()=>f.evaluate(title=>[...document.querySelectorAll('#imageGrid .post')]
   .some(tile=>tile.querySelector('.post-headline')?.textContent===title&&
     tile.classList.contains('rating-media-blur')),sampleImage.title),
   'one viewer-approved signed 18+ vote blurs under reader-adjusted threshold',10000);
 const savedRules=await f.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return await getItem(db,'classic-reader-rating-rules-v1');}
   finally{db.close();}
 });
 assert.equal(savedRules.active,true);
 assert.equal(savedRules.blurVotes,1);
 assert.equal(savedRules.hideVotes,2);
 // Hide must prevent a media fetch, not merely cover bytes already loaded.
 await f.evaluate(()=>{
   const el=document.querySelector('#ratingsHideVotes');
   el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await eventually(()=>f.evaluate(title=>{
   const tile=[...document.querySelectorAll('#imageGrid .post')]
     .find(x=>x.querySelector('.post-headline')?.textContent===title);
   return tile?.classList.contains('rating-media-hide')&&
     !tile.querySelector('img.post-thumb')&&
     !!document.querySelector('.rating-hidden-placeholder')&&
     !document.querySelector('.post-main-media img');
 },sampleImage.title),'hidden age-rated media is not fetched for local preview',10000);
 // Earlier tool-driven preference updates preserve scroll, so the reveal
 // action may start well above the viewport. Move to the actual control
 // before performing a genuine pointer click, as a reader would.
 await f.$eval('.rating-reveal-control button',el=>
   el.scrollIntoView({block:'center',behavior:'instant'}));
 await f.click('.rating-reveal-control button');
 try{
   await eventually(()=>f.evaluate(()=>!!document.querySelector('.post-main-media img')),
     'local explicit reveal restores media without altering signed record',10000);
 }catch(error){
   const detail=await f.evaluate(()=>({
     selected:document.querySelector('.post.selected')?.dataset.id,
     panelCount:document.querySelectorAll('.post-container.expanded').length,
     reveal:document.querySelector('.rating-reveal-control')?.textContent,
     media:document.querySelector('.post-main-media')?.innerHTML.slice(0,1800),
     tiles:[...document.querySelectorAll('#imageGrid .post')].slice(0,2).map(x=>x.className),
     trace:document.querySelector('#toast')?.textContent
   }));
   console.error('SPIDER_REVEAL_DIAGNOSTIC',JSON.stringify(detail));
   throw error;
 }
 const rootRating=await ownRatings();
 assert.ok(rootRating[0].id.startsWith('sha256:'));
 // Group reputation & self-nomination stay public but have no automatically
 // delegated reviewer rights or punishment of an entire group's members.
 await f.click('#clansButton');
 await eventually(()=>f.evaluate(()=>document.querySelectorAll('#groupList .group-entry').length>=2),
   'independently signed groups visible for voluntary review',10000);
 assert.ok(await f.$eval('#groupList .group-entry',el=>
   !!el.querySelector('.group-reputation-panel')&&
   [...el.querySelectorAll('button')].some(x=>/Volunteer to review/.test(x.textContent))));
 await f.$eval('#groupList .group-entry',el=>{
   const button=[...el.querySelectorAll('button')].find(x=>/Volunteer to review/.test(x.textContent));
   button.click();
 });
 await eventually(()=>f.evaluate(async()=>{
   const {openLocal,getItem}=await import('./core/persist.js');
   const db=await openLocal();
   try{return (await getItem(db,'records')||[])
     .some(e=>e.payload.kind==='reviewer-candidacy');}
   finally{db.close();}
 }), 'signed reviewer candidacy without role authority',10000);
 await f.click('#closeClans');
 console.log('CLASSIC checkpoint 25: tiny score-adjacent spider popup with mouse-drag and keyboard signing, flag-menu civic alert, opt-in age blur and group candidacy');

 console.log('PASS classic board, threads, audit, attributes, identity portability and append-only revision/withdrawal');
}finally{
 try{await browser?.close();}catch{}
 for(const server of servers)await new Promise(resolve=>server.close(resolve));
 try{await bridge?.close();}catch{}
 try{await mediaGateway?.close();}catch{}
 try{await index?.close();}catch{}
 try{await orbitdb?.stop();}catch{}
 try{await helia?.stop();}catch{}
 try{await libp2p?.stop();}catch{}
 await rm(base,{recursive:true,force:true});
}