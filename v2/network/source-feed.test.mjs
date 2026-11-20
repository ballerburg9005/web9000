import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket,WebSocketServer} from 'ws';
import {generateIdentity,signEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {signSourceFeed,verifySourceFeed,classifyObservedIp,parseNetworkIp}
 from './source-feed.js';
import {signSourceReceipt,verifySourceReceipt} from './source-receipt.js';
import {loadPeerSourceObserver} from './node-source-observer.mjs';
import {createBrowserBridge} from './browser-bridge.mjs';
import {BrowserPeerMesh,parseSourcePins} from './browser-mesh.js';

const now=Date.now();
const row=(cidr,networkKind='vpn',country='DE',asn='AS64500')=>({
 cidr,networkKind,country,asn
});
const body=(revision,rules)=>({version:1,revision,
 issuedAt:now-10000,expiresAt:now+86400000,rules});
const until=async(test,what,ms=6500)=>{
 const deadline=Date.now()+ms;
 while(Date.now()<deadline){
  if(await test())return;
  await sleep(20);
 }
 throw Error('Timed out waiting for '+what);
};
const observer=()=>generateIdentity({extractable:true});

test('signed, independently pinned IPv4/IPv6 country/ASN/VPN lists use most-specific prefixes and reject forgery or rollback',async()=>{
 const signer=await observer(),other=await observer();
 const rules=[
  row('127.0.0.0/8','residential','US','AS64501'),
  row('127.0.0.0/16','vpn','DE','AS64502'),
  row('2001:db8::/32','datacenter','FR','AS64503'),
  row('2001:db8:aaaa::/48','mobile','PL','AS64504')
 ];
 const feed=await signSourceFeed(signer,body(4,rules));
 const verified=await verifySourceFeed(feed,{expectedIssuer:signer.author,now});
 assert.equal(verified.valid,true,JSON.stringify(verified));
 assert.deepEqual(classifyObservedIp('127.0.0.1',verified),{
  networkKind:'vpn',country:'DE',asn:'AS64502',matched:true,
  reason:'verified-operator-source-feed'
 });
 assert.equal(classifyObservedIp('127.1.0.1',verified).networkKind,'residential');
 assert.equal(classifyObservedIp('2001:db8:aaaa::1',verified).networkKind,'mobile');
 assert.equal(classifyObservedIp('2001:db8:beef::1',verified).networkKind,'datacenter');
 assert.equal(classifyObservedIp('::ffff:127.0.0.1',verified).networkKind,'vpn');
 assert.equal(classifyObservedIp('8.8.8.8',verified).networkKind,'unknown');
 assert.equal(classifyObservedIp('8.8.8.8',null).reason,'no-verified-source-feed');
 assert.equal(parseNetworkIp('2001:db8:::1'),null);
 assert.equal((await verifySourceFeed(feed,{expectedIssuer:other.author,now})).valid,false);
 assert.equal((await verifySourceFeed(feed,{
   expectedIssuer:signer.author,now,minimumRevision:5})).valid,false);
 const tampered=structuredClone(feed);
 tampered.body.rules[0].networkKind='vpn';
 assert.equal((await verifySourceFeed(tampered,{
   expectedIssuer:signer.author,now})).valid,false);
 await assert.rejects(signSourceFeed(signer,body(5,[
  row('127.0.0.1/24')
 ])),/Invalid/,'arbitrary host bits cannot create equivalent duplicate ranges');
 await assert.rejects(signSourceFeed(signer,body(5,[
  row('127.0.0.0/16'),row('127.0.0.0/16')
 ])),/conflicting/);
 await assert.rejects(signSourceFeed(signer,body(5,[
  row('2001:db8::/32','vpn'),
  row('2001:0db8:0000:0000:0000:0000:0000:0000/32','residential')
 ])),/conflicting/,'equivalent IPv6 spellings cannot create different votes');
});

test('short-lived observations are signed by the accepting node, bound to exact signed record, and never expose a raw IP',async()=>{
 const signer=await observer(),stranger=await observer(),author=await observer();
 const event=await signEvent(author,{body:{
  title:'Independent signed event',text:'Origin label is a separate claim'
 }});
 const attestation=await signSourceReceipt(signer,{
  eventId:event.id,observedAt:now,ttlMs:120000,
  hop:'direct-socket',networkKind:'vpn',country:'DE',
  asn:'AS64500',feedDigest:'a'.repeat(64)
 });
 assert.ok(!JSON.stringify(attestation).includes('127.0.0.1'));
 assert.equal((await verifySourceReceipt(attestation,{
  expectedIssuer:signer.author,eventId:event.id,now})).resourceClass,
  'concentrated');
 assert.equal((await verifySourceReceipt(attestation,{
  expectedIssuer:stranger.author,eventId:event.id,now})).valid,false);
 assert.equal((await verifySourceReceipt(attestation,{
  expectedIssuer:signer.author,eventId:'sha256:'+'0'.repeat(64),now})).valid,false);
 assert.equal((await verifySourceReceipt(attestation,{
  expectedIssuer:signer.author,eventId:event.id,now:now+120001})).valid,false);
 const altered=structuredClone(attestation);
 altered.body.country='US';
 assert.equal((await verifySourceReceipt(altered,{
  expectedIssuer:signer.author,eventId:event.id,now})).valid,false);
 const alteredHop=structuredClone(attestation);
 alteredHop.body.hop='relay';
 assert.equal((await verifySourceReceipt(alteredHop,{
  expectedIssuer:signer.author,eventId:event.id,now})).valid,false);
});

test('optional observing-peer key and signed list load only from private operator-owned file; user-provided keys cannot claim another publisher',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-operator-source-'));
 const signer=await observer(),other=await observer();
 try{
  const key=Buffer.from(await crypto.subtle.exportKey('pkcs8',signer.privateKey)).toString('base64');
  const feed=await signSourceFeed(signer,body(1,[row('127.0.0.0/8')]));
  const file=path.join(dir,'observer.json');
  const config={issuer:signer.author,pkcs8:key,feed};
  await writeFile(file,JSON.stringify(config),{mode:0o600});
  assert.equal((await loadPeerSourceObserver(file)).feedIssuer,signer.author);
  await chmod(file,0o644);
  await assert.rejects(loadPeerSourceObserver(file),/0600/);
  await chmod(file,0o600);
  await writeFile(file,JSON.stringify({...config,issuer:other.author}));
  await assert.rejects(loadPeerSourceObserver(file),/does not match/);
  await writeFile(file,JSON.stringify({...config,feed:{
    ...feed,issuer:other.author}}));
  await assert.rejects(loadPeerSourceObserver(file),/must be independently signed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

function fakeIndex(){
 const records=[],subscribers=new Set();
 return {
  address:'/orbitdb/signed-observer-lab-index',
  publish:async e=>{
   records.push(e);
   for(const cb of subscribers)await cb(e);
   return e.id;
  },
  loadInto:async replica=>{
   for(const e of records)await replica.ingest(e);
   return [];
  },
  onUpdate:callback=>{subscribers.add(callback);return ()=>subscribers.delete(callback);}
 };
}
test('two actual browser WebSockets receive signed source-feed updates and classify only an explicitly pinned observer, not X-Real-IP spoofing',async()=>{
 const signer=await observer(),author=await observer();
 const initial=await signSourceFeed(signer,body(1,[
  row('127.0.0.0/8','residential','US','AS64502')
 ]));
 const bridge=await createBrowserBridge({
  index:fakeIndex(),replica:new Replica(),port:0,
  sourceObserver:{signer,feed:initial,feedIssuer:signer.author}
 });
 const signed=[],unknown=[],feedRevisions=[],errors=[];
 const trusted=new BrowserPeerMesh({
  WebSocketImpl:WebSocket,
  onEvent:async event=>signed.push(event.id),
  onSource:event=>signed.push('source:'+event.networkKind+':'+event.eventId),
  onSourceFeed:feed=>feedRevisions.push(feed.revision),
  onError:(url,e)=>errors.push(String(e))
 });
 const plain=new BrowserPeerMesh({
  WebSocketImpl:WebSocket,
  onEvent:async event=>unknown.push(event.id),
  onSource:event=>unknown.push('unexpected:'+event.networkKind)
 });
 const writer=new BrowserPeerMesh({WebSocketImpl:WebSocket});
 try{
  assert.deepEqual(parseSourcePins(bridge.url+' '+signer.author),
    {[bridge.url]:signer.author});
  assert.throws(()=>parseSourcePins(bridge.url+' ed25519:garbage'),/requires/);
  trusted.connect([bridge.url],{
   sourcePins:{[bridge.url]:signer.author}
  });
  plain.connect([bridge.url]);
  writer.connect([bridge.url]);
  await until(()=>trusted.connected===1&&plain.connected===1&&writer.connected===1,
    'three accepted browser WebSocket connections');
  await until(()=>feedRevisions.includes(1),'initial signed source list');
  const first=await signEvent(author,{body:{
   title:'Plain consumer has unknown tier',text:'Both browsers see the event'
  }});
  writer.publish(first);
  await until(()=>signed.includes(first.id)&&unknown.includes(first.id),
    'both browser clients receive first event');
  await until(()=>signed.includes('source:residential:'+first.id),
    'pinned observer signed source class');
  assert.ok(!unknown.some(x=>x.startsWith('unexpected:')),
    'no automatically trusted source key');
  const updated=await signSourceFeed(signer,body(2,[
   row('127.0.0.0/8','vpn','DE','AS64503')
  ]));
  await bridge.updateSourceFeed(updated);
  await until(()=>feedRevisions.includes(2),'operator-signed source feed update via WebSocket');
  const second=await signEvent(author,{body:{
   title:'After operator list revision',text:'Same IP, different local compartment'
  }});
  writer.publish(second);
  await until(()=>signed.includes('source:vpn:'+second.id),
    'pinned source observation uses new signed network range list');
  assert.ok(!unknown.some(x=>x.startsWith('unexpected:')));
  assert.deepEqual(errors,[]);
  // Unsafe operator identity swaps at the same URL must not be silently
  // accepted just because a later hello packet claims another signer.
  await assert.rejects(bridge.updateSourceFeed(initial),/rejected/);
 }finally{
  trusted.disconnect();plain.disconnect();writer.disconnect();
  await bridge.close();
 }
});

test('direct socket IP wins over forged X-Real-IP headers when observer has no pinned proxy',async()=>{
 const signer=await observer(),author=await observer();
 const feed=await signSourceFeed(signer,body(1,[
  row('127.0.0.0/8','residential','US','AS64501'),
  row('198.51.100.0/24','vpn','DE','AS64502')
 ]));
 const bridge=await createBrowserBridge({index:fakeIndex(),port:0,
  sourceObserver:{signer,feed,feedIssuer:signer.author}});
 let client;
 try{
  client=new WebSocket(bridge.url,{headers:{'X-Real-IP':'198.51.100.99',
   'X-Forwarded-For':'198.51.100.100'}});
  await new Promise((resolve,reject)=>{
   client.once('open',resolve);client.once('error',reject);
  });
  const received=[];
  client.on('message',raw=>{
   const msg=JSON.parse(raw.toString());
   if(msg.type==='source-receipt')received.push(msg.receipt);
  });
  const event=await signEvent(author,{body:{
   title:'Forged IP header cannot assign a VPN compartment',
   text:'The direct socket is 127.0.0.1'
  }});
  client.send(JSON.stringify({type:'publish',event}));
  await until(()=>received.length===1,'signed direct socket observation');
  const verified=await verifySourceReceipt(received[0],{
   expectedIssuer:signer.author,eventId:event.id,now:Date.now()
  });
  assert.equal(verified.valid,true);
  assert.equal(verified.hop,'direct-socket');
  assert.equal(verified.networkKind,'residential');
  assert.equal(verified.country,'US');
 }finally{
  client?.terminate();await bridge.close();
 }
});

test('browser defers saturated VPN history without blocking independently attested residential live records',async()=>{
 const signer=await observer(),author=await observer();
 const feed=await signSourceFeed(signer,body(1,[
  row('127.0.0.0/8','vpn','DE','AS64500')
 ]));
 const feedVerified=await verifySourceFeed(feed,{
  expectedIssuer:signer.author,now
 });
 assert.equal(feedVerified.valid,true);
 const vpn=[],receipts=[];
 for(let i=0;i<51;i++){
  const e=await signEvent(author,{body:{
   title:'VPN history '+i,text:'Independently signed original metadata'
  }});
  vpn.push(e);
  receipts.push(await signSourceReceipt(signer,{
   eventId:e.id,observedAt:now,ttlMs:600000,
   hop:'direct-socket',networkKind:'vpn',country:'DE',
   asn:'AS64500',feedDigest:feedVerified.digest
  }));
 }
 const residential=await signEvent(author,{body:{
  title:'Unrelated legitimate residential source remains available',
  text:'An exhausted VPN box must not close the whole peer.'
 }});
 const homeReceipt=await signSourceReceipt(signer,{
  eventId:residential.id,observedAt:now,ttlMs:600000,
  hop:'direct-socket',networkKind:'residential',country:'FR',
  asn:'AS64501',feedDigest:feedVerified.digest
 });
 const received=[],traces=[],errors=[];
 const server=new WebSocketServer({host:'127.0.0.1',port:0,
  perMessageDeflate:false});
 await new Promise(resolve=>server.once('listening',resolve));
 let step=0,wsServer=null;
 server.on('connection',ws=>{
  wsServer=ws;
  ws.send(JSON.stringify({type:'hello',sourceObserver:signer.author}));
  ws.send(JSON.stringify({type:'source-feed',document:feed}));
  ws.on('message',raw=>{
   const msg=JSON.parse(raw.toString());
   if(msg.type!=='sync')return;
   if(step===0){
    step=1;
    ws.send(JSON.stringify({type:'batch',
     events:vpn.slice(0,32),sourceReceipts:receipts.slice(0,32),
     next:'sha256:'+'a'.repeat(64)}));
   }else if(step===1){
    step=2;
    ws.send(JSON.stringify({type:'batch',
     events:vpn.slice(32),sourceReceipts:receipts.slice(32),
     next:null}));
    // The server sends a different attested class after overfilling
    // a VPN historical page. This must still be accepted.
    ws.send(JSON.stringify({type:'event',event:residential,
     sourceReceipt:homeReceipt}));
   }
  });
 });
 const url='ws://127.0.0.1:'+server.address().port+'/';
 const mesh=new BrowserPeerMesh({WebSocketImpl:WebSocket,
  now:()=>now,onEvent:async e=>received.push(e.id),
  onPacket:p=>traces.push(p.direction),
  onError:(_,e)=>errors.push(String(e))
 });
 try{
  mesh.connect([url],{sourcePins:{[url]:signer.author}});
  await until(()=>received.includes(residential.id),'independent residential record');
  assert.equal(received.filter(id=>vpn.some(e=>e.id===id)).length,48,
   'exhausted concentrated network box must defer the remainder');
  assert.equal(mesh.connected,1,'VPN compartment overload must not disconnect other categories');
  assert.ok(traces.includes('source-deferred'));
  assert.deepEqual(errors,[]);
 }finally{
  mesh.disconnect();wsServer?.terminate();
  await new Promise(resolve=>server.close(resolve));
 }
});

test('operator can atomically sign and update an IP rule list without disclosing signing key to browser',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {readFile,stat}=await import('node:fs/promises');
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-source-operator-cli-'));
 try{
  const config=path.join(dir,'observer.json'),rules=path.join(dir,'rules.json');
  const cli=new URL('./source-feed-operator.mjs',import.meta.url).pathname;
  await writeFile(rules,JSON.stringify([
   row('127.0.0.0/8','residential','US','AS64501')
  ]));
  let result=spawnSync(process.execPath,[cli,'init',config,rules],{
   encoding:'utf8',timeout:12000
  });
  assert.equal(result.status,0,result.stderr);
  const original=JSON.parse(await readFile(config,'utf8'));
  assert.equal((await stat(config)).mode&0o077,0);
  assert.equal(original.feed.body.revision,1);
  assert.equal((await verifySourceFeed(original.feed,{
   expectedIssuer:original.issuer,now:Date.now()})).valid,true);
  await writeFile(rules,JSON.stringify([
   row('127.0.0.0/8','vpn','DE','AS64502')
  ]));
  result=spawnSync(process.execPath,[cli,'update',config,rules],{
   encoding:'utf8',timeout:12000
  });
  assert.equal(result.status,0,result.stderr);
  const updated=JSON.parse(await readFile(config,'utf8'));
  assert.equal(updated.issuer,original.issuer);
  assert.equal(updated.pkcs8,original.pkcs8);
  assert.equal(updated.feed.body.revision,2);
  assert.equal((await verifySourceFeed(updated.feed,{
   expectedIssuer:updated.issuer,minimumRevision:2,now:Date.now()})).valid,true);
  result=spawnSync(process.execPath,[cli,'init',config,rules],{
   encoding:'utf8',timeout:12000
  });
  assert.notEqual(result.status,0,
   'init cannot overwrite a previous private signing identity');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('accepting peer charges VPN /24 before Ed25519 verification and keeps independently observed residential connections open',async()=>{
 const signer=await observer(),author=await observer();
 const feed=await signSourceFeed(signer,body(1,[
  row('198.51.100.0/24','vpn','DE','AS64500'),
  row('203.0.113.0/24','residential','PL','AS64501')
 ]));
 const bridge=await createBrowserBridge({
  index:fakeIndex(),port:0,
  sourceObserver:{signer,feed,feedIssuer:signer.author,
    trustedProxyAddress:'127.0.0.1'}
 });
 const vpn=new WebSocket(bridge.url,{headers:{
  'X-Real-IP':'198.51.100.44','X-Forwarded-For':'203.0.113.23'
 }});
 const home=new WebSocket(bridge.url,{headers:{
  'X-Real-IP':'203.0.113.45','X-Forwarded-For':'198.51.100.44'
 }});
 try{
  await Promise.all([vpn,home].map(ws=>new Promise((resolve,reject)=>{
   if(ws.readyState===WebSocket.OPEN)return resolve();
   ws.once('open',resolve);ws.once('error',reject);
  })));
  const replies=[];
  vpn.on('message',raw=>{
   const msg=JSON.parse(raw.toString());
   if(msg.type==='reject')replies.push(msg.reason);
  });
  const forged=JSON.stringify({type:'publish',event:{
    id:'sha256:'+'1'.repeat(64),signature:'invalid',
    payload:{kind:'post',author:author.author,body:{
      title:'Unverified attempt',text:'Invalid Ed25519 signature'
    }}
  }});
  for(let i=0;i<16;i++)vpn.send(forged);
  await until(()=>replies.length===16,'all VPN attempts refused');
  assert.equal(replies.filter(x=>x==='bad signature or envelope').length,12);
  assert.equal(replies.filter(x=>x.includes('temporarily full')).length,4,
   'source network /24 is throttled before signature verification');
  const homeResponses=[];
  home.on('message',raw=>{
   const msg=JSON.parse(raw.toString());
   if(['ack','source-receipt'].includes(msg.type))homeResponses.push(msg);
  });
  const legitimate=await signEvent(author,{body:{
   title:'Residential publication remains possible',
   text:'Country and VPN status are input resource compartments, not global labels.',
   fields:{claimedNetworkKind:'vpn',claimedCountry:'DE'}
  }});
  home.send(JSON.stringify({type:'publish',event:legitimate}));
  await until(()=>homeResponses.some(x=>x.type==='ack')&&
    homeResponses.some(x=>x.type==='source-receipt'),
    'independent residential source accepted after VPN exhaustion');
  const receipt=homeResponses.find(x=>x.type==='source-receipt').receipt;
  const observation=await verifySourceReceipt(receipt,{
   expectedIssuer:signer.author,eventId:legitimate.id,now:Date.now()
  });
  assert.equal(observation.valid,true);
  assert.equal(observation.networkKind,'residential');
  assert.equal(observation.country,'PL');
  assert.equal(observation.hop,'trusted-proxy');
 }finally{
  vpn.terminate();home.terminate();await bridge.close();
 }
});
