// Revision and withdrawal are *viewer-side projections* of immutable,
// independently signed publications. No namespace owner can rewrite an event
// or delete a block from someone else's willing replica.
const HASH=/^sha256:[0-9a-f]{64}$/;
const newer=(a,b)=>a.payload.time-b.payload.time||a.id.localeCompare(b.id);
export function buildPostLifecycles(events){
  const posts=events.filter(e=>e?.payload?.kind==='post');
  const byId=new Map(posts.map(e=>[e.id,e]));
  const revisions=new Map(),actions=new Map(),hiddenRevisionIds=new Set();
  for(const event of posts){
    const rootId=event.payload.body.fields?.revises;
    if(typeof rootId!=='string'||!HASH.test(rootId)||rootId===event.id)continue;
    const root=byId.get(rootId);
    // A malicious stranger's alleged "edit" cannot change another key's
    // content, identity or publication rights. A missing root remains
    // visible on its own until the viewer receives the original record.
    if(!root||root.payload.author!==event.payload.author||
       root.payload.space!==event.payload.space)continue;
    // Only direct edits of a genuine root are projected into its timeline.
    // Revision-of-revision chains remain ordinary signed posts until a
    // viewer has a suitable root; this avoids ambiguous cycles.
    if(root.payload.body.fields?.revises && byId.has(root.payload.body.fields.revises))continue;
    if(!revisions.has(rootId))revisions.set(rootId,[]);
    revisions.get(rootId).push(event);hiddenRevisionIds.add(event.id);
  }
  for(const event of events){
    if(event?.payload?.kind!=='retraction')continue;
    const target=event.payload.body?.target,root=byId.get(target);
    if(!root||root.payload.author!==event.payload.author||
       root.payload.space!==event.payload.space)continue;
    if(hiddenRevisionIds.has(root.id))continue;
    if(!actions.has(target))actions.set(target,[]);
    actions.get(target).push(event);
  }
  const result=new Map();
  for(const root of posts){
    if(hiddenRevisionIds.has(root.id))continue;
    const versionHistory=[root,...(revisions.get(root.id)||[]).sort(newer)];
    const history=(actions.get(root.id)||[]).sort(newer);
    const latestAction=history.at(-1)||null;
    result.set(root.id,{
      root,display:versionHistory.at(-1),
      revisions:versionHistory,
      actions:history,
      latestAction,
      withdrawn:latestAction?.payload.body.action==='withdraw',
      // Local readers may still prefer an earlier version if they want:
      // every revision is retained, independently signed, and inspectable.
    });
  }
  return result;
}