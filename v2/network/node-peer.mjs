/**
 * Experimental real OrbitDB/Helia/libp2p peer for signed-event synchronization.
 * node node-peer.mjs [data-dir] [orbitdb-address-or-new-name] [peer-multiaddr]
 * A manually exchanged OrbitDB address and reachable peer multiaddr are required.
 * The optional browser WebSocket bridge is user-run, not a mandatory relay,
 * permission server or public bootstrap/discovery service.
 */
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {multiaddr} from '@multiformats/multiaddr';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {openPublicIndex} from './orbit-index.js';
import {Replica} from '../core/replica.js';
import {createBrowserBridge} from './browser-bridge.mjs';
import {loadOrCreatePeerKey} from './peer-identity.mjs';
import {createImageGateway} from './media-node.mjs';
import {openQualifiedIndex} from './qualified-index.js';

const dir=path.resolve(process.argv[2] || './.web9000-peer');
const indexName=process.argv[3] || 'web9000-public-test';
const remote=process.argv[4];
await mkdir(dir,{recursive:true});
const peerKey=await loadOrCreatePeerKey(dir);
const p2pPort=process.env.WEB9000_P2P_PORT===undefined?0:Number(process.env.WEB9000_P2P_PORT);
if(!Number.isSafeInteger(p2pPort)||p2pPort<0||p2pPort>65535)
  throw Error('Invalid WEB9000_P2P_PORT');
const libp2p=await createLibp2p({
  privateKey:peerKey,
  addresses:{listen:[`/ip4/0.0.0.0/tcp/${p2pPort}`]},
  transports:[tcp()],
  connectionEncrypters:[noise()],
  streamMuxers:[yamux()],
  services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
});
const ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(dir,'blocks'))});
// An OrbitDB identity created with a random id would silently change the
// qualified index's address after every restart. Bind the index-curator
// identity to this peer's persisted libp2p identity instead.
const curatorIdentityId='web9000-curator:'+libp2p.peerId.toString();
const orbitdb=await createOrbitDB({ipfs,id:curatorIdentityId,directory:path.join(dir,'orbitdb')});
let index,bridge,media,qualified,qualifiedBridge;
try {
  if(remote) await libp2p.dial(multiaddr(remote));
  index=await openPublicIndex(orbitdb,indexName);
  const replica=new Replica({maxEvents:200000});
  const initial=await index.loadInto(replica);
  const origins=process.env.WEB9000_WS_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean)||null;
  bridge=await createBrowserBridge({index,replica,
    host:process.env.WEB9000_WS_HOST||'127.0.0.1',
    port:process.env.WEB9000_WS_PORT===undefined?8787:Number(process.env.WEB9000_WS_PORT),
    allowedOrigins:origins,
    publicTestLimits:process.env.WEB9000_PUBLIC_TEST==='1'
  });
  index.onUpdate(async ev=>{
    const result=await replica.ingest(ev);
    if(result.accepted&&!result.duplicate)console.log('RECEIVED',ev.id,'space',ev.payload.space,'local records',replica.size);
  });
  console.log('PEER ID',libp2p.peerId.toString(),'persisted at',path.join(dir,'peer-private-key.pb'));
  console.log('INDEX',index.address,'(permissionless RAW lane)');
  if(process.env.WEB9000_QUALIFIED_INDEX==='1'){
    qualified=await openQualifiedIndex(orbitdb,process.env.WEB9000_QUALIFIED_NAME||'web9000-qualified-v1');
    // A qualified index is a separate, opt-in operator CURATION. This peer
    // has no stake proof verifier, so it must accept ZERO qualifications.
    // Publishing unverified raw records into the curated index is prohibited.
    qualifiedBridge=await createBrowserBridge({index:{
       ...qualified,
       publish:async()=>{throw Error('Qualified publishing disabled until independent stake verifier is configured');}
      },replica:new Replica({maxEvents:30000}),
      host:process.env.WEB9000_WS_HOST||'127.0.0.1',
      port:Number(process.env.WEB9000_QUALIFIED_PORT||8789),
      allowedOrigins:origins});
    console.log('QUALIFIED INDEX',qualified.address,'(no verified admissions configured)');
  }
  console.log('BROWSER',bridge.url,'(WebSocket, optional; expose through WSS reverse proxy for HTTPS sites)');
  if(process.env.WEB9000_MEDIA_SERVER==='1'){
    media=await createImageGateway({ipfs,host:process.env.WEB9000_MEDIA_HOST||'127.0.0.1',
      port:Number(process.env.WEB9000_MEDIA_PORT||8788),
      manifestFile:path.join(dir,'media-manifest.json'),
      uploadEnabled:process.env.WEB9000_MEDIA_UPLOAD==='1'});
    console.log('MEDIA GATEWAY',media.host+':'+media.port,'uploads enabled:',media.uploadEnabled);
  }
  console.log('WEB9000 bridge is not an authoritative registry or relay and does not serve media.');
  for(const addr of libp2p.getMultiaddrs())console.log('PEER',addr.toString());
  console.log('Initially ingested',initial.filter(x=>x.accepted).length,'signed events.');
  console.log('Paste one signed event JSON per line to append to this public index.');
  if(process.env.WEB9000_DAEMON==='1') {
    console.log('Peer running in headless daemon mode; termination is managed by the container.');
    await new Promise(()=>{});
  }
  const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of lines){
    if(!line.trim())continue;
    try {
      const event=JSON.parse(line);
      await index.publish(event);
      await replica.ingest(event);
      console.log('PUBLISHED',event.id);
    }catch(e){console.error('REJECTED',e.message);}
  }
}catch(e){console.error('Peer error:',e);process.exitCode=1;}
finally{
  if(qualifiedBridge)await qualifiedBridge.close();
  if(qualified)await qualified.close();
  if(media)await media.close();
  if(bridge)await bridge.close();
  if(index)await index.close();
  await orbitdb.stop();
  await ipfs.stop();
}
