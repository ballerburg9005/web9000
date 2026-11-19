import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile as execFileCallback} from 'node:child_process';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {IPFSAccessController} from '@orbitdb/core';
import {loadOrCreatePeerKey} from './peer-identity.mjs';
import {generateIdentity,signEvent} from '../core/events.js';
import {parseOptions} from './migrate-raw-index.mjs';
const execFile=promisify(execFileCallback);
const CLI=new URL('./migrate-raw-index.mjs',import.meta.url).pathname;
async function exists(pathname){
 try{await stat(pathname);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
async function useSource(dir,fn){
 const key=await loadOrCreatePeerKey(dir);
 const p2p=await createLibp2p({
   privateKey:key,addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
   services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
 });
 const blockstore=new LevelBlockstore(path.join(dir,'blocks'));
 await blockstore.open();
 const ipfs=await createHelia({libp2p:p2p,blockstore});
 const orbit=await createOrbitDB({ipfs,id:'web9000-curator:'+p2p.peerId.toString(),
   directory:path.join(dir,'orbitdb')});
 let db;
 try{
  db=await orbit.open('legacy-cli-source',{type:'events',
   AccessController:IPFSAccessController({write:['*']})});
  return await fn(db);
 }finally{
  try{await db?.close();}catch{}
  await orbit.stop();await ipfs.stop();await blockstore.close();
 }
}
test('migration CLI dry-run, explicit approval, source-change refusal, exact export and idempotent resume',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'w9-legacy-cli-'));
 const source=path.join(tmp,'source'),target=path.join(tmp,'signed');
 await mkdir(source);
 try{
  const author=await generateIdentity();
  const post=await signEvent(author,{space:'no-namespace-owner',
   body:{title:'From legacy history',text:'Signed immutable original'}});
  await useSource(source,async db=>{
   await db.add(post);
   await db.add({id:'sha256:'+'0'.repeat(64),payload:{space:'bad'},signature:'invalid'});
  });
  let sourceAddress;
  await useSource(source,async db=>{sourceAddress=db.address;});
  const args=['--source-dir',source,'--source-index',sourceAddress,
   '--destination-dir',target,'--destination-name','web9000-signature-validated-test'];
  const run=async extra=>{
   const {stdout}=await execFile(process.execPath,[CLI,...args,...extra],{
     timeout:60000,env:{...process.env,WEB9000_RAW_SIGNED_INDEX:'0'}});
   return JSON.parse(stdout);
  };
  const first=await run([]);
  assert.equal(first.phase,'dry-run');
  assert.equal(first.valid,1);
  assert.equal(first.invalid,1);
  assert.equal(first.scanned,2);
  assert.equal(await exists(target),false,'dry-run must not create destination');
  assert.equal(first.noDestinationCreated,true);
  const updated=await signEvent(author,{space:'no-namespace-owner',
    body:{title:'Update after dry run',text:'Requires new operator approval'}});
  await useSource(source,async db=>{await db.add(updated);});
  await assert.rejects(run(['--execute','--expect-snapshot',first.snapshot]),
    /Source changed since dry-run/);
  assert.equal(await exists(target),false,'outdated approval cannot create destination');
  const current=await run([]);
  assert.equal(current.scanned,3);
  assert.equal(current.valid,2);
  assert.notEqual(current.snapshot,first.snapshot,'new record changes audit fingerprint');
  const imported=await run(['--execute','--expect-snapshot',current.snapshot]);
  assert.equal(imported.verified,true);
  assert.equal(imported.copied,2);
  assert.equal(imported.destinationName,'web9000-signature-validated-test');
  assert.equal(imported.sourceAddress,sourceAddress);
  assert.notEqual(imported.destinationAddress,sourceAddress);
  assert.equal(imported.cutover,false);
  assert.equal(imported.sourcePreserved,true);
  assert.equal(await exists(path.join(target,'peer-private-key.pb')),true);
  assert.equal(await exists(path.join(target,'.web9000-signed-raw-index-v1.json')),true);
  const plannedAgain=await run([]);
  assert.equal(plannedAgain.snapshot,current.snapshot);
  const resumed=await run(['--execute','--resume','--expect-snapshot',current.snapshot]);
  assert.equal(resumed.verified,true);
  assert.equal(resumed.preexisting,2);
  assert.equal(resumed.copied,0);
  await useSource(source,async db=>{
   const rows=await db.all();
   assert.equal(rows.length,3);
   assert.ok(rows.some(r=>r.value?.id===post.id));
  });
  // Same/nested/symlink directories must never be accepted.
  const alias=path.join(tmp,'source-alias');
  await symlink(source,alias,'dir');
  const aliasArgs=[...args];aliasArgs[5]=alias;
  await assert.rejects(execFile(process.execPath,[CLI,...aliasArgs],{
    timeout:60000}),/Refusing nested or overlapping source and destination directories/);
  assert.throws(()=>parseOptions(['--source-dir',source,'--source-index',sourceAddress,
    '--destination-dir',target,'--destination-name','name','--resume']),/requires --execute/);
  console.log('PASS CLI dry-run never creates destination, exact local snapshot required, signed export verified, safe resume');
 }finally{await rm(tmp,{recursive:true,force:true});}
});
