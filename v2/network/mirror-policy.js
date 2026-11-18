// Optional cross-index mirroring. Any participant may propagate an available
// signed record to other willing indexes. No index grants publishing authority.
// Automatic forwarding is OFF by default and conservative when enabled.
import {decide} from '../core/policy.js';
export function mirrorDecision(event,allRecords,policy,viewer,{enabled=false,spaces=[]}={}) {
  if(!enabled)return {mirror:false,reason:'cross-index mirroring disabled'};
  if(!event?.payload||!['post','reply'].includes(event.payload.kind))
    return {mirror:false,reason:'only content records are auto-mirrored'};
  if(!spaces.includes('*')&&!spaces.includes(event.payload.space))
    return {mirror:false,reason:'namespace not selected for replication'};
  const view=decide(event,allRecords,policy,viewer);
  if(!view.visible)return {mirror:false,reason:view.reason};
  // Require voluntary positive trust, not merely absence of a negative flag.
  // Prevents amplifying arbitrary unknown accounts across unrelated indexes.
  if(view.reason!=='trusted')return {mirror:false,reason:'author not trusted by this viewer'};
  return {mirror:true,reason:'locally approved trusted content, no IPFS bytes'};
}
