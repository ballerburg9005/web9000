// Distinct voluntary curated index. The public raw index remains permissionless.
// The curated index's access controller only recognizes the curator's *index*
// signer. That signer is NOT a network-wide publishing authority: any identity
// can publish records into any namespace in any unrestricted raw index, and
// anyone may operate their own independently curated index.
import {IPFSAccessController} from '@orbitdb/core';
import {verifyEvent} from '../core/events.js';
export async function openQualifiedIndex(orbitdb,nameOrAddress,{verifyQualification}={}){
  if(!orbitdb?.identity?.id)throw Error('Curator OrbitDB identity required');
  const db=await orbitdb.open(nameOrAddress,{type:'events',
    AccessController:IPFSAccessController({write:[orbitdb.identity.id]})});
  return {
    address:db.address,
    curator:orbitdb.identity.id,
    async publish(event,evidence){
      if(!await verifyEvent(event))throw Error('Invalid signed publication');
      if(typeof verifyQualification!=='function')
        throw Error('Independent stake/earned-karma verifier is not configured');
      const decision=await verifyQualification({event,evidence});
      if(!decision||decision.qualified!==true||decision.verification!=='independent')
        throw Error('Cannot admit unverified record to qualified replica');
      return db.add(event);
    },
    async loadInto(replica){
      const rows=await db.all(),out=[];
      for(const entry of rows)out.push(await replica.ingest(entry.value));
      return out;
    },
    onUpdate(callback){
      const handler=entry=>callback(entry?.payload?.value);
      db.events.on('update',handler);
      return ()=>db.events.off?.('update',handler);
    },
    async close(){await db.close();}
  };
}
