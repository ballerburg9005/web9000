// Explicit, provider-independent recovery of a signed source snapshot.
// The caller pins the operator's Ed25519 identity, chooses a live libp2p
// provider, and verifies BOTH the UnixFS CID/DAG and the original source
// SHA-256 from the independently signed provenance statement.
// No HTTP gateway, source publisher URL, browser auto-fetch or OrbitDB used.
import {readFile,open,link,unlink,rm,mkdtemp} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {createHelia} from 'helia';
import {LevelBlockstore} from 'blockstore-level';
import {unixfs} from '@helia/unixfs';
import {multiaddr} from '@multiformats/multiaddr';
import {CID} from 'multiformats/cid';
import {verifySourceProvenance} from './source-provenance.js';

export async function fetchArchivedSource({
 provenanceFile,expectedIssuer,sourceIndex,providerAddress,outputFile,
 timeoutMs=60000
}={}){
 if(!isAbsolute(provenanceFile||'')||!isAbsolute(outputFile||'')||
    !Number.isSafeInteger(sourceIndex)||sourceIndex<0||sourceIndex>=8||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)
  throw Error('Snapshot retrieval requires absolute paths, a bounded source index and an explicit timeout');
 const raw=await readFile(provenanceFile,'utf8');
 if(raw.length>16*1024)throw Error('Signed source provenance exceeds bounded input');
 const document=JSON.parse(raw);
 const signature=await verifySourceProvenance(document,{
  expectedIssuer,feedDigest:document?.body?.feedDigest,
  revision:document?.body?.revision
 });
 if(!signature.valid)throw Error('Untrusted or invalid signed provenance: '+signature.reason);
 const entry=signature.sources[sourceIndex];
 if(!entry||!entry.archiveCid)
  throw Error('Selected signed source lacks an explicitly published IPFS archive CID');
 const cid=CID.parse(entry.archiveCid);
 if(cid.version!==1)throw Error('Archive CID must be CIDv1');
 const address=multiaddr(providerAddress);
 // Forbid implicit HTTP transports, hostname-lookup redirects, or network
 // probing; operator must provide one explicit libp2p TCP IPv4 address.
 const rendered=address.toString();
 if(!/^\/ip4\/(?:\d{1,3}\.){3}\d{1,3}\/tcp\/\d{1,5}(?:\/p2p\/[A-Za-z0-9]+)?$/.test(rendered))
  throw Error('Explicit IPv4 libp2p TCP provider multiaddress required');
 const tempDir=await mkdtemp(join(tmpdir(),'w9-source-cid-fetch-'));
 const tempFile=outputFile+'.'+randomBytes(8).toString('hex')+'.tmp';
 let ipfs=null,localBlockstore=null,handle=null;
 try{
  const libp2p=await createLibp2p({
   addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
   transports:[tcp()],connectionEncrypters:[noise()],
   streamMuxers:[yamux()],services:{identify:identify()}
  });
  localBlockstore=new LevelBlockstore(join(tempDir,'blocks'));
  ipfs=await createHelia({libp2p,blockstore:localBlockstore});
  const conn=await libp2p.dial(address,{signal:AbortSignal.timeout(timeoutMs)});
  const sha=createHash('sha256');
  handle=await open(tempFile,'wx',0o600);
  let bytes=0;
  for await(const part of unixfs(ipfs).cat(cid.toString(),{
    providers:[conn.remotePeer],signal:AbortSignal.timeout(timeoutMs)
  })){
   bytes+=part.byteLength;
   if(bytes>entry.bytes||bytes>128*1024*1024)
    throw Error('Source archive exceeded signed source byte length');
   sha.update(part);
   await handle.writeFile(part);
  }
  const digest=sha.digest('hex');
  if(bytes!==entry.bytes||digest!==entry.sha256)
   throw Error('Independently retrieved CID content does not match signed source SHA-256');
  await handle.sync();await handle.close();handle=null;
  // Atomic exclusive materialization: never overwrite an existing local
  // file, even if a peer or caller supplied a colliding output name.
  await link(tempFile,outputFile);
  await unlink(tempFile);
  return {cid:entry.archiveCid,sha256:digest,bytes,outputFile,
   signedBy:expectedIssuer,sourceUrl:entry.uri};
 }finally{
  await handle?.close().catch(()=>{});
  await ipfs?.stop().catch(()=>{});
  await localBlockstore?.close().catch(()=>{});
  await unlink(tempFile).catch(()=>{});
  await rm(tempDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
if(process.argv[1]&&/source-snapshot-fetch\.mjs$/.test(process.argv[1])){
 const [mode,provenanceFile,expectedIssuer,index,address,outputFile]=process.argv.slice(2);
 if(mode!=='fetch'||process.argv.length!==8)
  throw Error('Usage: source-snapshot-fetch.mjs fetch /abs/signed-provenance.json ed25519:PINNEDKEY SOURCE_INDEX /ip4/PEERIP/tcp/PORT /abs/NEW/output.bin');
 const result=await fetchArchivedSource({
  provenanceFile,expectedIssuer,sourceIndex:Number(index),
  providerAddress:address,outputFile
 });
 console.log(JSON.stringify({ok:true,...result,
  notice:'Explicit signed-source archive fetch; original publisher bytes verified against pinned operator SHA-256'}));
}
