import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBrowserBridge} from './browser-bridge.mjs';
import {initializeProviderIdentity,createProviderClaim,publishClaim} from './announce-media.mjs';
import {verifyEvent} from '../core/events.js';
import {claimsFromVerifiedEvents} from '../core/media-discovery.js';

const CID='ipfs://bafybeigdyrzt3cu5z4z4bz3hyjipfxzabfqb4zl3nkrhuxuu7pn7efq3aa';
test('opt-in provider identity persists locally and independently signed claim crosses replaceable bridge',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w9-provider-'));
 const key=join(dir,'provider.private.json'),events=[];
 let bridge;
 try{
  const identity=await initializeProviderIdentity(key);
  assert.ok(identity.author.startsWith('ed25519:'));
  assert.equal((await stat(key)).mode&0o777,0o600);
  await assert.rejects(initializeProviderIdentity(key),/EEXIST/);
  const event=await createProviderClaim({file:key,gateway:'https://independent.example/media',
   cids:[CID]});
  assert.equal(await verifyEvent(event),true);
  assert.equal(event.payload.author,identity.author);
  const index={
   address:'/orbitdb/test-public',
   publish:async e=>{events.push(e);},
   loadInto:async()=>[],
   onUpdate:()=>()=>{}
  };
  bridge=await createBrowserBridge({index,host:'127.0.0.1',port:0});
  const ack=await publishClaim({url:bridge.url,event});
  assert.equal(ack.id,event.id);
  assert.equal(events.length,1);
  assert.equal((await verifyEvent(events[0])),true);
  assert.equal(claimsFromVerifiedEvents(events,{cid:CID}).length,1);
  const withdrawn=await createProviderClaim({file:key,
   gateway:'https://independent.example/media',cids:[CID],action:'withdraw',
   now:event.payload.time+1000});
  await publishClaim({url:bridge.url,event:withdrawn});
  assert.equal(claimsFromVerifiedEvents(events,{cid:CID}).length,0,
    'voluntary withdrawal removes provider claim without altering any post');
  const jwk=JSON.parse(await readFile(key,'utf8'));
  assert.ok(jwk.jwk.d,'operator private signing data remains in owner-only local file');
 }finally{
  await bridge?.close();
  await rm(dir,{force:true,recursive:true});
 }
});
