import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {claimsFromVerifiedEvents,chooseMediaGateways,
  parseMediaGateways} from '../core/media-discovery.js';

const CID='ipfs://bafybeigdyrzt3cu5z4z4bz3hyjipfxzabfqb4zl3nkrhuxuu7pn7efq3aa';
const NOW=Date.now();
test('provider announcements are signed claims, bounded, and cannot change another key',async()=>{
 const alice=await generateIdentity(),bob=await generateIdentity();
 const event=await signEvent(alice,{kind:'media-provider',space:'media-providers',time:NOW,
  body:{gateway:'https://mirror.example/media',cids:[CID],
    action:'offer',expiresAt:NOW+86400000}});
 assert.equal(await verifyEvent(event),true);
 const replica=new Replica();
 assert.equal((await replica.ingest(event)).accepted,true);
 assert.equal((await replica.ingest({...event,payload:{...event.payload,author:bob.author}})).accepted,false);
 assert.equal((await replica.ingest({...event,payload:{...event.payload,body:{...event.payload.body,gateway:'https://evil.example'}}})).accepted,false);
 for(const b of [
  {gateway:'https://mirror.example/media',cids:Array(33).fill(CID),action:'offer',expiresAt:NOW+1},
  {gateway:'javascript:alert(1)',cids:[CID],action:'offer',expiresAt:NOW+1},
  {gateway:'https://mirror.example/media',cids:[CID],action:'offer',expiresAt:NOW+9*86400000},
  {gateway:'https://mirror.example/media',cids:[CID],action:'offer',expiresAt:NOW-1},
  {gateway:'https://mirror.example/media',cids:[CID],action:'unknown',expiresAt:NOW+1}
 ])await assert.rejects(signEvent(alice,{kind:'media-provider',space:'media-providers',time:NOW,body:b}),
   /media-provider/);
});
test('provider claims rank only explicitly approved peers, with no automatic binary download',async()=>{
 const alice=await generateIdentity(),mallory=await generateIdentity();
 const events=[];
 for(const [author,gateway] of [[alice,'https://mirror.example/media'],[mallory,'https://surprise.example/media']]){
  const e=await signEvent(author,{kind:'media-provider',space:'media-providers',time:NOW,
   body:{gateway,cids:[CID],action:'offer',expiresAt:NOW+86400000}});
  events.push(e);
 }
 const available=claimsFromVerifiedEvents(events,{cid:CID,now:NOW+1000});
 assert.equal(available.length,2);
 const options={cid:CID,preferred:'https://preferred.example/media',
  approved:['https://slow.example/media','https://mirror.example/media'],
  claims:available,trustedAuthors:[alice.author,mallory.author],now:NOW+1000};
 assert.deepEqual(chooseMediaGateways(options),[
  'https://preferred.example/media','https://mirror.example/media',
  'https://slow.example/media']);
 assert.ok(!chooseMediaGateways(options).includes('https://surprise.example/media'),
  'Signed but unapproved host must NEVER be contacted');
 assert.deepEqual(chooseMediaGateways({...options,trustedAuthors:[]}),[
  'https://preferred.example/media','https://slow.example/media','https://mirror.example/media']);
 const withdrawn=await signEvent(alice,{kind:'media-provider',space:'media-providers',time:NOW+2000,
  body:{gateway:'https://mirror.example/media',cids:[CID],action:'withdraw',
   expiresAt:NOW+86400000}});
 const claims=claimsFromVerifiedEvents([...events,withdrawn],{cid:CID,now:NOW+3000});
 assert.ok(!claims.some(x=>x.author===alice.author));
 const shortWithdrawal=await signEvent(alice,{kind:'media-provider',space:'media-providers',
  time:NOW+3000,body:{gateway:'https://mirror.example/media',cids:[CID],
   action:'withdraw',expiresAt:NOW+3100}});
 assert.ok(!claimsFromVerifiedEvents([...events,shortWithdrawal],{
  cid:CID,now:NOW+5000}).some(x=>x.author===alice.author),
  'expired later withdrawal must not resurrect an older unexpired offer');
 assert.equal(claimsFromVerifiedEvents(events,{cid:CID,now:NOW+2*86400000}).length,0,
  'expired hints must never survive forever');
 assert.throws(()=>parseMediaGateways('https://one.example, javascript:alert(1)'),/gateway|HTTP/);
 assert.deepEqual(parseMediaGateways('https://one.example/, https://one.example/'),
  ['https://one.example']);
});
