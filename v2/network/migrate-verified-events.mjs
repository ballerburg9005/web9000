// Safely prepare and copy a *local snapshot* of a legacy public OrbitDB index
// into a distinct signature-validated index. This never invents a new author,
// re-signs an event, or grants the destination operator namespace authority.
//
// The snapshot attests only to locally stored log entries. It is NOT a proof
// that the source peer had every event in the wider network.
import {createHash} from 'node:crypto';
import {verifyEvent} from '../core/events.js';

export const MAX_MIGRATION_ROWS=50000;
export const MAX_SIGNED_INDEX_EVENT_BYTES=48*1024;
const HEX=/^[0-9a-f]{64}$/;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const uniqSort=xs=>[...new Set(xs)].sort();
const extractEntry=row=>{
  if(row&&typeof row==='object'&&typeof row.hash==='string'&&
     Object.hasOwn(row,'value'))return row;
  throw Error('OrbitDB iterator returned a non-entry');
};
const eventByteLength=event=>{
  try{return Buffer.byteLength(JSON.stringify(event),'utf8');}
  catch{return Number.POSITIVE_INFINITY;}
};
export async function inspectLegacyIndex(db,{maxRows=MAX_MIGRATION_ROWS}={}){
  if(!db?.iterator||!db?.access||db.access.type!=='ipfs'||
     db.access.write?.length!==1||db.access.write[0]!=='*')
    throw Error('Expected an unrestricted legacy IPFS OrbitDB events index');
  if(typeof db.address!=='string'||!db.address.startsWith('/orbitdb/'))
    throw Error('Legacy source has no valid OrbitDB address');
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>MAX_MIGRATION_ROWS)
    throw Error('Unsafe migration scan limit');
  let scanned=0,invalid=0,oversized=0,duplicates=0;
  const rows=[],seenIds=new Map(),events=[];
  for await(const item of db.iterator()){
    if(scanned===maxRows)throw Error('Source exceeds scan limit; no partial migration allowed');
    const row=extractEntry(item);
    scanned++;
    if(!row.hash||row.hash.length>256)throw Error('Invalid source log entry hash');
    rows.push(row.hash);
    const event=row.value;
    if(eventByteLength(event)>MAX_SIGNED_INDEX_EVENT_BYTES){
      oversized++;
      continue;
    }
    if(!await verifyEvent(event)){
      invalid++;
      continue;
    }
    if(seenIds.has(event.id)){
      // Two valid envelopes with the same signed SHA-256 ID are the same
      // publication, irrespective of JSON object property order.
      duplicates++;
      continue;
    }
    seenIds.set(event.id,event);
    events.push(event);
  }
  events.sort((a,b)=>a.id.localeCompare(b.id));
  const ids=events.map(e=>e.id);
  const logHashes=uniqSort(rows);
  if(logHashes.length!==rows.length)throw Error('Duplicate source physical log entry hash');
  const snapshot=sha256('WEB9000/legacy-index-snapshot/v1\n'+
    db.address+'\n'+logHashes.join('\n')+'\n');
  const eventSet=sha256('WEB9000/migrated-verified-events/v1\n'+ids.join('\n')+'\n');
  return {
    sourceAddress:db.address,
    snapshot,eventSet,
    scanned,valid:events.length,invalid,oversized,duplicates,
    events,
    manifest:{
      protocol:'web9000-legacy-to-signed-v1',
      sourceAddress:db.address,
      snapshot,eventSet,scanned,valid:events.length,invalid,oversized,duplicates,
      // Includes no private signing keys. A forensic source is retained.
      warning:'Only locally observed entries; not network-wide completeness or finality'
    }
  };
}

export async function migrateVerifiedEvents({sourceDb,destinationIndex,plan,expectSnapshot,
  onProgress=()=>{}}={}){
  if(!plan?.manifest||!sourceDb||!destinationIndex?.publish||
     !destinationIndex?.loadInto)
    throw Error('Migration needs a verified plan and distinct destination index');
  if(!HEX.test(expectSnapshot||'')||expectSnapshot!==plan.snapshot)
    throw Error('Explicit expected source snapshot required; run dry-run first');
  if(destinationIndex.address===plan.sourceAddress)
    throw Error('Refusing migration into the same OrbitDB index');
  if(plan.oversized>0)
    throw Error('Source includes valid or invalid oversized events; review raw records before migration');
  const before=await inspectLegacyIndex(sourceDb);
  if(before.snapshot!==plan.snapshot||before.eventSet!==plan.eventSet)
    throw Error('Source snapshot changed before copy. Do a new dry-run.');
  // A partially completed local copy is safely resumable. Never duplicate
  // already stored signed events, and never claim that an unrelated signed
  // destination event was part of the historical snapshot.
  const makeReplica=()=>({
    events:new Map(),
    async ingest(event){
      if(!await verifyEvent(event))return {accepted:false};
      this.events.set(event.id,event);
      return {accepted:true};
    }
  });
  const existing=makeReplica();
  const initial=await destinationIndex.loadInto(existing);
  if(initial.some(x=>!x.accepted))throw Error('Destination contained invalid signed records');
  const planned=new Set(plan.events.map(e=>e.id));
  if([...existing.events.keys()].some(id=>!planned.has(id)))
    throw Error('Destination already contains signed records outside this plan; refusing to overwrite or claim an exact migration');
  const preexisting=existing.events.size;
  let copied=0;
  for(const event of plan.events){
    if(existing.events.has(event.id))continue;
    // The new storage-layer controller independently re-verifies signatures.
    await destinationIndex.publish(event);
    onProgress(++copied,plan.valid-preexisting);
  }
  // Verify the complete destination snapshot, not just successful db.add ACKs.
  const destinationReplica=makeReplica();
  const outcomes=await destinationIndex.loadInto(destinationReplica);
  if(outcomes.some(x=>!x.accepted)||destinationReplica.events.size!==plan.valid)
    throw Error('Destination failed signed-record count verification; do NOT switch readers');
  const copiedIds=[...destinationReplica.events.keys()].sort();
  if(sha256('WEB9000/migrated-verified-events/v1\n'+copiedIds.join('\n')+'\n')!==plan.eventSet)
    throw Error('Destination signed-event set mismatch; do NOT switch readers');
  const after=await inspectLegacyIndex(sourceDb);
  if(after.snapshot!==plan.snapshot||after.eventSet!==plan.eventSet)
    throw Error('Source changed during copy; destination is a PARTIAL snapshot, re-audit before switch');
  return {
    ...plan.manifest,
    destinationAddress:destinationIndex.address,
    copied,preexisting,
    verified:true,
    cutover:false,
    sourcePreserved:true,
    note:'Never automatically disconnect, delete or replace source index'
  };
}
