import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity} from '../core/events.js';
import {signSourceFeed,verifySourceFeed} from './source-feed.js';
import {
 signSourceFeedBundle,verifySourceFeedManifest,verifySourceFeedChunk,
 assembleSourceFeedBundle,verifySourceFeedBundle,MAX_FEED_CHUNKS
} from './source-feed-bundle.js';

const now=1730000000000;
const identity=()=>generateIdentity({extractable:true});
const rule=i=>({
 cidr:'198.'+Math.floor(i/65536)+'.'+Math.floor(i/256)%256+'.'+(i%256)+'/32',
 networkKind:i%3?'vpn':'datacenter',country:'DE',asn:'AS64500'
});
// Source network labels intentionally may be only /24 or coarser.
// 198.0.0.0/24 through 198.11.255.0/24, all are unique.
const r=i=>({
 cidr:'198.'+Math.floor(i/256)+'.'+(i%256)+'.0/24',
 networkKind:i%3?'vpn':'datacenter',
 country:i%2?'FR':'DE',asn:'AS64500'
});
test('one signed manifest commits multiple independently signed bounded source chunks without opening extra OrbitDB databases',async()=>{
 const signer=await identity(),other=await identity(),rules=Array.from({length:3100},(_,i)=>r(i));
 const bundle=await signSourceFeedBundle(signer,{
  revision:8,issuedAt:now-1000,expiresAt:now+3600000,rules
 },{maxChunkBytes:18000});
 assert.ok(bundle.chunks.length>=10&&bundle.chunks.length<=MAX_FEED_CHUNKS);
 assert.equal(bundle.manifest.issuer,signer.author);
 const verified=await verifySourceFeedBundle(bundle,{
  expectedIssuer:signer.author,now,minimumRevision:8
 });
 assert.equal(verified.valid,true,verified.reason);
 assert.equal(verified.rules.length,3100);
 assert.equal(verified.revision,8);
 assert.equal(verified.format,'chunked-v2');
 const manifest=await verifySourceFeedManifest(bundle.manifest,{
  expectedIssuer:signer.author,minimumRevision:8,now
 });
 assert.equal(manifest.valid,true);
 const checked=[];
 for(let i=0;i<bundle.chunks.length;i++){
  const chunk=await verifySourceFeedChunk(bundle.chunks[i],{
   manifest,index:i,now
  });
  assert.equal(chunk.valid,true,chunk.reason);
  checked.push(chunk);
 }
 assert.equal(assembleSourceFeedBundle(manifest,checked).digest,verified.digest);
 assert.equal((await verifySourceFeedManifest(bundle.manifest,{
  expectedIssuer:other.author,now
 })).valid,false);
 assert.equal((await verifySourceFeedBundle(bundle,{
  expectedIssuer:signer.author,minimumRevision:9,now
 })).valid,false,'rollback prevention applies to the whole manifest');
 assert.equal((await verifySourceFeedBundle(bundle,{
  expectedIssuer:signer.author,now:now+4000000
 })).valid,false,'expiry applies to the whole manifest');
 const fewer={manifest:bundle.manifest,chunks:bundle.chunks.slice(1)};
 assert.equal((await verifySourceFeedBundle(fewer,{
  expectedIssuer:signer.author,now
 })).valid,false);
 const switched=structuredClone(bundle);
 switched.chunks[0]=switched.chunks[1];
 assert.equal((await verifySourceFeedBundle(switched,{
  expectedIssuer:signer.author,now
 })).valid,false,'a valid but wrong committed chunk must be rejected');
 const changed=structuredClone(bundle);
 changed.chunks[1].body.rules[0].country='US';
 assert.equal((await verifySourceFeedBundle(changed,{
  expectedIssuer:signer.author,now
 })).valid,false,'a changed rule without a new operator signature must fail');
 const stale=structuredClone(bundle);
 stale.manifest.body.revision=10;
 assert.equal((await verifySourceFeedBundle(stale,{
  expectedIssuer:signer.author,now
 })).valid,false);
});
test('source prefix conflicts across signed chunks are rejected even with correctly signed manifest',async()=>{
 const signer=await identity();
 const first={version:1,revision:3,issuedAt:now-1000,expiresAt:now+3600000,
  rules:[r(0)]},second={...first,rules:[{...r(0),cidr:'198.0.0.0/24',
   country:'US'}]};
 const a=await signSourceFeed(signer,first);
 const b=await signSourceFeed(signer,second);
 // Use the same signing function on the entire rule list; it must detect
 // a conflict before issuing any manifest even if each chunk is valid.
 await assert.rejects(signSourceFeedBundle(signer,{
  revision:3,issuedAt:now-1000,expiresAt:now+3600000,
  rules:[a.body.rules[0],b.body.rules[0]]
 },{maxChunkBytes:8192}),/Duplicate/);
});

import {WebSocket} from 'ws';
import {Replica} from '../core/replica.js';
import {signEvent} from '../core/events.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {BrowserPeerMesh} from './browser-mesh.js';
import {setTimeout as sleep} from 'node:timers/promises';

async function until(fn,what,ms=12000){
 const deadline=Date.now()+ms;
 while(Date.now()<deadline){
  if(await fn())return;
  await sleep(25);
 }
 throw Error('Timeout: '+what);
}
function fakeIndex(){
 const records=[],subscribers=new Set();
 return {address:'/orbitdb/multipart-source-test',
  publish:async event=>{
   records.push(event);
   for(const cb of subscribers)await cb(event);
   return event.id;
  },
  loadInto:async mirror=>{for(const e of records)await mirror.ingest(e);},
  onUpdate:cb=>{subscribers.add(cb);return ()=>subscribers.delete(cb);}
 };
}
test('browser retrieves large signed source feed chunk-by-chunk, commits it atomically, and hot-updates while accepting signed posts',async()=>{
 const signer=await identity(),writer=await identity();
 const t=Date.now(),rules=Array.from({length:1500},(_,i)=>r(i));
 rules.push({cidr:'127.0.0.0/8',networkKind:'residential',
  country:'US',asn:'AS64501'});
 const bundle=await signSourceFeedBundle(signer,{
  revision:10,issuedAt:t-1000,expiresAt:t+3600000,rules
 },{maxChunkBytes:14000});
 assert.ok(bundle.chunks.length>3);
 const bridge=await createBrowserBridge({index:fakeIndex(),
  replica:new Replica(),port:0,
  sourceObserver:{signer,feed:bundle,feedIssuer:signer.author}
 });
 const delivered=[],classifications=[],feedUpdates=[],problems=[];
 const browser=new BrowserPeerMesh({WebSocketImpl:WebSocket,
  onEvent:async event=>delivered.push(event.id),
  onSource:obs=>classifications.push(obs),
  onSourceFeed:feed=>feedUpdates.push({
   revision:feed.revision,length:feed.rules.length,digest:feed.digest
  }),
  onError:(_,error)=>problems.push(String(error))
 });
 const publisher=new BrowserPeerMesh({WebSocketImpl:WebSocket});
 try{
  browser.connect([bridge.url],{
   sourcePins:{[bridge.url]:signer.author}
  });
  publisher.connect([bridge.url]);
  await until(()=>feedUpdates.length===1,'complete signed multipart source feed');
  assert.deepEqual(feedUpdates[0],{
   revision:10,length:rules.length,digest:(await verifySourceFeedManifest(bundle.manifest,{
    expectedIssuer:signer.author,now:Date.now()
   })).digest
  });
  const first=await signEvent(writer,{body:{
   title:'Original signed record unaffected by source list transport',
   text:'This publication remains independently verifiable.'
  }});
  publisher.publish(first);
  await until(()=>delivered.includes(first.id)&&
   classifications.some(x=>x.eventId===first.id),
   'signed source receipt accompanying original publication');
  assert.equal(classifications.find(x=>x.eventId===first.id).networkKind,'residential');
  const changed=[...rules];
  changed[changed.length-1]={...changed[changed.length-1],
   networkKind:'vpn',country:'DE'};
  const bundle2=await signSourceFeedBundle(signer,{
   revision:11,issuedAt:t,expiresAt:t+3600000,rules:changed
  },{maxChunkBytes:14000});
  await bridge.updateSourceFeed(bundle2);
  await until(()=>feedUpdates.some(x=>x.revision===11),
   'hot-pushed complete new source manifest and chunks');
  const second=await signEvent(writer,{body:{
   title:'New classification but same independently authored record',
   text:'The operator can refresh the network intelligence.'
  }});
  publisher.publish(second);
  await until(()=>classifications.some(x=>x.eventId===second.id),
   'source receipt for new signed revision');
  assert.equal(classifications.find(x=>x.eventId===second.id).networkKind,'vpn');
  assert.equal(browser.sourceCheckpoints[bridge.url].revision,11);
  assert.deepEqual(problems,[]);
 }finally{
  browser.disconnect();publisher.disconnect();await bridge.close();
 }
});

import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {loadPeerSourceObserver} from './node-source-observer.mjs';

test('existing operator key automatically upgrades its feed to signed multipart and updates it without key rotation',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'w9-feed-multipart-cli-'));
 try{
  const config=path.join(folder,'private-observer.json');
  const rulesFile=path.join(folder,'rules.json');
  const cli=new URL('./source-feed-operator.mjs',import.meta.url).pathname;
  const invoke=mode=>{
   const result=spawnSync(process.execPath,[cli,mode,config,rulesFile],{
    encoding:'utf8',timeout:20000
   });
   assert.equal(result.status,0,result.stderr);
   return JSON.parse(result.stdout);
  };
  const small=[r(0)];
  await writeFile(rulesFile,JSON.stringify(small));
  const a=invoke('init');
  assert.equal(a.format,'signed-v1');
  assert.equal(a.revision,1);
  const first=JSON.parse(await readFile(config,'utf8'));
  assert.equal((await stat(config)).mode&0o077,0);
  const many=Array.from({length:2500},(_,i)=>r(i));
  await writeFile(rulesFile,JSON.stringify(many));
  const b=invoke('update');
  assert.equal(b.format,'signed-multipart-v2');
  assert.ok(b.chunks>1);
  assert.equal(b.revision,2);
  const second=JSON.parse(await readFile(config,'utf8'));
  assert.equal(second.issuer,first.issuer);
  assert.equal(second.pkcs8,first.pkcs8);
  const checked=await loadPeerSourceObserver(config);
  assert.equal(checked.feedIssuer,first.issuer);
  assert.equal(checked.feed.manifest.body.revision,2);
  assert.equal((await verifySourceFeedBundle(second.feed,{
   expectedIssuer:first.issuer,now:Date.now(),minimumRevision:2
  })).rules.length,many.length);
  await writeFile(rulesFile,JSON.stringify(many.slice(0,4)));
  const c=invoke('update');
  assert.equal(c.format,'signed-v1');
  assert.equal(c.revision,3);
  assert.equal((await loadPeerSourceObserver(config)).feed.body.revision,3);
 }finally{
  await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
