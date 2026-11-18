/**
 * Experimental real OrbitDB/Helia/libp2p peer for signed-event synchronization.
 * node node-peer.mjs [data-dir] [orbitdb-address-or-new-name] [peer-multiaddr]
 * A manually exchanged OrbitDB address and reachable peer multiaddr are required.
 * This is NOT a browser relay or a public always-online discovery service.
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

const dir=path.resolve(process.argv[2] || './.web9000-peer');
const indexName=process.argv[3] || 'web9000-public-test';
const remote=process.argv[4];
await mkdir(dir,{recursive:true});
const libp2p=await createLibp2p({
  addresses:{listen:['/ip4/0.0.0.0/tcp/0']},
  transports:[tcp()],
  connectionEncrypters:[noise()],
  streamMuxers:[yamux()],
  services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
});
const ipfs=await createHelia({libp2p,blockstore:new LevelBlockstore(path.join(dir,'blocks'))});
const orbitdb=await createOrbitDB({ipfs,directory:path.join(dir,'orbitdb')});
let index,bridge;
try {
  if(remote) await libp2p.dial(multiaddr(remote));
  index=await openPublicIndex(orbitdb,indexName);
  const replica=new Replica({maxEvents:200000});
  const initial=await index.loadInto(replica);
  const origins=process.env.WEB9000_WS_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean)||null;
  bridge=await createBrowserBridge({index,replica,
    host:process.env.WEB9000_WS_HOST||'127.0.0.1',
    port:process.env.WEB9000_WS_PORT===undefined?8787:Number(process.env.WEB9000_WS_PORT),
    allowedOrigins:origins
  });
  index.onUpdate(async ev=>{
    const result=await replica.ingest(ev);
    if(result.accepted&&!result.duplicate)console.log('RECEIVED',ev.id,'space',ev.payload.space,'local records',replica.size);
  });
  console.log('INDEX',index.address);
  console.log('BROWSER',bridge.url,'(WebSocket, optional; expose through WSS reverse proxy for HTTPS sites)');
  console.log('WEB9000 bridge is not an authoritative registry or relay and does not serve media.');
  for(const addr of libp2p.getMultiaddrs())console.log('PEER',addr.toString());
  console.log('Initially ingested',initial.filter(x=>x.accepted).length,'signed events.');
  console.log('Paste one signed event JSON per line to append to this public index.');
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
  if(bridge)await bridge.close();
  if(index)await index.close();
  await orbitdb.stop();
  await ipfs.stop();
}
