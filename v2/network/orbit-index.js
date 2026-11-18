// OrbitDB is a replicable, *optional* discovery/index substrate, not a global ACL.
// Pass a running OrbitDB instance; a client may discover multiple independent indexes.
// Any peer may create an alternative index and publish in any namespace.
import {verifyEvent} from '../core/events.js';
export async function openPublicIndex(orbitdb, nameOrAddress) {
  const {IPFSAccessController} = await import('@orbitdb/core');
  const db=await orbitdb.open(nameOrAddress, {
    type:'events',
    AccessController: IPFSAccessController({write:['*']})
  });
  return {
    address:db.address,
    async publish(event) {
      if(!await verifyEvent(event)) throw Error('Invalid signed event');
      return db.add(event);
    },
    async loadInto(replica) {
      const rows=await db.all();
      const results=[];
      for (const row of rows) results.push(await replica.ingest(row.value));
      return results;
    },
    async close(){await db.close();}
  };
}
