import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {WebSocket} from 'ws';
import {setTimeout as sleep} from 'node:timers/promises';
import {generateIdentity,canonical} from '../core/events.js';
import {signSourceFeed,verifySourceFeed} from './source-feed.js';
import {signSourceProvenance,verifySourceProvenance,digestRules} from './source-provenance.js';
import {loadPeerSourceObserver} from './node-source-observer.mjs';
import {createBrowserBridge} from './browser-bridge.mjs';
import {BrowserPeerMesh} from './browser-mesh.js';

const hash=data=>createHash('sha256').update(data).digest('hex');
const origin='https://data.example.org/iptoasn-v4.tsv.gz';
const rule={cidr:'198.51.100.0/24',networkKind:'vpn',country:'DE',asn:'AS64500'};
const metadata=(data,filename,at)=>({
 category:'iptoasn',uri:origin,license:'PDDL-1.0',
 sha256:hash(data),bytes:Buffer.byteLength(data),retrievedAt:at,file:filename
});
const cli=new URL('./source-feed-operator.mjs',import.meta.url).pathname;
function signCli(mode,config,rules,sources){
 const r=spawnSync(process.execPath,
  [cli,mode,config,rules,...(sources?['--sources',sources]:[])],
  {encoding:'utf8',timeout:25000});
 return r;
}
async function eventually(test,label){
 const end=Date.now()+5000;
 while(Date.now()<end){if(await test())return;await sleep(25);}
 throw Error('Timed out '+label);
}
function fakeIndex(){
 const subscribers=new Set();
 return {address:'/orbitdb/provenance-test',
  publish:async e=>{for(const callback of subscribers)await callback(e);return e.id;},
  loadInto:async()=>[],
  onUpdate:callback=>{subscribers.add(callback);return ()=>subscribers.delete(callback);}
 };
}
test('private snapshots are SHA256-pinned before signing and the output binds exact signed rules to declared provenance',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-provenance-'));
 const config=path.join(dir,'observer.json'),rulesPath=path.join(dir,'rules.json'),
  sourcePath=path.join(dir,'source.tsv.gz'),sourcesPath=path.join(dir,'snapshots.json');
 const data=Buffer.from('198.51.100.0\t198.51.100.255\t64500\tDE\tunit-test\n');
 const now=Date.now();
 try{
  await writeFile(sourcePath,data);
  await writeFile(rulesPath,JSON.stringify([rule]));
  const snapshot={transform:'web9000-source-feed-import/v1;countries=DE;baseline=unknown',
   sources:[metadata(data,sourcePath,now)]};
  await writeFile(sourcesPath,JSON.stringify(snapshot));
  let result=signCli('init',config,rulesPath,sourcesPath);
  assert.equal(result.status,0,result.stderr);
  let saved=JSON.parse(await readFile(config,'utf8'));
  assert.equal((await stat(config)).mode&0o077,0);
  const source=await loadPeerSourceObserver(config);
  assert.ok(source.provenance);
  const verified=await verifySourceFeed(saved.feed,{
   expectedIssuer:saved.issuer,now:Date.now()
  });
  assert.equal(verified.valid,true);
  const claim=await verifySourceProvenance(saved.provenance,{
   expectedIssuer:saved.issuer,feedDigest:verified.digest,
   revision:verified.revision
  });
  assert.equal(claim.valid,true,claim.reason);
  assert.equal(claim.rulesSha256,await digestRules([rule]));
  assert.equal(claim.sources[0].sha256,hash(data));
  assert.ok(!JSON.stringify(saved.provenance).includes(sourcePath),
   'private local source filenames must never appear in public receipts');
  assert.equal((await verifySourceProvenance(saved.provenance,{
   expectedIssuer:(await generateIdentity()).author,feedDigest:verified.digest,
   revision:verified.revision})).valid,false);
  assert.equal((await verifySourceProvenance(saved.provenance,{
   expectedIssuer:saved.issuer,feedDigest:'f'.repeat(64),
   revision:verified.revision})).valid,false);
  const tampered=structuredClone(saved.provenance);
  tampered.body.sources[0].license='no-attribution';
  assert.equal((await verifySourceProvenance(tampered,{
   expectedIssuer:saved.issuer,feedDigest:verified.digest,
   revision:verified.revision})).valid,false);
  // Operator cannot remove public snapshot provenance during an update,
  // even if the underlying signed classifier is otherwise correct.
  result=signCli('update',config,rulesPath);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/continue providing --sources/);
  assert.deepEqual(JSON.parse(await readFile(config,'utf8')),saved);
  // A replaced upstream file with unchanged declared digest MUST fail.
  await writeFile(sourcePath,Buffer.from('tampered version of the source bytes'));
  result=signCli('update',config,rulesPath,sourcesPath);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/SHA-256|size differs/);
  assert.deepEqual(JSON.parse(await readFile(config,'utf8')),saved);
  // Re-pin newly obtained actual data bytes, then sign a new revision.
  const updatedData=Buffer.from('198.51.100.0\t198.51.100.255\t64500\tDE\tnew verified snapshot\n');
  await writeFile(sourcePath,updatedData);
  snapshot.sources=[metadata(updatedData,sourcePath,Date.now())];
  await writeFile(sourcesPath,JSON.stringify(snapshot));
  result=signCli('update',config,rulesPath,sourcesPath);
  assert.equal(result.status,0,result.stderr);
  const second=JSON.parse(await readFile(config,'utf8'));
  assert.equal(second.issuer,saved.issuer);
  assert.equal(second.pkcs8,saved.pkcs8);
  assert.equal(second.feed.body.revision,2);
  assert.equal(second.provenance.body.previousFeedDigest,verified.digest);
  assert.equal((await loadPeerSourceObserver(config)).provenance.body.revision,2);
  const altered=structuredClone(second);
  altered.provenance.body.rulesSha256='0'.repeat(64);
  await writeFile(config,JSON.stringify(altered),{mode:0o600});
  await assert.rejects(loadPeerSourceObserver(config),
    /Signed provenance does not commit actual verified rule dataset/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('selected browser verifies separately signed provenance, and rejects a fake provenance update without discarding signed original feed',async()=>{
 const signer=await generateIdentity(),time=Date.now();
 const body={version:1,revision:1,issuedAt:time-1000,
  expiresAt:time+3600000,rules:[rule]};
 const feed=await signSourceFeed(signer,body);
 const verified=await verifySourceFeed(feed,{
  expectedIssuer:signer.author,now:time
 });
 assert.equal(verified.valid,true);
 const claim=await signSourceProvenance(signer,{
  version:1,revision:1,feedDigest:verified.digest,
  previousFeedDigest:null,rulesSha256:await digestRules(body.rules),
  rulesCount:1,createdAt:time-1000,expiresAt:time+3600000,
  transform:'web9000-source-feed-import/v1;countries=DE;baseline=unknown',
  sources:[{category:'iptoasn',uri:origin,license:'PDDL-1.0',
   bytes:83,sha256:'2'.repeat(64),retrievedAt:time-1000}]
 });
 const bridge=await createBrowserBridge({
  index:fakeIndex(),port:0,sourceObserver:{
   signer,feed,feedIssuer:signer.author,provenance:claim
  }
 });
 const verifiedClaims=[],errors=[];
 const mesh=new BrowserPeerMesh({WebSocketImpl:WebSocket,
  onSourceProvenance:item=>verifiedClaims.push(item),
  onError:(_,message)=>errors.push(String(message))
 });
 const noPin=[];
 const ordinary=new BrowserPeerMesh({WebSocketImpl:WebSocket,
  onSourceProvenance:item=>noPin.push(item)
 });
 try{
  mesh.connect([bridge.url],{sourcePins:{[bridge.url]:signer.author}});
  ordinary.connect([bridge.url]);
  await eventually(()=>verifiedClaims.length===1,'browser verified source dataset receipt');
  assert.equal(verifiedClaims[0].sources[0].uri,origin);
  assert.equal(verifiedClaims[0].revision,1);
  assert.equal(noPin.length,0,'unpinned browser must ignore independent-source claims');
  const fake=structuredClone(claim);
  fake.body.sources[0].license='not-actually-source-license';
  const tamperedFeed=structuredClone(feed);
  tamperedFeed.body.rules[0].country='ZZ';
  // Bridge cannot update the source feed and attach a contradictory receipt.
  await assert.rejects(bridge.updateSourceFeed(tamperedFeed,{
   provenance:fake
  }),/update rejected/);
  assert.deepEqual(errors,[]);
 }finally{mesh.disconnect();ordinary.disconnect();await bridge.close();}
});

test('an operator can renew an EXPIRED signed feed and provenance under the SAME identity without disabling historical signature checks',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-provenance-expired-'));
 const config=path.join(dir,'observer.json'),rulesPath=path.join(dir,'rules.json'),
  snapshot=path.join(dir,'snapshot.tsv'),sourcesPath=path.join(dir,'sources.json');
 const signer=await generateIdentity({extractable:true});
 const pkcs8=Buffer.from(await crypto.subtle.exportKey('pkcs8',
  signer.privateKey)).toString('base64');
 const oldDate=Date.now()-9*86400000,oldExpiry=oldDate+7*86400000;
 const oldFeed=await signSourceFeed(signer,{
  version:1,revision:1,issuedAt:oldDate,expiresAt:oldExpiry,
  rules:[rule]
 });
 const oldVerified=await verifySourceFeed(oldFeed,{
  expectedIssuer:signer.author,now:oldDate+1
 });
 assert.equal(oldVerified.valid,true);
 const oldClaim=await signSourceProvenance(signer,{
  version:1,revision:1,feedDigest:oldVerified.digest,
  previousFeedDigest:null,rulesSha256:await digestRules([rule]),
  rulesCount:1,createdAt:oldDate,expiresAt:oldExpiry,
  transform:'web9000-source-feed-import/v1;countries=DE;baseline=unknown',
  sources:[{category:'iptoasn',uri:origin,license:'PDDL-1.0',
   sha256:'4'.repeat(64),bytes:10,retrievedAt:oldDate}]
 });
 try{
  await writeFile(config,JSON.stringify({issuer:signer.author,
   pkcs8,feed:oldFeed,provenance:oldClaim}),{mode:0o600});
  await writeFile(rulesPath,JSON.stringify([rule]));
  const latest=Buffer.from('198.51.100.0\t198.51.100.255\t64500\tDE\tnew dataset after outage\n');
  await writeFile(snapshot,latest);
  await writeFile(sourcesPath,JSON.stringify({
   transform:'web9000-source-feed-import/v1;countries=DE;baseline=unknown',
   sources:[metadata(latest,snapshot,Date.now())]
  }));
  const result=signCli('update',config,rulesPath,sourcesPath);
  assert.equal(result.status,0,result.stderr);
  const current=await loadPeerSourceObserver(config);
  assert.equal(current.feed.body.revision,2);
  assert.equal(current.provenance.body.previousFeedDigest,oldVerified.digest);
  assert.equal(current.signer.author,signer.author);
 }finally{await rm(dir,{recursive:true,force:true});}
});
