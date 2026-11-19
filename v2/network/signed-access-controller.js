// WEB9000 v1 signed-event append controller for independent, permissionless
// OrbitDB event logs. No author, space, owner, financial or membership ACL.
//
// IMPORTANT: this controller produces a NEW OrbitDB index address. Legacy
// raw indexes use @orbitdb/core's IPFSAccessController and must be migrated
// explicitly; silently reopening the old address cannot enforce this rule.
import {IPFSAccessController,useAccessController} from '@orbitdb/core';
import {verifyEvent} from '../core/events.js';

export const SIGNED_INDEX_CONTROLLER_TYPE='web9000-signed-v1';
const PREFIX='/'+SIGNED_INDEX_CONTROLLER_TYPE+'/';
const MAX_EVENT_BYTES=48*1024;

// The underlying ACL manifesto is IPFS content addressed with write:['*'].
// The prefix changes how OrbitDB resolves and checks the per-index controller,
// so every compliant replica enforces this code, even on direct db.add().
export const SignedEventAccessController=()=>async ({orbitdb,identities,address})=>{
    const ipfsAddress=address?String(address).replace(PREFIX,'/ipfs/'):null;
    if(address&&(!String(address).startsWith(PREFIX)||
       !/^\/ipfs\/[a-zA-Z0-9]+$/.test(ipfsAddress)))
      throw Error('Invalid signed OrbitDB access-controller address');
    const acl=await IPFSAccessController({write:['*']})({
      orbitdb,identities,address:ipfsAddress||undefined
    });
    // This database's writable universe is *all* separately verified
    // Ed25519 WEB9000 identities, regardless of OrbitDB writer identity.
    // The manifest's backing IPFS ACL must remain public; otherwise some
    // other access controller could smuggle a hidden membership veto.
    if(acl.write.length!==1||acl.write[0]!=='*')
      throw Error('Signed index must have permissionless OrbitDB writers');
    return {
      type:SIGNED_INDEX_CONTROLLER_TYPE,
      address:acl.address.replace(/^\/ipfs\//,PREFIX),
      write:['*'],
      async canAppend(entry){
        // A replicated index MUST use one shared, versioned validation rule.
        // Local per-peer size limits here would create inconsistent heads.
        try{
          if(!await acl.canAppend(entry))return false;
          const payload=entry?.payload;
          if(!payload||payload.op!=='ADD'||payload.key!==null||
             !payload.value||typeof payload.value!=='object')
            return false;
          const bytes=Buffer.byteLength(JSON.stringify(payload.value),'utf8');
          if(bytes<1||bytes>MAX_EVENT_BYTES)return false;
          return await verifyEvent(payload.value);
        }catch{return false;}
      }
    };
};
SignedEventAccessController.type=SIGNED_INDEX_CONTROLLER_TYPE;

let installed=false;
export function registerSignedEventAccessController(){
  if(!installed){
    useAccessController(SignedEventAccessController);
    installed=true;
  }
}
export async function openVerifiedPublicIndex(orbitdb,nameOrAddress){
  registerSignedEventAccessController();
  // The events adapter's public methods exactly match the legacy wrapper,
  // but the mandatory access-check applies to direct OrbitDB writers too.
  const db=await orbitdb.open(nameOrAddress,{
    type:'events',AccessController:SignedEventAccessController()
  });
  if(db.access?.type!==SIGNED_INDEX_CONTROLLER_TYPE)
    throw Error('Refusing to treat an unsigned legacy OrbitDB index as signature-protected');
  return {
    address:db.address,
    signedAccessController:db.access.type,
    async publish(event){
      if(!await verifyEvent(event))throw Error('Invalid signed event');
      return db.add(event);
    },
    async loadInto(replica){
      const rows=await db.all(),results=[];
      for(const row of rows)results.push(await replica.ingest(row.value));
      return results;
    },
    onUpdate(callback){
      const handler=entry=>callback(entry?.payload?.value);
      db.events.on('update',handler);
      return ()=>db.events.off?.('update',handler);
    },
    async close(){await db.close();}
  };
}
