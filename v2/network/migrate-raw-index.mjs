#!/usr/bin/env node
/**
 * Offline, opt-in legacy->signed-index copier. No network discovery and no
 * automatic switch of the public bridge/index. Source peer MUST be stopped.
 *
 * Plan:
 *   node migrate-raw-index.mjs --source-dir DIR --source-index /orbitdb/CID
 *      --destination-dir NEW_DIR --destination-name new-signed-name
 * Execute (copies verified signatures only):
 *   ... --execute --expect-snapshot HEX_SHA256
 * Resume interrupted execution:
 *   ... --execute --resume --expect-snapshot HEX_SHA256
 */
import {stat,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibp2p} from 'libp2p';
import {tcp} from '@libp2p/tcp';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {identify} from '@libp2p/identify';
import {gossipsub} from '@libp2p/gossipsub';
import {LevelBlockstore} from 'blockstore-level';
import {createHelia} from 'helia';
import {createOrbitDB} from '@orbitdb/core';
import {loadOrCreatePeerKey} from './peer-identity.mjs';
import {verifyRawIndexSelection} from './raw-index-selection.mjs';
import {openVerifiedPublicIndex} from './signed-access-controller.js';
import {inspectLegacyIndex,migrateVerifiedEvents} from './migrate-verified-events.mjs';

const KEY='peer-private-key.pb';
const HEX=/^[0-9a-f]{64}$/;
export const usage='node migrate-raw-index.mjs --source-dir DIR --source-index /orbitdb/CID --destination-dir NEW_DIR --destination-name new-index [--execute --expect-snapshot HEX] [--resume]';
export function parseOptions(argv){
  const out={execute:false,resume:false};
  const flags=new Map([
    ['--source-dir','sourceDir'],['--source-index','sourceIndex'],
    ['--destination-dir','destinationDir'],['--destination-name','destinationName'],
    ['--expect-snapshot','expectSnapshot']
  ]);
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--execute'||flag==='--resume'){
      if(out[flag.slice(2)])throw Error('Duplicate '+flag);
      out[flag.slice(2)]=true;
      continue;
    }
    const key=flags.get(flag);
    if(!key||out[key]!==undefined||typeof argv[i+1]!=='string'||
       argv[i+1].startsWith('--'))
      throw Error('Invalid or repeated argument '+flag+'\n'+usage);
    out[key]=argv[++i];
  }
  for(const p of ['sourceDir','sourceIndex','destinationDir','destinationName'])
    if(typeof out[p]!=='string'||!out[p])throw Error('Missing '+p+'\n'+usage);
  if(!/^\/orbitdb\/[a-zA-Z0-9]{25,120}$/.test(out.sourceIndex))
    throw Error('Source must be a complete known /orbitdb/CID address, never an unverified index name');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,95}$/.test(out.destinationName))
    throw Error('Destination name must be a new, explicit plain index name');
  if(out.sourceDir===out.destinationDir)throw Error('Source and destination directories must differ');
  if(out.resume&&!out.execute)throw Error('--resume requires --execute');
  if(out.execute&&!HEX.test(out.expectSnapshot||''))
    throw Error('--execute requires a snapshot hash copied from a separate dry-run');
  if(!out.execute&&out.expectSnapshot!==undefined)
    throw Error('--expect-snapshot is only meaningful with --execute');
  return out;
}
async function exists(p){
  try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
async function checkDirectories({sourceDir,destinationDir,execute,resume}){
  const source=await realpath(sourceDir);
  // Resolve destination via parent because it must normally NOT exist.
  const proposedDestination=path.join(
    await realpath(path.dirname(path.resolve(destinationDir))),path.basename(destinationDir));
  const destinationExists=await exists(proposedDestination);
  const destination=destinationExists?
    await realpath(proposedDestination):proposedDestination;
  if(source===destination||source.startsWith(destination+path.sep)||
     destination.startsWith(source+path.sep))
    throw Error('Refusing nested or overlapping source and destination directories');
  if(destinationExists&&execute&&!resume)
    throw Error('Destination already exists. To resume a previous copy, use explicit --execute --resume after checking its contents.');
  if(!destinationExists&&resume)throw Error('Cannot resume a missing destination directory');
  for(const p of [path.join(source,KEY),path.join(source,'orbitdb'),path.join(source,'blocks')])
    if(!await exists(p))throw Error('Missing locally persisted legacy source data: '+p);
  if(await exists(path.join(source,'.web9000-signed-raw-index-v1.json')))
    throw Error('Source is already a signed-index directory, not legacy raw');
  return {source,destination,destinationExists};
}
async function startPeer(dir,{mustExist}={}){
  if(mustExist && !await exists(path.join(dir,KEY)))
    throw Error('Source/destination peer private key absent; refusing implicit identity creation');
  const key=await loadOrCreatePeerKey(dir);
  const libp2p=await createLibp2p({
    privateKey:key,addresses:{listen:['/ip4/127.0.0.1/tcp/0']},
    transports:[tcp()],connectionEncrypters:[noise()],streamMuxers:[yamux()],
    services:{identify:identify(),pubsub:gossipsub({allowPublishToZeroTopicPeers:true})}
  });
  let ipfs,orbitdb,blockstore;
  try{
    blockstore=new LevelBlockstore(path.join(dir,'blocks'));
    // LevelDB's constructor opens asynchronously. Explicit open avoids a
    // first read racing with the new handle, particularly after restart.
    await blockstore.open();
    ipfs=await createHelia({libp2p,blockstore});
    orbitdb=await createOrbitDB({ipfs,id:'web9000-curator:'+libp2p.peerId.toString(),
      directory:path.join(dir,'orbitdb')});
    return {libp2p,ipfs,orbitdb,async close(){
      try{await orbitdb.stop();}
      finally{
        try{await ipfs.stop();}
        finally{await blockstore.close();}
      }
    }};
  }catch(e){
    try{await orbitdb?.stop();}catch{}
    try{await ipfs?.stop();}catch{}
    try{await blockstore?.close();}catch{}
    try{await libp2p.stop();}catch{}
    throw e;
  }
}
export async function runMigration(opts){
  const dirs=await checkDirectories(opts);
  let source,destination,sourceDb,destIndex;
  try{
    source=await startPeer(dirs.source,{mustExist:true});
    sourceDb=await source.orbitdb.open(opts.sourceIndex);
    const plan=await inspectLegacyIndex(sourceDb);
    if(!opts.execute){
      return {phase:'dry-run',...plan.manifest,
        destinationName:opts.destinationName,
        destinationDirectory:dirs.destination,
        command:'Run again with --execute --expect-snapshot '+plan.snapshot,
        noDestinationCreated:true};
    }
    if(plan.snapshot!==opts.expectSnapshot)
      throw Error('Source changed since dry-run; refusing to create or modify destination');
    if(plan.oversized>0)
      throw Error('Oversized legacy records detected; no copy or destination created');
    if(!dirs.destinationExists)
      await mkdir(dirs.destination,{mode:0o700});
    await verifyRawIndexSelection({dir:dirs.destination,
      nameOrAddress:opts.destinationName,signed:true});
    destination=await startPeer(dirs.destination,{mustExist:dirs.destinationExists});
    destIndex=await openVerifiedPublicIndex(destination.orbitdb,opts.destinationName);
    return {phase:'verified-copy',...await migrateVerifiedEvents({
      sourceDb,destinationIndex:destIndex,plan,expectSnapshot:opts.expectSnapshot
    }),destinationName:opts.destinationName,destinationDirectory:dirs.destination,
      // Retain explicit source and destination addresses for independently
      // operated servers/clients. These are NOT signed network-wide receipts.
      operatorMustReview:true};
  }finally{
    try{await destIndex?.close();}catch{}
    try{await sourceDb?.close();}catch{}
    try{await destination?.close();}catch{}
    try{await source?.close();}catch{}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await runMigration(parseOptions(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    console.error('MIGRATION REFUSED:',error.message);
    process.exitCode=1;
  }
}
