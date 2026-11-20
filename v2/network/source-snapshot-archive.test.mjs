import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {unixfs} from '@helia/unixfs';
import {CID} from 'multiformats/cid';
import {multiaddr} from '@multiformats/multiaddr';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';
import {prepareSourceArchives,startSourceArchivePeer} from './source-snapshot-archive.mjs';
import {readVerifiedSourceSnapshots} from './source-provenance-files.mjs';
import {signSourceProvenance,verifySourceProvenance,digestRules} from './source-provenance.js';
import {generateIdentity} from '../core/events.js';
import {loadPeerSourceObserver} from './node-source-observer.mjs';
import {fetchArchivedSource} from './source-snapshot-fetch.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const collect=async iter=>{
 const chunks=[];let size=0;
 for await(const chunk of iter){const buffer=Buffer.from(chunk);size+=buffer.length;chunks.push(buffer);}
 return Buffer.concat(chunks,size);
};
test('private snapshots have stable UnixFS CID, independently readable from separate Helia/Bitswap peer, and CIDs are signed into operator provenance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w9-independent-source-archive-'));
 let source,reader,mirror;
 try{
  const input=join(dir,'source.bin'),sources=join(dir,'sources.json'),
    store=join(dir,'archive-store'),amended=join(dir,'sources-with-archive.json');
  const sample=Buffer.alloc(1048576+937);
  for(let i=0;i<sample.length;i++)sample[i]=(i*17+23)%251;
  await writeFile(input,sample);
  const baseline={category:'iptoasn',uri:'https://data.example.org/ip2asn.tsv.gz',
   license:'PDDL-1.0',sha256:hash(sample),
   bytes:sample.byteLength,retrievedAt:Date.now(),file:input};
  await writeFile(sources,JSON.stringify({
   transform:'web9000-source-feed-import/v1;countries=DE',sources:[baseline]
  }));
  const prepared=await prepareSourceArchives(sources,store,amended);
  const store2=join(dir,'independent-mirror-store');
  const amended2=join(dir,'independent-mirror-source.json');
  const duplicate=await prepareSourceArchives(sources,store2,amended2);
  assert.deepEqual(duplicate.roots,prepared.roots,
   'independent providers derive the exact same CID for identical source bytes');
  assert.equal(prepared.roots.length,1);
  const cid=CID.parse(prepared.roots[0]);
  assert.equal((await stat(store)).mode&0o077,0);
  assert.equal((await stat(join(store,'source-offers.json'))).mode&0o077,0);
  const changed=JSON.parse(await readFile(amended,'utf8'));
  assert.equal(changed.sources[0].archiveCid,cid.toString());
  assert.ok(!JSON.stringify(changed).includes('pkcs8'));
  const checked=await readVerifiedSourceSnapshots(amended);
  assert.equal(checked.sources[0].archiveCid,cid.toString());

  source=await startSourceArchivePeer(store);
  const libp2p=await createLibp2p({
   addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],
   streamMuxers:[yamux()],services:{identify:identify()}
  });
  const ipfs=await createHelia({libp2p,
   blockstore:new LevelBlockstore(join(dir,'independent-blockstore'))});
  reader={ipfs,libp2p};
  await libp2p.dial(multiaddr(source.addrs[0]));
  const found=await collect(unixfs(ipfs).cat(cid.toString(),{
   providers:[source.libp2p.peerId],signal:AbortSignal.timeout(15000)
  }));
  assert.deepEqual(found,sample);
  assert.equal(hash(found),baseline.sha256,'source byte SHA256 validates independently of CID/DAG links');

  const other=Buffer.from('unlisted local block should never escape Bitswap');
  const orphanCID=CID.createV1(raw.code,await sha256.digest(other));
  await source.ipfs.blockstore.put(orphanCID,other);
  assert.equal(await source.policy.maySend(orphanCID),false,
   'unlisted local blocks must not be served merely because they exist');
  const signer=await generateIdentity({extractable:true}),now=Date.now();
  const rules=[{cidr:'198.51.100.0/24',networkKind:'unknown',
   country:'DE',asn:'AS64500'}];
  const digest='b'.repeat(64);
  const signed=await signSourceProvenance(signer,{
   version:1,revision:1,feedDigest:digest,previousFeedDigest:null,
   rulesSha256:await digestRules(rules),rulesCount:1,
   createdAt:now,expiresAt:now+3600000,
   transform:checked.transform,sources:checked.sources
  });
  const verified=await verifySourceProvenance(signed,{
   expectedIssuer:signer.author,feedDigest:digest,revision:1,now
  });
  assert.equal(verified.valid,true,verified.reason);
  assert.equal(verified.sources[0].archiveCid,cid.toString());
  // Exercise actual operator signing CLI as well as standalone provenance.
  const rulesFile=join(dir,'rules.json'),config=join(dir,'observer.json');
  await writeFile(rulesFile,JSON.stringify(rules));
  const cli=spawnSync(process.execPath,[
   new URL('./source-feed-operator.mjs',import.meta.url).pathname,
   'init',config,rulesFile,'--sources',amended
  ],{encoding:'utf8',timeout:25000});
  assert.equal(cli.status,0,cli.stderr);
  const configured=await loadPeerSourceObserver(config);
  assert.equal(configured.provenance.body.sources[0].archiveCid,cid.toString());
  assert.ok(!JSON.stringify(configured.provenance).includes(input));
  assert.ok(!JSON.stringify(signed).includes(input),
   'operator private snapshot filenames may not be exposed in source provenance');
  const provenanceFile=join(dir,'signed-public-provenance.json');
  await writeFile(provenanceFile,JSON.stringify(signed));
  const recovered=join(dir,'independent-original.bin');
  const downloaded=await fetchArchivedSource({
    provenanceFile,expectedIssuer:signer.author,sourceIndex:0,
    providerAddress:source.addrs[0],outputFile:recovered
  });
  assert.equal(downloaded.sha256,baseline.sha256);
  assert.deepEqual(await readFile(recovered),sample);
  await assert.rejects(fetchArchivedSource({
    provenanceFile,expectedIssuer:signer.author,sourceIndex:0,
    providerAddress:source.addrs[0],outputFile:recovered
  }),/EEXIST/,'snapshot recovery must never overwrite existing user data');
  await assert.rejects(fetchArchivedSource({
    provenanceFile,expectedIssuer:(await generateIdentity()).author,
    sourceIndex:0,providerAddress:source.addrs[0],
    outputFile:join(dir,'forged-output')
  }),/Untrusted/,'reader must pin exact operator identity');
  await source.stop();source=null;
  mirror=await startSourceArchivePeer(store2);
  const recoveredFromMirror=join(dir,'mirrored-original.bin');
  const mirrored=await fetchArchivedSource({
    provenanceFile,expectedIssuer:signer.author,sourceIndex:0,
    providerAddress:mirror.addrs[0],outputFile:recoveredFromMirror
  });
  assert.equal(mirrored.cid,downloaded.cid);
  assert.deepEqual(await readFile(recoveredFromMirror),sample,
   'the second independently archived provider survives first peer shutdown');
  const fake=structuredClone(signed);
  fake.body.sources[0].archiveCid='bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal((await verifySourceProvenance(fake,{
   expectedIssuer:signer.author,feedDigest:digest,revision:1,now
  })).valid,false);
  await assert.rejects(prepareSourceArchives(sources,store,
    join(dir,'overwritten-archive.json')),/EEXIST/,
    'existing published archival blockstores must not be overwritten');
 }finally{
  await reader?.ipfs.stop().catch(()=>{});
  await source?.stop().catch(()=>{});
  await mirror?.stop().catch(()=>{});
  await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
test('wrong SHA256 refuses archival and does not leave a partially published store',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w9-archive-hash-reject-'));
 try{
  const input=join(dir,'snap'),manifest=join(dir,'sources.json'),store=join(dir,'store');
  const data=Buffer.from('source bytes must match independently');
  await writeFile(input,data);
  await writeFile(manifest,JSON.stringify({transform:'test-source-transform',
   sources:[{category:'other',uri:'https://example.net/source',
    license:'CC0',sha256:'a'.repeat(64),bytes:data.length,
    retrievedAt:Date.now(),file:input}]}));
  await assert.rejects(prepareSourceArchives(manifest,store,
    join(dir,'archived.json')),/SHA-256/);
  await assert.rejects(stat(store),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
