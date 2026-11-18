// WEB9000 classic imageboard: restoration of the original image-first interface,
// backed by genuine portable signed records. Never grants namespace ownership.
import {generateIdentity,signEvent,shortAuthor} from './core/events.js';
import {Replica} from './core/replica.js';
import {openLocal,getItem,setItem} from './core/persist.js';
import {buildFeed,DEFAULT_POLICY} from './core/policy.js';
import {BrowserPeerMesh,parsePeerUrls} from './network/browser-mesh.js';
import {readSiteContext} from './network/site-context.js';
import {MockKarmaProvider} from './core/mock-karma.js';
import {exportIdentityBackup,importIdentityBackup} from './core/identity-backup.js';
import {searchPosts,tagCloud,availableSpaces,postKind} from './core/search.js';
import {deriveGroup} from './core/governance.js';
import {createGroupProof,verifyGroupProof} from './core/group-proof.js';
import {buildPostLifecycles} from './core/lifecycle.js';
import {mediaItems,primaryMedia,choosePrimaryMediaIndex,categoryForType,
  validateLocalUploads} from './core/media.js';
import {parseMediaGateways,claimsFromVerifiedEvents,chooseMediaGateways} from './core/media-discovery.js';
import {normalizeRelations,setRelation,relationFor} from './core/social-relations.js';
import {discussionRecords,filterDebugEntries,summarizeSignedEvents,DebugTrace} from './core/debug-console.js';

const $=id=>document.getElementById(id);
const state={
  db:null,identity:null,replica:new Replica({maxEvents:25000}),saved:[],outbox:[],
  peers:[],mesh:null,suggested:[],mediaBase:null,mediaMirrors:[],
  space:'commons',profileAuthor:null,sort:'new',view:'grid',search:'',showUnverified:false,
  ownerHint:null,respectOwner:true,respectWithdrawals:true,selected:null,trust:[],ignoredLabels:[],audit:false,showMedia:false,
  demo:[],demoVotes:new Map(),demoPollChoices:new Map(),demoReplies:new Map(),demoFlags:new Map(),demoTagVotes:new Map(),
  mockKarma:null,mockMode:false,demoAuthor:null,demoAutoConnect:false,autoDemoPeerDisabled:false,
  followedSpaces:['demo','commons'],showGroupSpaces:true,groupSubscriptions:[],groupViews:[],groupHeads:{},
  searchFilters:{attribute:'all',includeTags:[],excludeTags:[],excludeKinds:[],minScore:0,customField:''},
  relations:Object.create(null),debugTrace:new DebugTrace(),debugDump:null,debugItems:[],debugSelected:null,
  replyDrafts:new Map(),expandedTags:new Set(),editingPostId:null,editingMedia:[],editingFields:null,lastError:'',renderPending:false
};
const safeSpace=s=>typeof s==='string'&&s.length>0&&s.length<=180&&!/[\x00-\x1f]/.test(s);
const validTag=s=>/^[a-z0-9][a-z0-9._:-]{0,47}$/.test(s);
function normalizeMediaBase(raw){
  if(!String(raw||'').trim())return null;
  const u=new URL(String(raw).trim());
  if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)
    throw Error('Independent media peer requires an HTTP(S) URL without credentials');
  if(location.protocol==='https:'&&u.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))
    throw Error('Use HTTPS for a public media peer');
  return u.href.replace(/\/$/,'');
}
const mediaRouteCache=new Map();
function mediaCandidates(cid){
  const cacheKey=[cid,state.mediaBase,...state.mediaMirrors,...state.trust,
    state.identity?.author,state.replica.size,Math.floor(Date.now()/60000)].join('|');
  if(mediaRouteCache.has(cacheKey))return mediaRouteCache.get(cacheKey);
  const claims=claimsFromVerifiedEvents(allEvents(),{cid});
  const bases=chooseMediaGateways({cid,preferred:state.mediaBase,
    approved:state.mediaMirrors,claims,securePage:location.protocol==='https:',
    trustedAuthors:[state.identity?.author,...state.trust]});
  const urls=bases.map(base=>base+'/ipfs/'+encodeURIComponent(cid.slice(7)));
  if(mediaRouteCache.size>=200)mediaRouteCache.clear();
  mediaRouteCache.set(cacheKey,urls);
  return urls;
}
function mediaURL(cid){return mediaCandidates(cid)[0]||'';}
// Requests are made ONLY to reader-approved hosts. The signed claim changes
// fallback ranking, never authorizes visiting a previously unknown URL.
function applyMediaSource(el,cid,onFailure){
  const urls=mediaCandidates(cid);
  let attempt=0;
  el.onerror=()=>{
    if(++attempt>=urls.length){el.onerror=null;onFailure?.();return;}
    el.src=urls[attempt];
    if(el.tagName==='VIDEO')el.load();
  };
  if(urls.length)el.src=urls[0];else onFailure?.();
}

function trustedForMedia(author){
  return author===state.identity?.author||state.trust.includes(author)||
    (state.space==='demo'&&author===state.demoAuthor);
}
const toast=(msg)=>{
  const el=$('toast');el.textContent=String(msg).slice(0,280);el.classList.add('visible');
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.classList.remove('visible'),4200);
};
function element(tag,className='',text=''){
  const el=document.createElement(tag);if(className)el.className=className;
  el.textContent=text;return el;
}
function button(label,handler,className=''){
  const b=element('button',className,label);b.type='button';b.addEventListener('click',handler);return b;
}
function debugRecordEntries(source){
  if(source==='system'){
    const stats=summarizeSignedEvents(allEvents());
    return [
      {kind:'local-replica',space:state.space,raw:{
        kind:'local-replica',publicSigningKey:state.identity?.author,
        selectedSpace:state.space,verifiedRecords:stats.total,
        replicatedByKind:stats.kinds,replicatedByNamespace:stats.spaces,
        signedPosts:stats.kinds.post||0,queuedPublications:state.outbox.length,
        // A local replica is NOT proof of complete network-wide history.
        completeness:'Local signed record set only; any peer may hold additional records'}},
      {kind:'websocket-peers',space:'network',raw:{
        kind:'websocket-peers',approvedAddresses:[...state.peers],
        connected:state.mesh?.connected||0,sessionSubscriptions:state.mesh?.scopes||[],
        syncedThisSession:state.mesh?.syncedCount||0,
        outbox:state.outbox.map(item=>({
          id:item.event?.id,kind:item.event?.payload?.kind,
          acknowledgedBy:item.ackedBy||[]
        }))}},
      {kind:'ipfs-media',space:'media',raw:{
        kind:'ipfs-media',preferredGateway:state.mediaBase,
        voluntarilyApprovedBackups:[...state.mediaMirrors],
        automaticBrowserPinning:false,operatorIndependentStorage:true,
        note:'Viewing CID media does not make this browser a persistent IPFS mirror.'}},
      {kind:'group-governance',space:'groups',raw:{
        kind:'group-governance',
        voluntarilySubscribedGroups:[...state.groupSubscriptions],
        selectedGroupHeads:{...state.groupHeads},
        observedGroups:state.groupViews.map(g=>({
          id:g.id,heads:g.result.heads,
          selectedHead:g.result.selectedHead,
          groupName:g.result.state?.name,
          members:g.result.state?.members?.length||0,
          quorum:g.result.state?.quorum,
          decisionPolicy:g.result.state?.decisionPolicy||'legacy',
          delegatedChildGroups:g.result.state?.delegates||[],
          reviewerAssignments:g.result.state?.reviewers||{},
          ratifiedAmendments:g.result.ratifications?.length||0,
          pending:g.result.pending||[],
          advisoryMotions:(g.result.motions||[]).map(x=>({
            id:x.proposal,status:x.status,for:x.yes,against:x.no
          }))
        }))}},
      {kind:'presentation-policy',space:'local',raw:{
        kind:'presentation-policy',showUnverified:state.showUnverified,
        respectWithdrawals:state.respectWithdrawals,
        trustedAuthorKeysFromLegacy:[...state.trust],
        localFriends:Object.values(state.relations).filter(v=>v==='friend').length,
        localFoes:Object.values(state.relations).filter(v=>v==='foe').length,
        mockScoreMode:state.mockMode,
        note:'Personal friendship is separate from legacy media/curation trust.'}}
    ];
  }
  if(source==='network')return [...state.debugTrace.entries].reverse()
    .map((trace,i)=>({kind:trace.type,space:'',author:'',type:trace.direction,
      at:trace.at,peer:trace.peer,raw:trace,entryId:'net-'+i}));
  if(source==='dump')return (state.debugDump?.events||[]).map(event=>({
    kind:event.payload.kind,space:event.payload.space,author:event.payload.author,
    at:new Date(event.payload.time).toISOString(),id:event.id,event}));
  if(source==='social'){
    const current=Object.entries(state.relations).map(([author,relation])=>({
      kind:relation,space:'local',author,relation,origin:'personal, local-only (not signed or broadcast)'
    }));
    const legacy=state.trust.map(author=>({
      kind:'legacy-trust',space:'local',author,
      origin:'previously authorized media/feed trust, not a friend/foe label'
    }));
    return [...current,...legacy];
  }
  return [...allEvents()].reverse().map(event=>({
    kind:event.payload.kind,space:event.payload.space,author:event.payload.author,
    at:new Date(event.payload.time).toISOString(),id:event.id,event}));
}
function renderDebugConsole(){
  const dialog=$('debugDialog');if(!dialog?.open)return;
  const source=$('debugSource').value;
  const all=debugRecordEntries(source);
  const kind=$('debugKind'),oldKind=kind.value;
  kind.replaceChildren(new Option('All kinds',''));
  for(const type of [...new Set(all.map(x=>x.kind).filter(Boolean))].sort())
    kind.append(new Option(type,type));
  kind.value=[...kind.options].some(o=>o.value===oldKind)?oldKind:'';
  const filtered=filterDebugEntries(all,{
    kind:kind.value,space:$('debugSpace').value,author:$('debugAuthor').value,
    query:$('debugSearch').value,limit:Number($('debugLimit').value)
  });
  state.debugItems=filtered;
  $('debugSummary').textContent='Signed '+summarizeSignedEvents(allEvents()).total+
    ' records · '+state.mesh?.connected+' connected peer(s) · '+
    state.outbox.length+' queued · '+state.debugTrace.entries.length+
    ' buffered network packets · '+Object.values(state.relations).filter(v=>v==='friend').length+
    ' friends / '+Object.values(state.relations).filter(v=>v==='foe').length+' foes';
  const target=$('debugEntries');target.replaceChildren();
  if(source==='dump'&&state.debugDump)
    target.append(element('div','debug-dump-label',state.debugDump.label));
  for(const [i,item] of filtered.entries()){
    const caption=(item.kind||item.type||'record')+' · '+
      (item.at||'local')+' · '+(item.author||item.peer||item.id||'').slice(0,55);
    const b=button(caption,()=>selectDebugItem(i),'debug-record');
    b.setAttribute('role','listitem');
    b.dataset.debugIndex=String(i);
    if(item.id)b.title=item.id;
    if(source==='social'&&item.kind==='legacy-trust'){
      const row=element('div','debug-social-row');
      row.append(b,button('Revoke legacy trust',async()=>{
        state.trust=state.trust.filter(x=>x!==item.author);
        await store();render();renderDebugConsole();
        toast('Previous trusted-media/curation permission revoked locally.');
      }));
      target.append(row);
    }else target.append(b);
  }
  if(!filtered.length)target.append(element('div','fine',
    source==='dump'?'No matching records in this post/comment dump.':'No matching local data.'));
  const next=filtered.findIndex(item=>item.id&&item.id===state.debugSelected);
  selectDebugItem(next>=0?next:0);
  $('debugStatus').textContent=filtered.length+' shown of '+all.length+
    ' · '+(source==='network'?'Raw packet logging starts with this browser session; oversized frames are truncated.' :
      source==='social'?'Friend/foe labels are local only; no reputational score or moderation authority yet.':
      source==='dump'?'Only records already replicated into this browser can be dumped.':'Verified signed event envelopes already stored by this browser.');
}
function selectDebugItem(index){
  const item=state.debugItems[index]||null;
  state.debugSelected=item?.id||null;
  const raw=$('debugRaw');
  raw.textContent=item?JSON.stringify(item.event||item.raw||item,null,2):
    'Select a record on the left to inspect its raw JSON.';
  for(const button of $('debugEntries').querySelectorAll('[data-debug-index]'))
    button.classList.toggle('selected',Number(button.dataset.debugIndex)===index);
}
function openDebugConsole(source='events'){
  $('debugSource').value=source;
  for(const id of ['debugKind','debugSpace','debugAuthor','debugSearch'])$(id).value='';
  state.debugSelected=null;
  if(!$('debugDialog').open)$('debugDialog').showModal();
  renderDebugConsole();
}
function showDebugDump(label,events){
  state.debugDump={label,events:[...new Map(events.map(e=>[e.id,e])).values()]};
  openDebugConsole('dump');
}
function dumpSignedPost(item){
  const base=item.event,life=item.lifecycle;
  const main=life?[...life.revisions,...life.actions]:[base];
  const ids=new Set(main.map(e=>e.id));
  const metadata=allEvents().filter(e=>['reaction','tag-vote','poll-choice','label'].includes(e.payload.kind)&&
    ids.has(e.payload.body?.target));
  showDebugDump('Post and signed history · '+base.id,[...main,...metadata]);
}
function dumpSignedComments(postId){
  const bundle=discussionRecords(allEvents(),postId);
  showDebugDump('Signed comment tree · '+bundle.replyCount+' replies · '+postId,bundle.events);
}
function appendRelationButtons(container,author){
  if(author===state.identity?.author)return;
  for(const relation of ['friend','foe']){
    const b=button('',async()=>{
      try{
        const current=relationFor(state.relations,author);
        state.relations=setRelation(state.relations,state.identity.author,author,
          current===relation?null:relation);
        if(relation==='foe')state.trust=state.trust.filter(x=>x!==author);
        updateRelationControls(author);
        await store();
        if($('debugDialog')?.open)renderDebugConsole();
        toast('Personal '+(relationFor(state.relations,author)||'relationship removed')+
          ' label saved locally. No credibility score, broadcast or governance authority changed.');
      }catch(error){toast(error.message);}
    },'social-relation-action');
    b.dataset.socialAuthor=author;
    b.dataset.socialRelation=relation;
    const active=relationFor(state.relations,author)===relation;
    b.textContent=(active?'Remove ':'Add ')+relation;
    b.setAttribute('aria-pressed',String(active));
    b.classList.toggle('selected',active);
    b.title=relation==='friend'?
      'Local social label; no automatic media trust, governance power or credibility score':
      'Local foe label; no global block or credibility penalty';
    container.append(b);
  }
  updateRelationControls(author);
}
function updateRelationControls(author){
  const status=relationFor(state.relations,author);
  for(const el of document.querySelectorAll('[data-social-author]')){
    if(el.dataset.socialAuthor!==author)continue;
    const relation=el.dataset.socialRelation,active=status===relation;
    el.textContent=(active?'Remove ':'Add ')+relation;
    el.setAttribute('aria-pressed',String(active));
    el.classList.toggle('selected',active);
    el.title=relation==='friend'?
      'Personal friend label only: no automatic trusted media fetch, moderation authority or voting weight':
      'Personal foe label only: no global block, penalty or reputation change';
  }
  for(const el of document.querySelectorAll('.post[data-author]')){
    if(el.dataset.author!==author)continue;
    el.dataset.socialLabel=status||'';
  }
}
function tracePeer({direction,url,payload}){
  let type='frame';
  if(direction==='status')type='connection';
  else if(direction==='error')type='error';
  else try{type=JSON.parse(payload).type||'frame';}catch{type='malformed';}
  state.debugTrace.push({direction,peer:url,type,
    packet:direction==='in'||direction==='out'?payload:undefined,
    message:direction==='status'||direction==='error'?payload:''});
  if($('debugDialog')?.open&&$('debugSource').value==='network')
    renderDebugConsole();
}
function downloadDebugJSON(){
  const source=$('debugSource').value,body=JSON.stringify({
    format:'web9000-local-debug-export-v1',source,
    exportedAt:new Date().toISOString(),dumpLabel:source==='dump'?state.debugDump?.label:null,
    entries:state.debugItems.map(item=>item.event||item.raw||item)
  },null,2)+'\n';
  const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
  try{
    const link=document.createElement('a');link.href=url;
    link.download='web9000-debug-'+source+'-'+Date.now()+'.json';
    document.body.append(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),2000);}
}

function latestProfile(author){
  return allEvents().filter(event=>event.payload.kind==='profile'&&event.payload.author===author)
    .sort((a,b)=>b.payload.time-a.payload.time||b.id.localeCompare(a.id))[0]?.payload.body||null;
}
const who=author=>author===state.identity?.author?'You':
  (latestProfile(author)?.name?.trim()||shortAuthor(author));
function choosePolicy(){
  const known=[state.identity.author,...state.trust,...(state.ownerHint&&state.respectOwner?[state.ownerHint]:[])];
  // The *website's own demo signer* is only a suggested trust exception
  // in the explicit demo namespace. It owns neither "demo" nor any other
  // community; arbitrary authors can still publish there.
  if(state.space==='demo'&&state.demoAuthor)known.push(state.demoAuthor);
  if(state.mockMode&&state.mockKarma){
    for(const event of allEvents()){
      const author=event.payload.author;
      if(state.mockKarma.isTestQualified(author))known.push(author);
    }
  }
  const owner=state.ownerHint&&state.respectOwner?{[state.space]:state.ownerHint}:{};
  const groups={};
  for(const entry of state.groupViews){
    if(!state.groupSubscriptions.includes(entry.id))continue;
    const rules=entry.result?.state;
    if(rules)groups[entry.id]={reviewers:rules.reviewers||{},inherits:rules.delegates||[]};
  }
  return {...DEFAULT_POLICY,followedSpaces:[state.space],trustedAuthors:known,
    showUnknown:state.showUnverified,ownerPreference:owner,
    reviewerWeights:{[state.identity.author]:1},groups,
    subscriptions:state.groupSubscriptions,ignoredLabelIds:state.ignoredLabels};
}
const allEvents=()=>state.replica.list();
const currentPosts=()=>{
  const records=allEvents(),policy=choosePolicy();
  if(state.profileAuthor){
    policy.followedSpaces=[...new Set(records.map(event=>event.payload.space))];
    // Deliberately visiting one specific signing identity is an explicit
    // reader-selected raw-profile view, not global default-feed admission.
    policy.trustedAuthors=[...new Set([...policy.trustedAuthors,state.profileAuthor])];
  }
  const lifecycles=buildPostLifecycles(records);
  const all=buildFeed(records,policy,state.identity.author)
    .filter(x=>x.event.payload.kind==='post'&&lifecycles.has(x.event.id)&&
      (!state.profileAuthor||x.event.payload.author===state.profileAuthor))
    .map(x=>{
      const lifecycle=lifecycles.get(x.event.id);
      return {...x,displayBody:lifecycle.display.payload.body,lifecycle,
        decision:lifecycle.withdrawn&&state.respectWithdrawals?
          {...x.decision,visible:false,reason:'signed author withdrawal (original retained)'}:x.decision};
    });
  const f=state.searchFilters,custom=f.customField.trim();
  const sort=state.sort==='trash'?'new':state.sort;
  return searchPosts(all,{
    query:state.search,attribute:custom?'field:'+custom:f.attribute,
    includeTags:f.includeTags,excludeTags:f.excludeTags,excludeKinds:f.excludeKinds,
    minScore:f.minScore,scoreFor:author=>state.mockMode?state.mockKarma.scoreFor(author):0,
    onlyFlagged:state.sort==='trash',sort,
    reactionScore:id=>reactionScore(id,records)
  }).map(x=>({...x,demo:false}));
};
function effectiveFeed(){return currentPosts();}
const latestVotes=(kind,target,events=allEvents())=>{
  const votes=new Map();
  for(const e of events){
    if(e.payload.kind!==kind||e.payload.body.target!==target)continue;
    const key=kind==='tag-vote'?e.payload.author+'|'+e.payload.body.tag:e.payload.author;
    const previous=votes.get(key);
    if(!previous||e.payload.time>previous.payload.time||
      e.payload.time===previous.payload.time&&e.id>previous.id)votes.set(key,e);
  }
  return [...votes.values()];
};
function reactionScore(target,records=allEvents()){
  return latestVotes('reaction',target,records).reduce((sum,e)=>sum+e.payload.body.value,0);
}
function recognizedTags(post,records=allEvents(),displayBody=post.payload.body){
  const total=new Map();
  for(const raw of displayBody.fields?.tags||[]){
    if(typeof raw!=='string'||!validTag(raw))continue;
    total.set(raw,(total.get(raw)||0)+1);
  }
  for(const e of latestVotes('tag-vote',post.id,records))
    total.set(e.payload.body.tag,(total.get(e.payload.body.tag)||0)+e.payload.body.value);
  for(const [tag,value] of state.demoTagVotes.get(post.id)||[])
    total.set(tag,(total.get(tag)||0)+value);
  return [...total.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
}
function alignUnderHeader(el,margin=5){
  if(!el||!el.isConnected)return;
  const header=$('topHeader');
  const offset=(header?.getBoundingClientRect().height||0)+margin;
  const y=window.scrollY+el.getBoundingClientRect().top-offset;
  window.scrollTo({top:Math.max(0,y),behavior:'instant'});
}
function alignGridRow(card){
  if(!card)return;
  const top=card.offsetTop;
  const row=[...document.querySelectorAll('#imageGrid > .post')]
    .find(el=>Math.abs(el.offsetTop-top)<2);
  alignUnderHeader(row||card);
}
function closeSelected(){
  const id=state.selected;
  const card=[...document.querySelectorAll('#imageGrid > .post')].find(el=>el.dataset.id===id);
  const index=card?Number(card.dataset.index):-1;
  const scrollBefore=window.scrollY;
  // Preserve a reader's deliberate scroll position while the selected row
  // is already mostly visible. Align it to the header ONLY when the reader
  // is further down in the expanded body and the selected row is clipped.
  const rect=card?.getBoundingClientRect();
  const headerBottom=($('topHeader')?.getBoundingClientRect().bottom||0)+5;
  const rowVisible=rect?Math.max(0,Math.min(rect.bottom,innerHeight)-
    Math.max(rect.top,headerBottom)):0;
  const rowMostlyVisible=!!rect&&rowVisible>=Math.min(rect.height*.6,70);
  state.selected=null;
  // A programmatically activated or keyboard-selected tile can leave the
  // old reply textarea focused. Explicitly blur it before replacing its
  // expanded panel so a new incoming post can update the feed immediately.
  if(document.activeElement?.closest?.('.comment-form'))document.activeElement.blur();
  render();
  const target=id?[...document.querySelectorAll('#imageGrid > .post')].find(el=>el.dataset.id===id):null;
  const fallback=index>=0?document.querySelector('#imageGrid > .post[data-index="'+index+'"]'):null;
  if(!rowMostlyVisible){
    alignGridRow(target||fallback);
  }else{
    // Rebuilding the grid should not move the viewport simply because the
    // article detail has disappeared. The browser clamps naturally if the
    // previous position now exceeds the (shorter) document length.
    window.scrollTo({top:scrollBefore,behavior:'instant'});
  }
}
function columns(){
  const w=window.innerWidth;
  return state.view==='blog'?1:w<=410?2:w<=620?3:w<=800?4:w<=1130?5:7;
}
function signedDemoMedia(payload){
  if(payload.space!=='demo'||payload.author!==state.demoAuthor||
      payload.body?.fields?.demo!==true)return null;
  const video=payload.body.fields.demoVideo;
  if(['../thumb/thumb04.mp4','../thumb/thumb10.mp4'].includes(video))
    return {type:'video',src:video};
  const audio=payload.body.fields.demoAudio;
  if(audio==='../content/festival_theme.mp3')return {type:'audio',src:audio};
  return null;
}
// One lifetime-long audio engine, shared by compact tile and expanded player.
// Rendering or closing an article never creates a second sound source or
// interrupts playback. Both controls observe the same transport.
const sharedAudio=new Audio();
const audioBackupRoutes=new Map();
sharedAudio.preload='none';
let activeAudioURL='';
const absoluteAudioURL=source=>new URL(source,document.baseURI).href;
function syncAudioPlayers(){
  const duration=sharedAudio.duration||0;
  const stamp=seconds=>{
    const n=Math.max(0,Math.floor(seconds||0));
    return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
  };
  for(const wrap of document.querySelectorAll('.mini-audio')){
    const matching=wrap.dataset.audioSrc===activeAudioURL;
    const playing=matching&&!sharedAudio.paused&&!sharedAudio.ended;
    wrap.classList.toggle('playing',playing);
    const toggle=wrap.querySelector('.mini-audio-toggle');
    if(toggle)toggle.textContent=playing?'Ⅱ':'▶';
    const progress=wrap.querySelector('.mini-audio-progress');
    if(progress)progress.value=String(matching&&duration>0?
      Math.round(1000*sharedAudio.currentTime/duration):0);
    const clock=wrap.querySelector('.mini-audio-clock');
    if(clock)clock.textContent=stamp(matching?sharedAudio.currentTime:0)+
      (wrap.classList.contains('compact')?'':' / '+stamp(matching?duration:0));
  }
}
for(const type of ['play','pause','timeupdate','loadedmetadata','ended','seeked'])
  sharedAudio.addEventListener(type,syncAudioPlayers);
sharedAudio.addEventListener('error',()=>{
  const urls=audioBackupRoutes.get(activeAudioURL)||[];
  const next=urls.indexOf(sharedAudio.src)+1;
  if(next>0&&next<urls.length){
    sharedAudio.src=urls[next];sharedAudio.load();
    void sharedAudio.play().catch(()=>{});
  }else if(activeAudioURL)toast('This audio is unavailable from your selected media peers.');
});
function miniAudio(source,{compact=false,cid=null}={}){
  const src=absoluteAudioURL(source);
  if(cid){
    if(audioBackupRoutes.size>=250)audioBackupRoutes.clear();
    audioBackupRoutes.set(src,mediaCandidates(cid));
  }
  const wrap=element('div','mini-audio'+(compact?' compact':''));
  wrap.dataset.audioSrc=src;
  const play=button('▶',e=>{
    e.stopPropagation();
    if(activeAudioURL!==src){
      sharedAudio.pause();activeAudioURL=src;sharedAudio.src=src;sharedAudio.load();
    }
    if(sharedAudio.paused)sharedAudio.play().catch(()=>toast('Unable to play audio'));
    else sharedAudio.pause();
    syncAudioPlayers();
  },'mini-audio-toggle');
  play.setAttribute('aria-label','Play or pause sound');
  const waveform=element('div','mini-wave');
  for(let i=0;i<33;i++){
    const bar=element('i');
    bar.style.height=(14+Math.round(75*Math.abs(Math.sin(i*.74)*Math.cos(i*.29))))+'%';
    waveform.append(bar);
  }
  const progress=element('input','mini-audio-progress');
  progress.type='range';progress.min='0';progress.max='1000';progress.step='1';progress.value='0';
  progress.setAttribute('aria-label','Seek through sound');
  progress.addEventListener('input',e=>{
    e.stopPropagation();
    if(activeAudioURL===src&&Number.isFinite(sharedAudio.duration)&&sharedAudio.duration>0)
      sharedAudio.currentTime=sharedAudio.duration*Number(progress.value)/1000;
  });
  for(const type of ['pointerdown','click','keydown'])
    progress.addEventListener(type,e=>e.stopPropagation());
  const clock=element('span','mini-audio-clock','0:00');
  wrap.append(play,waveform,progress,clock);
  return wrap;
}
function miniVideo(source,cid=null){
  const wrap=element('div','mini-video-player');
  const video=document.createElement('video');
  video.preload='metadata';video.muted=true;video.playsInline=true;
  if(cid)applyMediaSource(video,cid);else video.src=source;
  video.className='mini-video-frame';
  const controls=element('div','mini-video-controls');
  const play=button('▶',()=>video.paused?
    video.play().catch(()=>toast('Video could not play')):video.pause(),'mini-video-play');
  play.setAttribute('aria-label','Play or pause video');
  const timeline=element('input','mini-video-timeline');
  timeline.type='range';timeline.min='0';timeline.max='1000';timeline.value='0';
  timeline.setAttribute('aria-label','Seek through video');
  timeline.oninput=()=>{
    if(Number.isFinite(video.duration)&&video.duration>0)
      video.currentTime=video.duration*Number(timeline.value)/1000;
  };
  const clock=element('span','mini-video-clock','0:00');
  const volume=element('input','mini-video-volume');
  volume.type='range';volume.min='0';volume.max='100';volume.value='0';volume.step='1';
  volume.setAttribute('aria-label','Video volume');
  volume.oninput=()=>{
    video.volume=Number(volume.value)/100;
    video.muted=Number(volume.value)===0;
  };
  const time=t=>{
    const n=Math.max(0,Math.floor(t||0));
    return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
  };
  video.addEventListener('timeupdate',()=>{
    timeline.value=String(video.duration>0?Math.round(video.currentTime/video.duration*1000):0);
    clock.textContent=time(video.currentTime)+' / '+time(video.duration);
  });
  video.addEventListener('play',()=>play.textContent='Ⅱ');
  video.addEventListener('pause',()=>play.textContent='▶');
  video.addEventListener('ended',()=>play.textContent='▶');
  video.addEventListener('click',()=>play.click());
  controls.append(play,volume,timeline,clock);
  wrap.append(video,controls);
  return wrap;
}
function addDemoVideoHover(card,payload){
  const demo=signedDemoMedia(payload);
  if(demo?.type!=='video')return;
  const target=card.querySelector('.post-thumb,.post-text-preview,.post-reveal');
  if(!target)return;
  const video=document.createElement('video');
  video.className='hover-video';video.muted=true;video.loop=true;video.playsInline=true;
  video.preload='none';video.setAttribute('aria-label','Hovering plays demo video preview');
  const progress=element('div','hover-video-progress');
  let loaded=false;
  card.addEventListener('mouseenter',()=>{
    if(!loaded){video.src=demo.src;loaded=true;}
    video.play().catch(()=>{});
  });
  card.addEventListener('mouseleave',()=>{
    video.pause();if(video.readyState>=1)video.currentTime=0;
    progress.style.width='0%';
  });
  video.addEventListener('timeupdate',()=>{
    progress.style.width=(Number.isFinite(video.duration)&&video.duration>0?
      Math.min(100,100*video.currentTime/video.duration):0)+'%';
  });
  target.insertAdjacentElement('afterend',video);
  card.append(progress);
}
function tile(item,i,replyCounts){
  const p=item.event.payload,b=item.displayBody||p.body;
  const category=b.fields?.presentation||'image';
  // Mixed is a text-promoting layout. Even media posts without a currently
  // fetchable thumbnail stay a single cell, never 3 or 9.
  const proseOnly=['text','discussion','idea'].includes(category)&&
    !item.thumb&&!b.media?.length&&!signedDemoMedia(p);
  const card=element('div','post'+(item.decision?.visible?'':' filtered')+
    (proseOnly?' text-only':''));
  card.dataset.index=String(i);card.dataset.id=item.event.id;card.dataset.kind=postKind(item);
  card.dataset.author=p.author;card.dataset.socialLabel=relationFor(state.relations,p.author)||'';
  card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',b.title||'Post');
  const demoMedia=signedDemoMedia(p);
  if(demoMedia?.type==='audio'){
    card.append(miniAudio(demoMedia.src,{compact:true}));
    card.classList.add('sound-tile');
  }else if(demoMedia?.type==='video'){
    // The old signed demo contained unrelated image CIDs/posters.
    // Use this video's own first frame rather than a picture of another post.
    const frame=document.createElement('video');
    frame.className='post-thumb video-poster';frame.src=demoMedia.src;
    frame.muted=true;frame.playsInline=true;frame.preload='metadata';
    frame.setAttribute('aria-label','Video thumbnail');
    card.append(frame);
  }else if(item.thumb){
    const img=document.createElement('img');img.className='post-thumb';img.loading='lazy';img.src=item.thumb;img.alt=b.title||'Demo picture';
    card.append(img);
  } else if(b.media?.length){
    const primary=primaryMedia(b);
    if(item.decision?.visible&&state.mediaBase&&trustedForMedia(p.author)&&primary){
      // Browser media is only fetched from a viewer-chosen media peer
      // for authored or explicitly trusted records, never all raw posts.
      const src=mediaURL(primary.cid);
      if(primary.kind==='audio'){
        card.classList.add('sound-tile');
        card.append(miniAudio(src,{compact:true,cid:primary.cid}));
      }else if(primary.kind==='video'){
        const frame=document.createElement('video');
        frame.className='post-thumb media-video-tile';
        applyMediaSource(frame,primary.cid);frame.playsInline=true;frame.muted=true;
        frame.loop=true;frame.preload='metadata';
        frame.setAttribute('aria-label','Video thumbnail from your selected media peer');
        frame.onmouseenter=()=>frame.play().catch(()=>{});
        frame.onmouseleave=()=>{frame.pause();frame.currentTime=0;};
        card.append(frame);
      }else{
        const img=document.createElement('img');
        img.className='post-thumb';img.loading='lazy';img.alt=b.title||'Trusted image';
        applyMediaSource(img,primary.cid,()=>img.replaceWith(element('div','post-reveal',
          'Media unavailable · open to inspect')));
        card.append(img);
      }
    } else {
      card.append(element('div','post-reveal','IPFS media · open to choose what to load'));
    }
  }else{
    card.append(element('div','post-text-preview',b.text||b.title||'Text post'));
  }
  const copy=element('div','post-copy');
  if(b.title)copy.append(element('div','post-headline',b.title));
  if(b.text)copy.append(element('div','post-description',b.text));
  card.append(copy);
  const icons=[];
  if(item.lifecycle?.revisions.length>1)icons.push('✎ '+(item.lifecycle.revisions.length-1)+' corrections');
  if(item.lifecycle?.withdrawn)icons.push('⊘ Withdrawn');
  const kind=b.fields?.presentation||'image';
  if(item.video||(p.author===state.demoAuthor&&p.space==='demo'&&b.fields?.demoVideo))
    icons.push('▶ Video');
  else if(b.media?.length>1)icons.push('▤ '+b.media.length+' attachments');
  else if(kind==='offer')icons.push('◇ Offer');
  else if(kind==='project')icons.push('◆ Project');
  else if(kind==='idea')icons.push('✦ Idea');
  else if(kind==='job')icons.push('◈ Jobs');
  else if(kind==='discussion'||kind==='text')icons.push('☰ Text');
  else if(item.thumb||b.media?.length)icons.push('▣ Image');
  if(b.fields?.schedule)icons.push('▦ Meetup');
  if(b.fields?.poll)icons.push('◉ Poll');
  if(b.fields?.positions?.length&&kind!=='job')icons.push('◈ '+b.fields.positions.length+' roles');
  const replyCount=replyCounts.get(item.event.id)||0;
  if(replyCount)icons.push('☏ '+replyCount);
  const visibleIcons=icons.filter(x=>!['▣ Image','☰ Text','▶ Video','♪ Sound'].includes(x));
  if(visibleIcons.length){
    card.classList.add('has-icons');
    const box=element('div','post-icons');
    for(const iconText of visibleIcons){
      const chip=element('span','post-icon-bubble',iconText);
      const text=iconText.toLowerCase();
      chip.title=text.startsWith('☏')?
        replyCount+' direct signed '+(replyCount===1?'comment':'comments')+
          ' on this post. Open to view the conversation.':
        text.includes('meetup')?'This post includes an event date/location':
        text.includes('poll')?'This post contains a poll with voting options':
        text.includes('attachments')?'This post contains multiple image, audio or video attachments':
        text.includes('jobs')||text.includes('roles')?'Open positions associated with this post':
        text.includes('offer')?'Marketplace offer/listing':
        text.includes('project')?'Collaborative project post':
        'Signed post attribute: '+iconText;
      chip.setAttribute('aria-label',chip.title);
      box.append(chip);
    }
    card.append(box);
  }
  if(p.space==='demo'&&p.author===state.demoAuthor&&b.fields?.demo)
    card.append(element('div','post-small demo-label','EXAMPLE · SIGNED'));
  else if(!item.decision?.visible)card.append(element('div','post-small','FILTERED · AUDIT'));
  addDemoVideoHover(card,p);
  card.addEventListener('click',()=>{ if(state.selected===item.event.id)closeSelected();else expand(item.event.id); });
  return card;
}
function updateNetworkStatus(){
  if(!state.identity)return;
  $('peerStatus').textContent=(state.mesh?.connected||0)+' peer(s) · '+
    allEvents().filter(e=>e.payload.kind==='post').length+
    ' signed posts · '+state.outbox.length+' queued';
  $('joinNetwork').textContent=state.mesh?.connected?'◉ Network':'Join Network';
  $('joinNetwork').classList.toggle('connected',!!state.mesh?.connected);
  $('mockModeLabel').hidden=!state.mockMode;
  $('mockModeLabel').textContent=state.mockMode?'SIMULATED KARMA — NOT STAKE':'';
}
function renderProfileHeader(){
  const header=$('profileHeader');
  if(!state.profileAuthor){header.hidden=true;header.replaceChildren();return;}
  header.hidden=false;header.replaceChildren();
  const author=state.profileAuthor,info=latestProfile(author)||{};
  const authored=allEvents().filter(event=>event.payload.author===author);
  const histories=[...buildPostLifecycles(authored).values()];
  const posts=histories.map(life=>life.root);
  const corrections=histories.reduce((sum,life)=>sum+life.revisions.length-1,0);
  const withdrawn=histories.filter(life=>life.withdrawn).length;
  const replies=authored.filter(event=>event.payload.kind==='reply');
  const score=posts.reduce((sum,event)=>sum+reactionScore(event.id),0);
  const name=element('h2','profile-title',info.name?.trim()||shortAuthor(author));
  const key=element('div','profile-key',author);
  const heading=element('div','profile-heading');
  heading.append(name,key);
  const stats=element('div','profile-stats');
  for(const [title,val] of [
    ['Posts',posts.length],['Corrections',corrections],['Withdrawn',withdrawn],
    ['Replies',replies.length],['Received vote score',score],
    ['Local test karma',state.mockMode?state.mockKarma.scoreFor(author)+'/100':'Not verified']]){
    const entry=element('div','profile-stat');
    entry.append(element('b','',String(val)),element('span','',title));stats.append(entry);
  }
  const description=element('p','profile-description',
    info.description||'No signed profile description published yet.');
  header.append(heading,stats,description);
  if(info.website){
    try{
      const url=new URL(info.website);
      if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){
        const link=document.createElement('a');link.href=url.href;link.target='_blank';
        link.rel='noopener noreferrer nofollow';link.textContent=url.hostname;
        link.className='profile-website';header.append(link);
      }
    }catch{}
  }
  const actions=element('div','profile-actions');
  actions.append(button('← Back to board',()=>selectSpace(state.space)));
  appendRelationButtons(actions,author);
  if(author===state.identity.author)
    actions.append(button('Edit my profile / identity',()=>{openIdentitySettings();$('profileEditor').open=true;}));
  if(!state.mockMode)actions.append(element('span','profile-status',
    'Karma/stake not independently verified on this experimental network.'));
  header.append(actions);
}
function showProfile(author){
  if(!/^ed25519:[A-Za-z0-9_-]{43}$/.test(author))return toast('Invalid signing identity');
  state.profileAuthor=author;
  state.selected=null;
  const u=new URL(location.href);u.searchParams.set('profile',author);
  history.pushState({},'',u.pathname+u.search+u.hash);
  render();
  alignUnderHeader($('profileHeader'));
}
function render(){
  if(!state.identity)return;
  // Never replace a textarea node while the user is composing a reply.
  // Network batches and group updates can arrive between individual
  // keystrokes; deferring the visual redraw protects the active draft.
  if(document.activeElement?.closest?.('.comment-form')){
    state.deferredDuringComment=true;
    updateNetworkStatus();return;
  }
  const feed=effectiveFeed(),grid=$('imageGrid');
  const prev=state.selected;
  grid.className='grid '+state.view;
  renderSpaces();
  renderRecommendedSpaces();
  renderProfileHeader();
  renderTagCloud();
  // Index reply counts once per render, instead of scanning the entire
  // replica for each image tile (the old code was O(posts × events)).
  const replyCounts=new Map();
  for(const event of allEvents()){
    if(event.payload.kind!=='reply')continue;
    const id=event.payload.body.parent;
    replyCounts.set(id,(replyCounts.get(id)||0)+1);
  }
  const nodes=feed.map((item,i)=>tile(item,i,replyCounts));
  grid.replaceChildren(...nodes);
  updateNetworkStatus();
  $('feedStatus').textContent=feed.length+' '+(feed.length===1?'post':'posts')+
    (state.profileAuthor?' on this author’s profile':' in /'+state.space)+' · '+(state.sort==='trash'?'suppressed by your current view':'public signed records')+
    (state.mesh?.connected?' · synced peer':' · connect to a peer to synchronize');
  $('searchCount').textContent=feed.length+' match'+(feed.length===1?'':'es');
  if(prev && feed.some(x=>x.event.id===prev))expand(prev,{focus:false});
  else state.selected=null;
  syncAudioPlayers();
}
function updateOpenDiscussion(){
  // Incoming network batches can contain hundreds of unrelated records. Do
  // not replace an expanded post's entire DOM for every post/ACK: doing so
  // discards form focus before the browser delivers the next keystroke.
  const panel=document.querySelector('.post-container.expanded');
  if(!panel||!state.selected)return false;
  const item=getSelected();
  if(!item){
    // Reader's normal feed may have changed because the author withdrew a
    // publication. Do not leave stale content pretending it is still live.
    state.selected=null;
    render();
    return true;
  }
  const newDisplayId=item.lifecycle?.display.id||item.event.id;
  if(panel.dataset.displayId!==newDisplayId||
     panel.dataset.withdrawn!==String(item.lifecycle?.withdrawn||false)){
    if(document.activeElement?.closest?.('.comment-form')){
      state.deferredDuringComment=true;return true;
    }
    const y=window.scrollY;
    expand(item.event.id,{focus:false});
    window.scrollTo({top:y,behavior:'instant'});
    return true;
  }
  const old=panel.querySelector('.comments-section');
  if(old){
    // Only replace a discussion when that *particular signed thread* changed.
    // New posts, votes and labels from unrelated spaces cannot detach a
    // comment editor while the reader is about to start typing.
    const scratch=element('div');
    renderReplies(scratch,item.event);
    const next=scratch.querySelector('.comments-section');
    if(next?.dataset.threadsKey!==old.dataset.threadsKey){
      if(document.activeElement?.closest?.('.comment-form')){
        state.deferredDuringComment=true;
      }else old.replaceWith(next);
    }
  }
  const score=panel.querySelector('.reactions .score');
  if(score)score.textContent=String(reactionScore(item.event.id));
  const mine=latestVotes('reaction',item.event.id).find(event=>
    event.payload.author===state.identity.author)?.payload.body.value;
  for(const btn of panel.querySelectorAll('.reactions [data-reaction-value]')){
    const selected=Number(btn.dataset.reactionValue)===mine;
    btn.classList.toggle('selected',selected);
    btn.setAttribute('aria-pressed',String(selected));
  }
  const currentIds=[...document.querySelectorAll('#imageGrid > .post')].map(x=>x.dataset.id);
  const nextIds=effectiveFeed().map(x=>x.event.id);
  const status=$('feedStatus');
  if(currentIds.length!==nextIds.length||currentIds.some((id,i)=>id!==nextIds[i])){
    status.replaceChildren(element('span','','Feed updated while this discussion is open. '),
      button('Refresh board',()=>{state.selected=null;render();},'refresh-board'));
  }
  updateNetworkStatus();
  return true;
}
function scheduleRender(){
  if(state.renderPending)return;
  state.renderPending=true;
  queueMicrotask(()=>{
    state.renderPending=false;
    if(updateOpenDiscussion())return;
    if(document.activeElement?.closest?.('.comment-form')){
      state.deferredDuringComment=true;
      updateNetworkStatus();return;
    }
    render();
  });
}
function getSelected(){return effectiveFeed().find(x=>x.event.id===state.selected);}
async function store(){
  if(!state.db)return;
  await Promise.all([
    setItem(state.db,'records',state.saved),
    setItem(state.db,'outbox',state.outbox),
    setItem(state.db,'peer-urls',state.peers),
    setItem(state.db,'classic-space',state.space),
    setItem(state.db,'classic-trust',state.trust),
    setItem(state.db,'classic-social-relations',state.relations),
    setItem(state.db,'classic-ignored-labels',state.ignoredLabels),
    setItem(state.db,'classic-show-unknown',state.showUnverified),
    setItem(state.db,'classic-respect-withdrawals',state.respectWithdrawals),
    setItem(state.db,'classic-view',state.view),
    setItem(state.db,'classic-show-media',state.showMedia),
    setItem(state.db,'classic-media-url',state.mediaBase),
    setItem(state.db,'classic-media-mirrors',state.mediaMirrors),
    setItem(state.db,'classic-mock-mode',state.mockMode),
    setItem(state.db,'classic-mock-scores',state.mockKarma?.snapshot()||{}),
    setItem(state.db,'classic-followed-spaces',state.followedSpaces),
    setItem(state.db,'classic-group-subscriptions',state.groupSubscriptions),
    setItem(state.db,'classic-group-heads',state.groupHeads),
    setItem(state.db,'classic-show-group-spaces',state.showGroupSpaces),
    setItem(state.db,'classic-auto-demo-peer-disabled',state.autoDemoPeerDisabled)
  ]);
}
async function ingest(e,{outgoing=false}={}){
  const response=await state.replica.ingest(e);
  if(!response.accepted)return response;
  if(!response.duplicate){
    state.saved.push(e);if(outgoing)state.outbox.push({event:e,ackedBy:[]});
    await store();scheduleRender();
  }
  return response;
}
async function publish(kind,body,{space=state.space}={}){
  const e=await signEvent(state.identity,{kind,space,body});
  const result=await ingest(e,{outgoing:true});
  if(!result.accepted)throw Error(result.reason||'record rejected');
  const sent=state.mesh?.publish(e)||0;
  toast(sent?'Signed and sent to '+sent+' peer(s)':'Signed locally; queued for peer connection');
  return e;
}
function modal(id){$(id).showModal();}
function close(id){$(id).close();}
function otherRecords(target,kind){
  return allEvents().filter(e=>e.payload.kind===kind&&e.payload.body.target===target);
}
async function react(id,value){
  try{
    await publish('reaction',{target:id,value});
    // Score/selected styling updates in place on ingest. Rebuilding an
    // expanded panel or moving focus here used to jump to the page bottom.
    updateOpenDiscussion();
  }catch(e){toast('Reaction not accepted: '+e.message);}
}
async function tagVote(id,tag,value){
  try{await publish('tag-vote',{target:id,tag,value});}
  catch(e){toast('Tag vote not accepted: '+e.message);}
}
async function pollVote(id,option){
  try{await publish('poll-choice',{target:id,option});}
  catch(e){toast('Poll vote not accepted: '+e.message);}
}
async function appendReply(post,textarea,parent=post.id){
  const content=textarea.value.trim();if(!content)return;
  try{
    const message=await publish('reply',{parent,title:'',text:content});
    state.replyDrafts.delete(post.id+'|'+parent);
    textarea.value='';
    // The draft is committed; clear its focus so the signed result can
    // replace the thread without either stealing input or scrolling.
    if(document.activeElement===textarea)textarea.blur();
    // Keep the reading position fixed. Newly signed replies are reconciled
    // into this discussion without any programmatic scroll.
    updateOpenDiscussion();
    toast('Signed reply '+message.id.slice(0,18)+'…');
  }catch(error){toast('Could not publish reply: '+error.message);}
}
function addCommentForm(area,post,parent=post.id){
  const box=element('div','comment-form');
  const ta=document.createElement('textarea');ta.placeholder=parent===post.id?'Write a comment...':'Reply to comment...';
  const draftKey=post.id+'|'+parent;
  ta.value=state.replyDrafts.get(draftKey)||'';
  ta.addEventListener('input',()=>{
    if(ta.value)state.replyDrafts.set(draftKey,ta.value);
    else state.replyDrafts.delete(draftKey);
  });
  box.append(ta,button('Send signed reply',()=>appendReply(post,ta,parent)));
  area.append(box);return box;
}
function formatDate(t){
  const time=typeof t==='number'?new Date(t):new Date(t);
  return Number.isNaN(time.getTime())?'Unknown date':time.toLocaleString();
}
function renderReplies(body,post){
  // A signed reply is anchored to its immediate parent, not just to the
  // original post. Render actual nested subtrees with rails next to the text,
  // so third-level replies remain visibly attached to the right discussion.
  const trustedAuthors=new Set(choosePolicy().trustedAuthors);
  const byParent=new Map();
  for(const event of allEvents()){
    if(event.payload.kind!=='reply')continue;
    if(!state.showUnverified&&!trustedAuthors.has(event.payload.author))continue;
    const parent=event.payload.body.parent;
    if(!byParent.has(parent))byParent.set(parent,[]);
    byParent.get(parent).push(event);
  }
  for(const replies of byParent.values())
    replies.sort((a,b)=>a.payload.time-b.payload.time||a.id.localeCompare(b.id));
  const section=element('section','comments-section');
  const heading=element('h3','','Discussion');
  section.append(heading);
  const visited=new Set();
  let rendered=0;
  function walk(parent,container,depth){
    if(depth>=10||rendered>=300)return;
    for(const reply of byParent.get(parent)||[]){
      if(visited.has(reply.id)||rendered>=300)continue;
      visited.add(reply.id);rendered++;
      const comment=element('article','comment');
      comment.dataset.commentId=reply.id;
      comment.dataset.parentId=parent;
      const head=element('div','comment-head');
      head.append(element('b','',who(reply.payload.author)),
        document.createTextNode(' · '+formatDate(reply.payload.time)));
      comment.append(head,element('div','comment-text',reply.payload.body.text));
      const actions=element('div','comment-actions');
      const replyButton=button('↳ Reply',()=>{
        const existing=comment.querySelector(':scope > .comment-form');
        if(existing){existing.remove();replyButton.setAttribute('aria-expanded','false');return;}
        const form=addCommentForm(comment,post,reply.id);
        if(children.isConnected)comment.insertBefore(form,children);
        // Otherwise addCommentForm already appended it after the action row.
        replyButton.setAttribute('aria-expanded','true');
        form.querySelector('textarea')?.focus();
      },'comment-reply');
      replyButton.setAttribute('aria-expanded','false');
      actions.append(replyButton);
      const children=element('div','comment-children');
      comment.append(actions,children);
      container.append(comment);
      walk(reply.id,children,depth+1);
      const childCount=children.querySelectorAll(':scope > .comment').length;
      if(childCount){
        const total=children.querySelectorAll('.comment').length;
        const collapse=button('− '+total+' '+(total===1?'reply':'replies'),()=>{
          children.hidden=!children.hidden;
          collapse.textContent=(children.hidden?'+ Show ':'− ')+total+' '+(total===1?'reply':'replies');
          collapse.setAttribute('aria-expanded',String(!children.hidden));
        },'comment-collapse');
        collapse.setAttribute('aria-expanded','true');
        actions.append(collapse);
      }else children.remove();
    }
  }
  walk(post.id,section,0);
  heading.textContent='Comments ('+rendered+(rendered>=300?'+':'')+')';
  section.dataset.threadsKey=[...visited].sort().join('|');
  if(rendered>=300)section.append(element('p','comment-limit','Showing first 300 visible comments; records remain available in the signed index.'));
  addCommentForm(section,post);
  body.append(section);
}
function renderReportControl(post){
  const report=element('details','report-control');
  const toggle=element('summary','','⚑ Report');
  toggle.title='Publish an independently signed allegation, not a global ban';
  const form=element('div','report-form');
  const select=document.createElement('select');
  select.setAttribute('aria-label','Report category');
  for(const [tag,label] of [
    ['spam','Mass-produced commercial spam'],
    ['scam','Fraud / scam'],
    ['malware','Malicious executable or link'],
    ['suspected-illegal-media','Potentially prohibited media (metadata only)'],
    ['other','Other / request review']
  ]){
    const option=document.createElement('option');
    option.value=tag;option.textContent=label;select.append(option);
  }
  const reason=document.createElement('textarea');
  reason.placeholder='Describe what you observed, with evidence. Avoid personal information.';
  reason.maxLength=500;reason.rows=2;
  const explanation=element('p','fine',
    'A report is a signed allegation, not a finding or deletion. Your own local rules may hide spam/scam/malware; others decide independently.');
  const send=button('Sign report',async()=>{
    const detail=reason.value.trim();
    if(detail.length<4)return toast('Please describe the report (at least 4 characters).');
    send.disabled=true;
    try{
      const record=await publish('label',{
        target:post.id,tag:select.value,reason:detail
      },{space:post.payload.space});
      report.open=false;
      toast('Signed allegation '+record.id.slice(0,18)+'… published. See Audit or Trash to inspect it.');
      render();
    }catch(error){toast('Report was not published: '+error.message);}
    finally{send.disabled=false;}
  },'report-submit');
  form.append(select,reason,explanation,send);
  report.append(toggle,form);
  return report;
}
function markAudit(body,item){
  const post=item.event;
  const labels=allEvents().filter(e=>e.payload.kind==='label'&&e.payload.body.target===post.id)
    .sort((a,b)=>a.payload.time-b.payload.time);
  if(!state.audit&&!labels.length)return;
  const section=element('section','audit-summary');
  section.append(element('b','',
    item.decision.visible?'Audit · visible under your current rules':'Audit · filtered by your currently selected rules'));
  section.append(element('p','',
    item.decision.reason+' · The original signed publication remains intact and may still be mirrored by willing independent peers.'));
  const applied=new Set((item.decision.labels||[]).map(e=>e.id));
  if(!labels.length)section.append(element('p','','No signed reports or steward labels exist for this record.'));
  for(const label of labels){
    const ignored=state.ignoredLabels.includes(label.id);
    const row=element('div','audit-entry'+(ignored?' ignored':''));
    const byline=element('div','audit-byline',
      who(label.payload.author)+' · '+formatDate(label.payload.time)+' · '+label.payload.body.tag);
    const status=element('small','audit-status',
      ignored?'Ignored by your local view':applied.has(label.id)?'Considered by your current policy':'Not authoritative in your current view');
    row.append(byline,status,element('p','audit-reason',label.payload.body.reason));
    const controls=element('div','audit-actions');
    controls.append(button(ignored?'Restore this label':'Ignore this label locally',async()=>{
      if(state.ignoredLabels.includes(label.id))
        state.ignoredLabels=state.ignoredLabels.filter(id=>id!==label.id);
      else if(state.ignoredLabels.length<2000)state.ignoredLabels.push(label.id);
      else return toast('Too many local ignored labels');
      await store();
      render();
      toast('Your local interpretation changed. No signed records or other users were affected.');
    }));
    controls.append(button('Copy signed label ID',()=>navigator.clipboard?.writeText(label.id).then(()=>toast('Label ID copied'))));
    row.append(controls);
    section.append(row);
  }
  section.append(element('small','audit-footer',
    'A moderator or site steward cannot remove this post from anyone else’s index. Labels are visible evidence, not a universal verdict.'));
  body.append(section);
}
function showMultiImageGallery(body,post){
  const cids=post.payload.body.media.slice(0,12);
  const area=element('div','attachments media-gallery');
  const stage=element('div','gallery-stage');
  const navigation=element('div','gallery-navigation');
  const thumbs=element('div','gallery-thumbnails');
  const counter=element('span','gallery-count');
  const allowed=new Set(state.mediaBase&&trustedForMedia(post.payload.author)?cids:[]);
  const specified=post.payload.body.fields?.primaryMediaIndex;
  let index=Number.isInteger(specified)&&specified>=0&&specified<cids.length?specified:0;
  function draw(){
    const cid=cids[index];
    stage.replaceChildren();
    if(allowed.has(cid)){
      const img=document.createElement('img');
      img.alt='Image '+(index+1)+' of '+cids.length;
      img.loading='eager';
      applyMediaSource(img,cid,()=>img.replaceWith(element('div','gallery-placeholder',
        'Image unavailable from approved media peers.')));
      stage.append(img);
    }else{
      const placeholder=element('div','gallery-placeholder',
        'Image '+(index+1)+' · no automatic download from unknown authors');
      placeholder.append(button('Load this image',()=>{
        if(!state.mediaBase)return toast('Choose an independent media peer before loading this attachment.');
        allowed.add(cid);draw();
      },'gallery-load'));
      stage.append(placeholder);
    }
    counter.textContent=(index+1)+' / '+cids.length;
    thumbs.replaceChildren();
    for(let j=0;j<cids.length;j++){
      const b=button(String(j+1),()=>{index=j;draw();},
        'gallery-thumb'+(j===index?' active':''));
      b.title='View image '+(j+1);
      b.setAttribute('aria-label','View image '+(j+1));
      if(allowed.has(cids[j])){
        const preview=document.createElement('img');
        preview.className='gallery-thumb-image';
        preview.loading='lazy';
        applyMediaSource(preview,cids[j]);
        preview.alt='';
        b.replaceChildren(preview);
      }
      thumbs.append(b);
    }
  }
  navigation.append(button('‹ Previous',()=>{index=(index+cids.length-1)%cids.length;draw();},'gallery-prev'),
    counter,
    button('Next ›',()=>{index=(index+1)%cids.length;draw();},'gallery-next'));
  area.append(stage,navigation,thumbs);
  area.append(button('Copy current CID',()=>{
    navigator.clipboard?.writeText(cids[index]).then(()=>toast('CID copied'));
  },'gallery-copy cid-copy'));
  draw();body.append(area);
}
// Attachment carousel can combine any supported media category. Selecting an
// item is an explicit user action; unknown authors do not trigger media fetch.
function showMixedMediaGallery(body,post){
  const items=mediaItems(post.payload.body).slice(0,12);
  const primary=primaryMedia(post.payload.body);
  let selected=primary?.index||0;
  const trusted=trustedForMedia(post.payload.author)&&!!state.mediaBase;
  const allowed=new Set(trusted?items.map(x=>x.cid):[]);
  const area=element('div','attachments media-gallery mixed-media-gallery');
  const stage=element('div','gallery-stage mixed-gallery-stage');
  const navigation=element('div','gallery-navigation');
  const thumbs=element('div','gallery-thumbnails mixed-gallery-thumbnails');
  const count=element('span','gallery-count');
  const kinds={image:'Image',audio:'Sound',video:'Video'};
  function draw(){
    const item=items[selected];
    for(const video of stage.querySelectorAll('video'))video.pause();
    stage.replaceChildren();thumbs.replaceChildren();
    if(allowed.has(item.cid)){
      const src=mediaURL(item.cid);
      if(item.kind==='image'){
        const image=document.createElement('img');
        image.loading='eager';
        image.alt='Image '+(selected+1)+' of '+items.length;
        applyMediaSource(image,item.cid,()=>image.replaceWith(element('div','gallery-placeholder',
          'Image unavailable from approved media peers.')));
        stage.append(image);
      }else if(item.kind==='audio'){
        stage.append(element('div','mixed-media-kind','♪ AUDIO · '+(selected+1)+' / '+items.length));
        stage.append(miniAudio(src,{cid:item.cid}));
      }else if(item.kind==='video'){
        stage.append(miniVideo(src,item.cid));
      }
    }else{
      const box=element('div','gallery-placeholder',
        kinds[item.kind]+' attachment '+(selected+1)+
        ' · no automatic download from unknown authors');
      box.append(button('Load this attachment',()=>{
        if(!state.mediaBase)return toast('Connect to an independent media peer first.');
        allowed.add(item.cid);draw();
      },'gallery-load'));
      stage.append(box);
    }
    count.textContent=(selected+1)+' / '+items.length;
    for(const [index,other] of items.entries()){
      const chip=button('',()=>{selected=index;draw();},
        'gallery-thumb mixed-attachment-chip'+(index===selected?' active':''));
      chip.title=kinds[other.kind]+' attachment '+(index+1);
      chip.setAttribute('aria-label',chip.title);
      if(other.kind==='image'&&allowed.has(other.cid)){
        const thumb=document.createElement('img');
        thumb.className='gallery-thumb-image';applyMediaSource(thumb,other.cid);
        thumb.alt='';thumb.loading='lazy';chip.append(thumb);
      }else chip.textContent=(other.kind==='audio'?'♪':other.kind==='video'?'▶':'▣')+
        ' '+(index+1);
      thumbs.append(chip);
    }
    syncAudioPlayers();
  }
  if(items.length>1){
    navigation.append(button('‹ Previous',()=>{selected=(selected+items.length-1)%items.length;draw();},
      'gallery-prev'),count,
      button('Next ›',()=>{selected=(selected+1)%items.length;draw();},'gallery-next'));
  }else navigation.append(count);
  area.append(stage,navigation,thumbs);
  draw();body.append(area);
}
function showMedia(body,post){
  if(!post.payload.body.media?.length)return;
  if(mediaItems(post.payload.body).some(item=>item.kind!=='image')){
    showMixedMediaGallery(body,post);
    return;
  }
  if(post.payload.body.media.length>1){
    showMultiImageGallery(body,post);
    return;
  }
  const area=element('div','attachments');
  for(const cid of post.payload.body.media){
    const wrap=element('div','media-ref');
    const short=cid.slice(0,32)+'…';
    wrap.append(element('div','',short));
    const load=button('Load image manually',()=>{
      const url=state.mediaBase;
      if(!url){toast('No independent IPFS media gateway configured. The signed CID can be copied to another gateway.');return;}
      const img=document.createElement('img');
      img.loading='eager';img.alt='Explicitly loaded IPFS attachment';
      applyMediaSource(img,cid,()=>{
        img.replaceWith(element('p','','Image unavailable from approved peers. CID remains signed.'));
      });
      wrap.replaceChildren(img);
    });
    if(state.mediaBase&&trustedForMedia(post.payload.author)){
      // Safe-to-fetch self / explicitly trusted images render in the
      // expanded post without an additional manual click.
      load.click();
    }else{
      wrap.append(load);
    }
    wrap.append(button('Copy CID',()=>navigator.clipboard?.writeText(cid).then(()=>toast('CID copied')),'cid-copy'));
    area.append(wrap);
  }
  body.append(area);
}
function redrawCurrentWithoutScroll(id){
  const top=window.scrollY;
  expand(id,{focus:false});
  window.scrollTo({top,behavior:'instant'});
}
function expand(id,{focus=true}={}){
  const feed=effectiveFeed(),index=feed.findIndex(x=>x.event.id===id);
  if(index<0)return;
  state.selected=id;
  const current=feed[index],p=current.event.payload,b=current.displayBody||p.body;
  for(const container of document.querySelectorAll('.post-container'))container.remove();
  for(const tile of document.querySelectorAll('.post.selected'))tile.classList.remove('selected');
  const cards=[...document.querySelectorAll('.post')],card=cards[index];
  card.classList.add('selected');
  const panel=element('div','post-container expanded'),row=element('div','expanded-row');
  panel.dataset.displayId=current.lifecycle?.display.id||id;
  panel.dataset.withdrawn=String(current.lifecycle?.withdrawn||false);
  const left=element('span','nav-arrow','◀'),right=element('span','nav-arrow','▶');
  left.tabIndex=0;right.tabIndex=0;
  left.addEventListener('click',()=>navigate(-1));right.addEventListener('click',()=>navigate(1));
  const body=element('div','expanded-body');
  const mediaRoot=element('div','post-main-media');
  body.append(mediaRoot);
  const heading=element('div','post-detail-heading');
  heading.append(element('h2','',b.title||'Untitled post'));
  body.append(heading);
  const metadata=element('div','details-line');
  const authorControl=button('From '+who(p.author),()=>showProfile(p.author),'author-profile-link');
  authorControl.title='Open public profile for this signing key';
  const authorWrap=element('span');authorWrap.append(authorControl);
  metadata.append(authorWrap,
    element('span','','Space: '+p.space),element('span','',formatDate(p.time)));
  if(p.space==='demo'&&p.author===state.demoAuthor&&b.fields?.demo)
    metadata.append(element('span','demo-note','SIGNED DEMO RECORD · stored on independent peer'));
  else if(state.mockMode)metadata.append(element('span','mock-score-detail',
    'SIMULATED SCORE '+state.mockKarma.scoreFor(p.author)+'/100 — NOT ON-CHAIN'));
  if(b.fields?.presentation)metadata.append(element('span','',b.fields.presentation.toUpperCase()));
  body.append(metadata);
  if(current.lifecycle){
    const l=current.lifecycle;
    if(l.withdrawn){
      const notice=element('div','author-withdrawal');
      notice.append(element('strong','','Author requested withdrawal — original still independently retrievable'));
      if(l.latestAction?.payload.body.reason)
        notice.append(element('span','',l.latestAction.payload.body.reason));
      notice.append(element('small','','Your selected view hides this in normal feeds; other clients and mirrors may retain it.'));
      body.append(notice);
    }
    if(l.revisions.length>1){
      const marker=element('span','signed-revision-note',
        'Corrected · '+(l.revisions.length-1)+' signed '+(l.revisions.length===2?'revision':'revisions'));
      metadata.append(marker);
    }
  }
  if(signedDemoMedia(p)?.type==='audio'){
    const player=miniAudio(signedDemoMedia(p).src);
    mediaRoot.append(player);
  }
  if(current.thumb&&!signedDemoMedia(p)){
    const region=element('div','attachments'),img=document.createElement('img');
    img.src=current.thumb;img.alt=b.title||'Demo image';img.loading='eager';img.decoding='async';region.append(img);mediaRoot.append(region);
  }else if(!signedDemoMedia(p))showMedia(mediaRoot,current.lifecycle?.display||current.event);
  // Earlier example video events accidentally contained unrelated photo CIDs;
  // they remain in the signed event for audit, never presented as video art.

  const demoVideo=signedDemoMedia(p)?.type==='video'?signedDemoMedia(p).src:null;
  if(demoVideo){
    const region=element('div','attachments');
    region.append(miniVideo(demoVideo));mediaRoot.append(region);
  }
  if(!mediaRoot.children.length)mediaRoot.remove();
  if(b.text)body.append(element('p','',b.text));
  const field=b.fields||{};
  if(field.schedule){
    const date=element('div','schedule');
    date.append(element('strong','','Event schedule'));
    for(const [label,value] of [['Starts',field.schedule.start],['Ends',field.schedule.end],['Place',field.schedule.location]]){
      if(value)date.append(element('p','',label+': '+(label==='Place'?value:formatDate(value))));
    }body.append(date);
  }
  if(field.price){
    const value=typeof field.price==='object'&&field.price!==null?
      [field.price.amount,field.price.currency].filter(x=>x!==undefined&&x!==null).join(' '):
      String(field.price);
    if(value)body.append(element('div','listing-price','Listed price: '+value));
  }
  const structured=new Set(['tags','presentation','schedule','poll','positions','price','demo',
    'demoVersion','demoVideo','media','mediaTypes','primaryMediaIndex','revises']);
  const other=element('dl','extra-attributes');
  let attributes=0;
  for(const [name,value] of Object.entries(field)){
    if(structured.has(name)||attributes>=16||name.startsWith('_'))continue;
    const display=(typeof value==='string'||typeof value==='number'||typeof value==='boolean')?
      String(value):Array.isArray(value)&&value.length<=12&&value.every(x=>typeof x==='string'||
      typeof x==='number')?value.join(', '):null;
    if(display===null)continue;
    other.append(element('dt','',name.replace(/[-_]/g,' ')),
      element('dd','',display.slice(0,500)));
    attributes++;
  }
  if(attributes)body.append(other);
  if(field.positions?.length){
    const block=element('div','positions');block.append(element('strong','','Open positions'));
    for(const position of field.positions)block.append(element('p','',position));
    body.append(block);
  }
  if(field.poll?.options?.length){
    const choices=latestVotes('poll-choice',id);
    const voted=choices.find(e=>e.payload.author===state.identity.author)?.payload.body.option;
    const total=choices.length;
    const poll=element('section','poll poll-card');
    poll.setAttribute('aria-label','Post poll');
    poll.append(element('div','poll-eyebrow','◉ POLL · '+total+
      (total===1?' VOTE':' VOTES')));
    poll.append(element('h3','poll-question',field.poll.question));
    const options=element('div','poll-options');
    for(const [i,opt] of field.poll.options.entries()){
      const tally=choices.filter(e=>e.payload.body.option===i).length;
      const percent=total?Math.round(tally/total*100):0;
      const selected=voted===i;
      const buttonEl=button('',async()=>{
        await pollVote(id,i);
        if(state.selected===id)redrawCurrentWithoutScroll(id);
      },'poll-option'+(selected?' selected':''));
      buttonEl.setAttribute('aria-pressed',String(selected));
      buttonEl.setAttribute('aria-label',opt+': '+tally+
        (tally===1?' vote':' votes')+' ('+percent+' percent)');
      const fill=element('span','poll-option-fill');
      fill.style.width=percent+'%';
      const text=element('span','poll-option-text',
        (selected?'✓ ':'○ ')+opt);
      buttonEl.append(fill,text,
        element('span','poll-option-count',tally+' · '+percent+'%'));
      options.append(buttonEl);
    }
    poll.append(options,element('p','poll-foot','Select an option to publish your signed vote. Results count the latest signed vote per author.'));
    body.append(poll);
  }
  const tags=element('div','label-row');
  const allTags=recognizedTags(current.event,allEvents(),b);
  const showAll=state.expandedTags.has(id);
  for(const [name,count] of (showAll?allTags:allTags.slice(0,20))){
    const chip=element('span','tag-chip');
    const tagLabel=button('#'+name,()=>{},'tag-name');
    tagLabel.title='Find posts with #'+name;
    tagLabel.onclick=()=>{
      const include=$('searchIncludeTags');
      const included=new Set(include.value.split(',').map(v=>v.trim()).filter(Boolean));
      included.add(name);include.value=[...included].join(', ');
      readSearchFilters();state.search='';$('searchPosts').value='';
      closeSelected();showSearch(true);render();
    };
    chip.append(tagLabel,element('span','tag-count',String(count)));
    const myVote=latestVotes('tag-vote',id).find(event=>
      event.payload.author===state.identity.author&&event.payload.body.tag===name)?.payload.body.value;
    const up=button('+',()=>tagVote(id,name,1),'tag-up'+(myVote===1?' selected':''));
    const down=button('−',()=>tagVote(id,name,-1),'tag-down'+(myVote===-1?' selected':''));
    up.title='Support this tag';down.title='Disagree with this tag';
    up.setAttribute('aria-pressed',String(myVote===1));
    down.setAttribute('aria-pressed',String(myVote===-1));
    chip.append(up,down);tags.append(chip);
  }
  if(allTags.length>20&&!showAll){
    tags.append(button('…',()=>{
      state.expandedTags.add(id);expand(id,{focus:false});
    },'tag-more'));
  }
  tags.append(button('+ add tag',()=>{
    const input=window.prompt('Tag (letters, numbers, period, dash, colon or underscore)');
    const tag=String(input||'').trim().toLowerCase();
    if(!tag)return;
    if(!validTag(tag))return toast('Invalid tag name');
    tagVote(id,tag,1);
  },'tag-add'));
  const votes=element('div','reactions');
  const chosenReaction=latestVotes('reaction',id).find(event=>
    event.payload.author===state.identity.author)?.payload.body.value||null;
  if(current.demo){
    votes.append(element('span','score',String(state.demoVotes.get(id)||0)));
    for(const [label,v] of [['++',2],['+',1],['−',-1],['−−',-2]]){
      votes.append(button(label,()=>{
        state.demoVotes.set(id,v);
        expand(id,{focus:false});
        toast('Preview reaction only — no signed publication.');
      }));
    }
    votes.append(button('Flag / Report',()=>{
      const reason=window.prompt('Preview report reason (local only)');
      if(reason){
        state.demoFlags.set(id,reason.slice(0,500));
        expand(id,{focus:false});
        toast('Preview flag recorded locally — no moderation action broadcast.');
      }
    }));
    body.append(votes);
    const explanation=element('div','demo-notice',
      'Interactive local preview. Votes, reports and comments here are not broadcast, staked or saved to the public network.');
    if(state.demoFlags.has(id))explanation.append(element('div','','Your preview report: '+state.demoFlags.get(id)));
    body.append(explanation);
    renderReplies(body,current.event);
  }else{
    votes.append(element('span','score',String(reactionScore(id))));
    for(const [label,v] of [['++',2],['+',1],['−',-1],['−−',-2]]){
      const type=v===2?'vote-max':v===1?'vote-up':v===-1?'vote-down':'vote-min';
      const action=button(label,()=>react(id,v),type+(chosenReaction===v?' selected':''));
      action.dataset.reactionValue=String(v);
      action.setAttribute('aria-pressed',String(chosenReaction===v));
      action.title=(chosenReaction===v?'Your selected vote: ':'Vote: ')+label;
      votes.append(action);
    }
    votes.append(renderReportControl(current.event));
    votes.append(button(state.audit?'− Audit':'⚖ Audit',()=>{
      state.audit=!state.audit;expand(id,{focus:false});
    },'audit-action'));
    if(state.mockMode)votes.append(button('Test karma…',()=>openMockKarma(p.author)));
    appendRelationButtons(votes,p.author);
    votes.append(button('Dump post',()=>dumpSignedPost(current),'source-action'));
    votes.append(button('Dump comments',()=>dumpSignedComments(current.event.id),'source-action'));
    body.append(votes);
    if(current.lifecycle){
      const life=current.lifecycle;
      const controls=element('div','publication-lifecycle-controls');
      if(p.author===state.identity.author){
        controls.append(button('✎ Correct this post',()=>openCorrection(current),'correct-post'));
        controls.append(button(life.withdrawn?'↻ Restore in your feed':'⊘ Request withdrawal',
          ()=>changeWithdrawal(current),'withdraw-post'));
      }
      const history=element('details','publication-history');
      const summary=element('summary','',
        'Signed history · '+life.revisions.length+' '+(life.revisions.length===1?'version':'versions')+
        ', '+life.actions.length+' author withdrawal/restore events');
      history.append(summary);
      for(const e of life.revisions){
        const row=element('div','history-row');
        row.append(element('span','history-date',formatDate(e.payload.time)),
          element('strong','',e===life.root?'Original signed post':'Signed correction'),
          element('span','',e.payload.body.title||'Untitled'));
        const read=element('details','history-readable-version');
        read.append(element('summary','','Read this immutable version'));
        if(e.payload.body.text)read.append(element('p','history-post-text',e.payload.body.text));
        const names=e.payload.body.fields?.tags||[];
        if(names.length)read.append(element('p','history-post-tags',
          names.filter(x=>typeof x==='string').map(x=>'#'+x).join('  ')));
        const attachments=e.payload.body.media||[];
        if(attachments.length)read.append(element('p','history-post-media',
          attachments.length+' originally attached IPFS reference(s) remain part of the signed event. '+
          'Media may no longer be hosted by the peer you selected.'));
        row.append(read);
        row.append(button('Inspect signed event',()=>showDebugDump(
          'Historical signed event '+e.id.slice(0,20),[e]),'history-copy'));
        history.append(row);
      }
      for(const e of life.actions){
        const row=element('div','history-row');
        row.append(element('span','history-date',formatDate(e.payload.time)),
          element('strong','',e.payload.body.action==='withdraw'?'Withdrawal request':'Restore request'));
        if(e.payload.body.reason)row.append(element('span','',e.payload.body.reason));
        history.append(row);
      }
      controls.append(history);
      body.append(controls);
    }
    markAudit(body,current);renderReplies(body,current.event);
  }
  // Primary media first, then headline and provenance, voting controls,
  // tag chips, prose/poll/attributes and finally signed discussion.
  // No close button: click the selected grid tile again or press Escape.
  metadata.after(votes,tags);
  row.append(left,body,right);panel.append(row);
  // Insert below the *actual rendered CSS grid row*, including mixed tiles.
  const top=card.offsetTop;let end=card;
  for(const next of cards.slice(index+1)){
    if(next.offsetTop!==top)break;end=next;
  }
  end.after(panel);
  syncAudioPlayers();
  if(focus){card.focus({preventScroll:true});alignGridRow(card);}
}
function navigate(direction){
  const feed=effectiveFeed(),idx=feed.findIndex(x=>x.event.id===state.selected);
  if(idx<0)return;
  const next=idx+direction;if(next>=0&&next<feed.length)expand(feed[next].event.id);
}
function onKey(e){
  const target=e.target;
  if(target.matches?.('input,textarea,select,[contenteditable],dialog')||target.closest?.('dialog'))return;
  if(e.key==='Escape'){if(state.selected){e.preventDefault();closeSelected();}return;}
  const keys={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right'};
  if(e.key==='Enter'&&target.classList?.contains('post')){e.preventDefault();expand(target.dataset.id);return;}
  if(!keys[e.key])return;
  const tiles=[...document.querySelectorAll('.post')];if(!tiles.length)return;
  const index=Math.max(0,tiles.findIndex(x=>x===target));
  const cur=tiles[index],pos=cur.getBoundingClientRect(),cy=pos.top,cx=pos.left+pos.width/2;
  let next;
  if(keys[e.key]==='left')next=tiles[Math.max(0,index-1)];
  else if(keys[e.key]==='right')next=tiles[Math.min(tiles.length-1,index+1)];
  else{
    const isDown=keys[e.key]==='down';
    const adjacent=tiles.filter(t=>isDown?t.getBoundingClientRect().top>cy+2:t.getBoundingClientRect().top<cy-2);
    if(!adjacent.length)return;
    const rowY=Math[isDown?'min':'max'](...adjacent.map(t=>t.getBoundingClientRect().top));
    next=adjacent.filter(t=>Math.abs(t.getBoundingClientRect().top-rowY)<2)
      .sort((a,b)=>Math.abs(a.getBoundingClientRect().left+a.offsetWidth/2-cx)-
        Math.abs(b.getBoundingClientRect().left+b.offsetWidth/2-cx))[0];
  }
  if(next){e.preventDefault();next.focus({preventScroll:true});if(state.selected){expand(next.dataset.id,{focus:false});alignGridRow(next);}else next.scrollIntoView({block:'nearest'});}
}
function openIdentitySettings(){
  $('identityPublicKey').textContent=state.identity.author;
  const profile=latestProfile(state.identity.author)||{};
  $('profileName').value=profile.name||'';
  $('profileDescription').value=profile.description||'';
  $('profileWebsite').value=profile.website||'';
  $('identityPassword').value='';
  $('identityMessage').textContent='';
  $('identityDialog').showModal();
}
function identityMessage(message){
  $('identityMessage').textContent=message;
  toast(message);
}
function renderMockRoster(){
  const target=$('mockRoster');target.replaceChildren();
  for(const {author,score} of state.mockKarma.entries()){
    const row=element('div','mock-entry',author.slice(0,25)+'… · '+score+'/100');
    row.append(button('Edit',()=>{$('mockIdentity').value=author;$('mockScore').value=String(score);}));
    row.append(button('×',async()=>{
      state.mockKarma.clear(author);await store();renderMockRoster();render();
    }));
    target.append(row);
  }
  if(!target.children.length)target.append(element('p','fine','No simulated scores assigned.'));
}
function openMockKarma(author=state.identity?.author){
  $('mockIdentity').value=MockKarmaProvider.validIdentity(author)?author:state.identity.author;
  $('mockScore').value=String(state.mockKarma.scoreFor($('mockIdentity').value));
  $('mockEnabled').checked=state.mockMode;
  renderMockRoster();
  $('mockDialog').showModal();
}
function selectSpace(name){
  if(!safeSpace(name))return toast('Invalid namespace');
  if(state.profileAuthor){
    state.profileAuthor=null;
    const u=new URL(location.href);u.searchParams.delete('profile');
    history.replaceState({},'',u.pathname+u.search+u.hash);
  }
  state.space=name;
  state.selected=null;
  $('spaceName').value=name;
  void store();
  render();
}
function renderSpaces(){
  const spaces=availableSpaces(allEvents(),[...state.followedSpaces,'demo','commons']);
  const top=$('spaceLinks'),all=$('allSpaceLinks');top.replaceChildren();all.replaceChildren();
  const listed=spaces.filter(s=>state.followedSpaces.includes(s.name));
  if(!listed.some(s=>s.name===state.space))listed.unshift({name:state.space,count:0});
  for(const entry of listed.slice(0,14)){
    const label='/'+entry.name+(entry.count?' '+entry.count:'');
    const b=button(label,()=>selectSpace(entry.name),'space-chip');
    b.classList.toggle('active',state.space===entry.name);
    b.title='Open public namespace '+entry.name;
    top.append(b);
  }
  const visible=spaces.slice(0,100);
  for(const entry of visible){
    const row=element('div','space-option');
    row.append(button('/'+entry.name+' · '+entry.count+' posts',()=>selectSpace(entry.name),'space-open'));
    const following=state.followedSpaces.includes(entry.name);
    row.append(button(following?'Following ✓':'+ Follow',async()=>{
      state.followedSpaces=following?state.followedSpaces.filter(x=>x!==entry.name):
        [...new Set([...state.followedSpaces,entry.name])].slice(0,80);
      await store();render();
    },'space-follow'));
    all.append(row);
  }
}
function renderRecommendedSpaces(){
  const row=$('recommendedSpaceNav'),links=$('recommendedSpaceLinks');
  const toggle=$('toggleRecommendedSpaces');
  toggle.textContent=state.showGroupSpaces?'Hide':'Show';
  links.replaceChildren();row.classList.toggle('collapsed',!state.showGroupSpaces);
  if(!state.showGroupSpaces){
    links.append(element('span','recommended-empty','Recommendations hidden in this browser'));
    return;
  }
  const names=new Map();
  for(const group of state.groupViews){
    if(!state.groupSubscriptions.includes(group.id))continue;
    const recommended=group.result.state.recommendedSpaces||[];
    for(const name of recommended){
      if(!safeSpace(name))continue;
      const sponsors=names.get(name)||[];
      sponsors.push(group.result.state.name);
      names.set(name,sponsors);
    }
  }
  for(const [name,sponsors] of [...names].slice(0,18)){
    const chip=button('/'+name,()=>selectSpace(name),'group-space-chip');
    chip.title='Suggested by '+sponsors.join(', ')+' — not an ownership claim';
    chip.classList.toggle('active',name===state.space);
    links.append(chip);
  }
  if(!names.size)
    links.append(element('span','recommended-empty',
      'Follow a clan that recommends spaces, or publish recommendations in your own group charter'));
}
function renderTagCloud(){
  const records=allEvents(),policy=choosePolicy();
  const visible=buildFeed(records,policy,state.identity.author)
    .filter(x=>x.event.payload.kind==='post'&&x.decision.visible);
  const cloud=$('tagCloud');cloud.replaceChildren();
  const f=state.searchFilters;
  for(const {tag,count} of tagCloud(visible,{max:32})){
    const b=button('#'+tag+' '+count,e=>{},'cloud-tag');
    b.onclick=event=>{
      const excluded=event.shiftKey;
      const input=excluded?$('searchExcludeTags'):$('searchIncludeTags');
      const opposite=excluded?$('searchIncludeTags'):$('searchExcludeTags');
      const tags=new Set(input.value.split(',').map(x=>x.trim()).filter(Boolean));
      if(tags.has(tag))tags.delete(tag);else tags.add(tag);
      input.value=[...tags].join(', ');
      opposite.value=opposite.value.split(',').map(x=>x.trim()).filter(x=>x!==tag).join(', ');
      readSearchFilters();render();
    };
    b.title='Click to require; Shift+click to exclude';
    b.classList.toggle('required',f.includeTags.includes(tag));
    b.classList.toggle('excluded',f.excludeTags.includes(tag));
    cloud.append(b);
  }
}
function readSearchFilters(){
  const f=state.searchFilters;
  f.attribute=$('searchAttribute').value;
  f.customField=$('searchCustomField').value.trim().toLowerCase();
  f.includeTags=$('searchIncludeTags').value.toLowerCase().split(/[,;]+/).map(x=>x.trim()).filter(validTag).slice(0,30);
  f.excludeTags=$('searchExcludeTags').value.toLowerCase().split(/[,;]+/).map(x=>x.trim()).filter(validTag).slice(0,30);
  f.excludeKinds=[...document.querySelectorAll('[data-exclude-kind]:checked')].map(x=>x.dataset.excludeKind);
  f.minScore=Math.max(0,Math.min(100,Number($('searchMinScore').value)||0));
}
function chooseSort(sort){
  state.sort=sort;state.audit=sort==='trash';
  document.querySelectorAll('[data-sort],[data-search-sort]').forEach(btn=>{
    btn.classList.toggle('active',(btn.dataset.sort||btn.dataset.searchSort)===sort);
  });
  render();
}
function showSearch(open=true){
  $('searchPanel').hidden=!open;
  $('showSearchOptions').setAttribute('aria-expanded',String(open));
}
let groupRefreshPending=false;
async function refreshGroups(){
  if(groupRefreshPending)return;
  groupRefreshPending=true;
  try{
    const events=allEvents();
    const charters=events.filter(e=>e.payload.kind==='group').slice(0,50);
    const next=[];
    for(const event of charters){
      try{
        const result=await deriveGroup(events.filter(e=>['group','proposal','vote'].includes(e.payload.kind)),
          event.id,{maxEvents:5000,selectedHead:state.groupHeads[event.id]||null});
        if(result.found)next.push({id:event.id,event,result});
      }catch(error){console.warn('Invalid group charter',error);}
    }
    state.groupViews=next.sort((a,b)=>a.result.state.name.localeCompare(b.result.state.name));
    renderGroupList();renderRecommendedSpaces();
  }finally{groupRefreshPending=false;}
}
function downloadGroupProof(bundle,groupId){
  const body=JSON.stringify(bundle,null,2)+'\n';
  if(new TextEncoder().encode(body).byteLength>2*1024*1024)
    throw Error('Proof is too large for the bounded local verifier (2 MiB)');
  const blob=new Blob([body],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  try{
    const link=document.createElement('a');
    link.href=url;link.download='web9000-group-proof-'+groupId.slice(7,21)+'.json';
    document.body.append(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
function renderGroupList(){
  const box=$('groupList');if(!box)return;
  box.replaceChildren();
  if(!state.groupViews.length)
    box.append(element('p','groups-empty','No signed groups discovered at connected peers yet. Create one to start a voluntary group.'));
  for(const {id,event,result} of state.groupViews){
    const section=element('section','group-entry');
    const head=element('div','group-heading');
    head.append(element('strong','',result.state.name),
      element('small','',result.state.members.length+' voting members · '+
        (result.state.decisionPolicy?.mode==='timed-v1'?'7-day motions / safeguarded amendments':
          'legacy signed-member quorum')));
    section.append(head);
    if(result.state.description)section.append(element('p','',result.state.description));
    section.append(element('small','group-key',id.slice(0,24)+'… · '+
      (result.heads.length>1?'competing ratified branches':'independently signed governance')));
    if(result.heads.length>1||state.groupHeads[id]){
      const choice=element('select','group-branch');
      choice.setAttribute('aria-label','Select ratified group history for '+result.state.name);
      for(const candidate of [id,...result.heads.filter(head=>head!==id)]){
        const stateFor=result.states.find(item=>item.head===candidate);
        if(!stateFor)continue;
        const option=document.createElement('option');
        option.value=candidate;
        option.textContent=(candidate===id?'Founding charter':'Revision '+stateFor.revision)+
          ' · '+stateFor.name+' · '+candidate.slice(7,19);
        option.selected=candidate===result.selectedHead;
        choice.append(option);
      }
      choice.onchange=async()=>{
        state.groupHeads[id]=choice.value;
        await store();await refreshGroups();
      };
      section.append(element('small','','Reader-selected governance branch:'),choice);
    }
    const controls=element('div','group-actions');
    const followed=state.groupSubscriptions.includes(id);
    controls.append(button(followed?'Following ✓':'+ Follow policy',async()=>{
      state.groupSubscriptions=followed?state.groupSubscriptions.filter(x=>x!==id):
        [...new Set([...state.groupSubscriptions,id])];
      await store();renderGroupList();renderRecommendedSpaces();
    }));
    controls.append(button('Export signed proof',async()=>{
      try{
        const records=allEvents().filter(e=>['group','proposal','vote'].includes(e.payload.kind));
        const proof=await createGroupProof(records,id,{
          head:result.ambiguous?null:result.selectedHead});
        const report=await verifyGroupProof(proof);
        if(!report.valid)throw Error(report.reason);
        downloadGroupProof(proof,id);
        toast('Exported '+report.includedEventCount+
          ' signed records. Proof verifies the selected history, not a globally latest head.');
      }catch(error){toast('Proof export: '+error.message);}
    }));
    const member=result.state.members.includes(state.identity?.author);
    const requested=allEvents().some(e=>e.payload.kind==='membership'&&
      e.payload.body.group===id&&e.payload.author===state.identity?.author&&
      e.payload.body.action==='request');
    controls.append(button(member?'Member ✓':requested?'Requested ✓':'Request membership',async()=>{
      if(member||requested)return;
      try{await publish('membership',{group:id,action:'request'},{space:'groups'});await refreshGroups();}
      catch(error){toast('Could not request membership: '+error.message);}
    }));
    section.append(controls);
    if(result.ambiguous)section.append(element('p','',
      'Different branches have quorum-backed signatures. This browser shows the founding charter until you choose a branch; no universal winner exists.'));
    if(result.ratifications.length){
      const ratified=element('details','group-certificates');
      ratified.append(element('summary','','Signed approval evidence · '+result.ratifications.length));
      for(const proof of result.ratifications.slice(-20)){
        const row=element('p','',proof.changeType+' · '+proof.approved+'/'+
          proof.required+' eligible member approvals · '+proof.proposal.slice(7,20));
        row.title='Independent signatures included in exported branch proof; only members at the parent snapshot count';
        ratified.append(row);
      }
      section.append(ratified);
    }
    if(member&&!result.ambiguous){
      const edit=element('details','group-edit');
      edit.append(element('summary','','Propose updated group information'));
      const form=element('form','group-creator');
      const nameLabel=element('label','','Group name');
      const name=document.createElement('input');name.required=true;name.maxLength=80;name.value=result.state.name;
      const descLabel=element('label','','Description');
      const desc=document.createElement('textarea');desc.maxLength=2000;desc.rows=3;desc.value=result.state.description;
      const spacesLabel=element('label','','Recommended spaces (comma separated)');
      const spaces=document.createElement('input');spaces.maxLength=600;
      spaces.value=result.state.recommendedSpaces.join(', ');
      nameLabel.append(name);descLabel.append(desc);spacesLabel.append(spaces);
      const submit=element('button','','Propose and sign approval');submit.type='submit';
      form.append(nameLabel,descLabel,spacesLabel,submit);
      form.onsubmit=async e=>{
        e.preventDefault();submit.disabled=true;
        try{
          const proposal=await publish('proposal',{group:id,parent:result.selectedHead,
            change:{type:'set-group-info',name:name.value.trim(),description:desc.value,
              recommendedSpaces:parseCSV(spaces.value).slice(0,20)}},{space:'groups'});
          await publish('vote',{proposal:proposal.id,choice:'approve'},{space:'groups'});
          await refreshGroups();
          toast('Signed group-information proposal published. Approval must reach member quorum.');
        }catch(error){toast('Group amendment: '+error.message);}
        finally{submit.disabled=false;}
      };
      edit.append(form);section.append(edit);
      if(result.state.decisionPolicy?.mode==='timed-v1'){
        const motionBox=element('details','group-motions');
        motionBox.append(element('summary','','Propose a 7-day ordinary vote'));
        const form=element('form','group-creator');
        const titleLabel=element('label','','Question / decision');
        const title=document.createElement('input');title.required=true;title.maxLength=160;
        const textLabel=element('label','','Context');
        const text=document.createElement('textarea');text.maxLength=2000;text.rows=3;
        titleLabel.append(title);textLabel.append(text);
        const submit=element('button','','Sign proposal');submit.type='submit';
        form.append(titleLabel,textLabel,submit);
        form.onsubmit=async e=>{
          e.preventDefault();submit.disabled=true;
          try{
            const proposal=await publish('proposal',{group:id,parent:result.selectedHead,
              change:{type:'resolution',title:title.value.trim(),text:text.value}},{space:'groups'});
            await refreshGroups();
            toast('7-day signed vote published. It does not change group authority.');
          }catch(error){toast('Proposal failed: '+error.message);}
          finally{submit.disabled=false;}
        };
        motionBox.append(form);section.append(motionBox);
      }else{
        section.append(button('Propose timed voting policy',async()=>{
          try{
            const proposal=await publish('proposal',{group:id,parent:result.selectedHead,
              change:{type:'set-decision-policy',mode:'timed-v1'}},{space:'groups'});
            await publish('vote',{proposal:proposal.id,choice:'approve'},{space:'groups'});
            await refreshGroups();
            toast('Policy change proposed. Existing charter remains until independently ratified.');
          }catch(error){toast('Policy proposal: '+error.message);}
        }));
      }
    }
    if(member){
      for(const req of allEvents().filter(e=>e.payload.kind==='membership'&&
        e.payload.body.group===id&&e.payload.body.action==='request'&&
        !result.state.members.includes(e.payload.author)).slice(0,12)){
        const row=element('div','group-request',shortAuthor(req.payload.author)+' requests membership');
        row.append(button('Propose admission',async()=>{
          try{
            if(result.ambiguous)throw Error('Select one governance branch first');
            const proposal=await publish('proposal',{group:id,parent:result.selectedHead,
              change:{type:'add-member',author:req.payload.author}},{space:'groups'});
            await publish('vote',{proposal:proposal.id,choice:'approve'},{space:'groups'});
            await refreshGroups();
          }catch(error){toast('Admission failed: '+error.message);}
        }));
        section.append(row);
      }
      for(const pending of result.pending.slice(0,20)){
        const proposal=allEvents().find(e=>e.id===pending.id);
        if(!proposal||proposal.payload.body.change.type==='resolution')continue;
        const snapshot=result.states.find(item=>item.head===proposal.payload.body.parent);
        if(!snapshot?.members.includes(state.identity.author))continue;
        const already=allEvents().some(e=>e.payload.kind==='vote'&&
          e.payload.body.proposal===pending.id&&e.payload.author===state.identity.author&&
          e.payload.body.choice==='approve');
        const change=proposal.payload.body.change;
        const description=change.type==='set-group-info'?'Group information: '+change.name:
          change.type==='add-member'?'Admission: '+shortAuthor(change.author):
          change.type.replaceAll('-',' ');
        const progress=Number.isInteger(pending.required)?
          ' · signatures '+pending.approved+'/'+pending.required:'';
        const timeout=pending.closesAt?' · declared deadline '+
          new Date(pending.closesAt).toLocaleDateString():'';
        const row=element('div','group-request',description+progress+timeout+' · '+pending.reason);
        if(!already)for(const choice of ['approve','reject'])row.append(button(choice,async()=>{
          try{
            await publish('vote',{proposal:pending.id,choice},{space:'groups'});
            await refreshGroups();
          }catch(error){toast('Ballot failed: '+error.message);}
        }));
        section.append(row);
      }
    }
    for(const motion of (result.motions||[]).slice(-12)){
      const row=element('div','group-motion');
      row.append(element('strong','',motion.title));
      if(motion.text)row.append(element('p','',motion.text));
      const meaning=motion.status==='supported'?'Locally supported (advisory)':
        motion.status==='insufficient-turnout'?'No valid turnout':
        motion.status==='open'?'Voting open (local clock)':motion.status;
      const meta=element('small','',meaning+' · For '+motion.yes+' · Against '+motion.no+
        ' · turnout '+motion.participation+'/'+motion.required+' minimum · closes '+
        new Date(motion.closesAt).toLocaleString());
      meta.title='Signed timestamps do not establish independently witnessed real-world time. A different replica may have additional ballots.';
      row.append(meta);
      if(motion.status==='open'&&motion.eligibleAuthors.includes(state.identity?.author)){
        const actions=element('div','group-actions');
        for(const [choice,label] of [['approve','For'],['reject','Against']])
          actions.append(button(label,async()=>{
            try{
              await publish('vote',{proposal:motion.proposal,choice},{space:'groups'});
              await refreshGroups();
            }catch(error){toast('Ballot failed: '+error.message);}
          }));
        row.append(actions);
      }
      section.append(row);
    }
    box.append(section);
  }
}

function resetComposition(){
  state.editingPostId=null;
  state.editingMedia=[];
  state.editingFields=null;
  $('postForm').reset();
  $('composeAttributeRows').replaceChildren();
  $('composeSpace').readOnly=false;
  $('composeSpace').value=state.space;
  $('composePrimaryIndex').value='0';
  $('composePrimaryIndex').dataset.userSelected='false';
  $('composeError').hidden=true;
  $('composePreviewError').hidden=true;
  $('submitPost').textContent='Preview post';
  updateComposeType();
}
function openCorrection(item){
  const root=item.event,body=item.displayBody||root.payload.body;
  if(root.payload.author!==state.identity.author)
    return toast('Only this signing key can publish an author correction.');
  resetComposition();
  state.editingPostId=root.id;
  state.editingMedia=[...(body.media||[])];
  state.editingFields=structuredClone(body.fields||{});
  $('composeSpace').value=root.payload.space;
  $('composeSpace').readOnly=true;
  $('composeTitle').value=body.title;
  $('composeText').value=body.text;
  $('composePresentation').value=body.fields?.presentation||'text';
  if(!$('composePresentation').value)$('composePresentation').value='text';
  $('composeTags').value=(body.fields?.tags||[]).join(', ');
  $('composePrice').value=body.fields?.price||'';
  $('composeStart').value=String(body.fields?.schedule?.start||'').slice(0,16);
  $('composeEnd').value=String(body.fields?.schedule?.end||'').slice(0,16);
  $('composeLocation').value=body.fields?.schedule?.location||'';
  $('composePollQuestion').value=body.fields?.poll?.question||'';
  $('composePollOptions').value=(body.fields?.poll?.options||[]).join('\n');
  $('composePositions').value=(body.fields?.positions||[]).join('\n');
  $('composePrimaryIndex').value=String(body.fields?.primaryMediaIndex||
    choosePrimaryMediaIndex((body.fields?.mediaTypes||body.media?.map(()=> 'image/jpeg'))||[]));
  $('composePrimaryIndex').dataset.userSelected='true';
  $('submitPost').textContent='Preview signed correction';
  updateComposeType();
  $('postDialog').showModal();
}
async function changeWithdrawal(item){
  const root=item.event,lifecycle=item.lifecycle;
  if(root.payload.author!==state.identity.author)
    return toast('Only the publishing key can request withdrawal or restoration.');
  const action=lifecycle.withdrawn?'restore':'withdraw';
  const question=action==='withdraw'?
    'Sign a public withdrawal request? Your post will move to YOUR view’s Trash. '+
    'Independent replicas may retain and display its original contents.':
    'Sign a new public request to restore this post to your ordinary feed? '+
    'The earlier withdrawal remains independently signed and visible in its history.';
  if(!window.confirm(question))return;
  const reason=window.prompt('Optional public reason (up to 500 characters)', '')||'';
  if(reason.length>500)return toast('Reason too long (500 characters maximum)');
  try{
    await publish('retraction',{target:root.id,action,reason},{space:root.payload.space});
    state.selected=null;
    // Use the same sort transition as the normal toolbar so both the
    // selected feed and its highlighted controls stay consistent.
    chooseSort(action==='withdraw'&&state.respectWithdrawals?'trash':'new');
    const card=[...document.querySelectorAll('.post')].find(x=>x.dataset.id===root.id);
    if(card){expand(root.id,{focus:false});alignGridRow(card);}
    toast(action==='withdraw'?
      'Signed withdrawal requested. The original record is NOT deleted and may remain on independent peers.':
      'Signed restore requested. The original withdrawal remains permanently auditable.');
  }catch(error){toast('Could not publish signed request: '+error.message);}
}
let composerPreviewObjectURLs=[];
let activeMediaXHR=null;
let signingPublication=false;
function setUploadStatus(text,percent=0){
  const indicator=$('composeUploadIndicator');
  indicator.hidden=false;
  $('composeUploadStatus').textContent=text;
  $('composeUploadProgress').value=Math.max(0,Math.min(100,percent));
  signingPublication=/signing|distributing/i.test(text);
  $('editPostPreview').disabled=signingPublication;
  $('closeComposePreview').disabled=signingPublication;
  if(!signingPublication)
    $('editPostPreview').textContent=activeMediaXHR?
      '× Cancel transfer / edit post':'← Edit post';
}
function resetUploadStatus(){
  $('composeUploadIndicator').hidden=true;
  $('composeUploadStatus').textContent='';
  $('composeUploadProgress').value=0;
  $('editPostPreview').textContent='← Edit post';
  $('editPostPreview').disabled=false;
  $('closeComposePreview').disabled=false;
  signingPublication=false;
}
function clearComposerPreview(){
  // Aborting a transfer cannot reclaim blocks already accepted by a willing
  // IPFS operator; the UI warns about that before publishing.
  if(activeMediaXHR){activeMediaXHR.abort();activeMediaXHR=null;}
  resetUploadStatus();
  for(const url of composerPreviewObjectURLs)URL.revokeObjectURL(url);
  composerPreviewObjectURLs=[];
  $('composePreviewContent').replaceChildren();
  $('composePermanentAck').checked=false;
  $('confirmPublishPost').disabled=true;
}
function checkComposeInputs(){
  const space=$('composeSpace').value.trim();
  if(!safeSpace(space))throw Error('Invalid namespace');
  const title=$('composeTitle').value.trim(),text=$('composeText').value.trim();
  const files=[...$('composeFiles').files];
  if(!title&&!text&&!files.length&&!state.editingMedia.length)throw Error('Provide a headline, text or image');
  validateLocalUploads(files,{existingCount:state.editingMedia.length});
  const options=$('composePollOptions').value.split(/\n/).map(x=>x.trim()).filter(Boolean);
  if($('composePollQuestion').value.trim()&&options.length<2)
    throw Error('Polls need at least two options');
  customComposeFields();
  return {space,title,text,files,options};
}
function openComposePreview(event){
  event.preventDefault();
  const error=$('composeError');
  try{
    const input=checkComposeInputs();
    error.hidden=true;
    clearComposerPreview();
    const region=$('composePreviewContent');
    if(state.editingPostId){
      region.append(element('div','preview-revision-warning',
        'SIGNED CORRECTION · This will publish a new immutable event referring to the original, not edit or delete any existing record.'));
    }
    const heading=element('h2','',input.title||'Untitled post');
    const detail=element('div','preview-post-meta',
      '/'+input.space+' · '+$('composePresentation').selectedOptions[0].textContent);
    region.append(detail,heading);
    if(input.text)region.append(element('p','preview-post-text',input.text));
    const tags=$('composeTags').value.trim();
    if(tags)region.append(element('div','preview-post-tags',tags.split(',').filter(Boolean)
      .map(x=>'#'+x.trim()).join('  ')));
    const files=input.files;
    if(files.length){
      const gallery=element('div','compose-preview-gallery');
      gallery.append(element('strong','','Choose the main thumbnail · Other files appear in the attachment gallery'));
      const selected=Number($('composePrimaryIndex').value);
      for(const [index,file] of files.entries()){
        const card=element('label','compose-preview-media');
        const radio=document.createElement('input');
        radio.type='radio';radio.name='composePrimaryMedia';
        radio.value=String(index);
        radio.checked=index===selected;
        radio.onchange=()=>{
          $('composePrimaryIndex').value=radio.value;
          $('composePrimaryIndex').dataset.userSelected='true';
        };
        const url=URL.createObjectURL(file);composerPreviewObjectURLs.push(url);
        let visual;
        if(file.type.startsWith('image/')){
          visual=document.createElement('img');
          visual.src=url;visual.alt='Local image '+(index+1);
        }else if(file.type.startsWith('video/')){
          visual=document.createElement('video');
          visual.src=url;visual.preload='metadata';visual.muted=true;visual.playsInline=true;
          visual.setAttribute('aria-label','Local video preview '+(index+1));
        }else{
          visual=element('span','compose-preview-audio','♪ AUDIO');
          const preview=document.createElement('audio');
          preview.src=url;preview.preload='none';preview.controls=true;
          card.append(preview);
        }
        card.append(radio,visual,element('span','',
          file.name+' · '+categoryForType(file.type)));
        gallery.append(card);
      }
      region.append(gallery);
    }
    if(state.editingMedia.length&&!files.length){
      region.append(element('p','preview-post-meta',
        'Retaining '+state.editingMedia.length+' previously signed attachment(s). '+
        'Selecting new files replaces the attachment set in this correction; previous bytes may still exist on independent peers.'));
      const oldTypes=state.editingFields?.mediaTypes||
        state.editingMedia.map(()=> 'image/jpeg');
      const list=element('div','compose-preview-retained');
      for(const [index,cid] of state.editingMedia.entries()){
        const radio=document.createElement('input');
        radio.type='radio';radio.name='composePrimaryMedia';radio.value=String(index);
        radio.checked=index===Number($('composePrimaryIndex').value);
        radio.onchange=()=>{
          $('composePrimaryIndex').value=radio.value;
          $('composePrimaryIndex').dataset.userSelected='true';
        };
        const row=element('label','',
          categoryForType(oldTypes[index])+' · attachment '+(index+1)+' · '+cid.slice(7,22)+'…');
        row.prepend(radio);list.append(row);
      }
      region.append(list);
    }
    if($('composePollQuestion').value.trim())
      region.append(element('p','preview-post-meta',
        'Poll · '+$('composePollQuestion').value.trim()+
        ' · '+input.options.length+' options'));
    const positions=$('composePositions').value.trim();
    if(positions)region.append(element('p','preview-post-meta',
      'Open positions · '+positions.replace(/\n/g,', ')));
    $('composePreviewError').hidden=true;
    $('composePreviewDialog').showModal();
  }catch(err){error.hidden=false;error.textContent=err.message;toast(err.message);}
}
function updateComposeType(){
  $('composePriceWrap').hidden=$('composePresentation').value!=='offer';
}
function addComposeAttributeRow(){
  const target=$('composeAttributeRows');
  if(target.children.length>=12)return toast('Maximum 12 additional searchable fields');
  const row=element('div','compose-attribute-row');
  const name=document.createElement('input');
  name.placeholder='Attribute name (e.g. license)';
  name.maxLength=64;name.setAttribute('aria-label','Attribute name');
  name.className='attribute-key';
  name.pattern='[A-Za-z][A-Za-z0-9_-]{0,63}';
  const value=document.createElement('input');
  value.placeholder='Value (e.g. CC0)';
  value.maxLength=300;value.setAttribute('aria-label','Attribute value');
  value.className='attribute-value';
  row.append(name,value,button('×',()=>row.remove(),'remove-attribute'));
  target.append(row);
  name.focus();
}
function customComposeFields(){
  const fields={};
  const reserved=new Set(['tags','presentation','price','poll','schedule','positions','media','mediaTypes','demo','demoVersion','demoVideo','revises','primaryMediaIndex']);
  for(const row of $('composeAttributeRows').children){
    const key=row.querySelector('.attribute-key').value.trim().toLowerCase();
    const value=row.querySelector('.attribute-value').value.trim();
    if(!key&&!value)continue;
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(key))throw Error('Custom attribute name must start with a letter (letters, digits, _ or -).');
    if(reserved.has(key))throw Error('That attribute name is already used by a structured field: '+key);
    if(Object.hasOwn(fields,key))throw Error('Duplicate attribute: '+key);
    if(!value)throw Error('Enter a value for attribute '+key);
    fields[key]=value;
  }
  return fields;
}
function bind(){
  for(const btn of document.querySelectorAll('[data-sort]'))
    btn.onclick=()=>chooseSort(btn.dataset.sort);
  for(const btn of document.querySelectorAll('[data-search-sort]'))
    btn.onclick=()=>chooseSort(btn.dataset.searchSort);
  $('searchPosts').onfocus=()=>showSearch(true);
  $('showSearchOptions').onclick=()=>showSearch($('searchPanel').hidden);
  $('closeSearch').onclick=()=>showSearch(false);
  $('searchPosts').oninput=e=>{state.search=e.target.value;render();};
  for(const id of ['searchAttribute','searchMinScore','searchIncludeTags','searchExcludeTags','searchCustomField']){
    $(id).addEventListener('input',()=>{readSearchFilters();render();});
    $(id).addEventListener('change',()=>{readSearchFilters();render();});
  }
  for(const checkbox of document.querySelectorAll('[data-exclude-kind]'))
    checkbox.onchange=()=>{readSearchFilters();render();};
  $('resetSearch').onclick=()=>{
    state.search='';$('searchPosts').value='';
    for(const id of ['searchIncludeTags','searchExcludeTags','searchCustomField'])$(id).value='';
    $('searchAttribute').value='all';$('searchMinScore').value='0';
    for(const c of document.querySelectorAll('[data-exclude-kind]'))c.checked=false;
    readSearchFilters();chooseSort('new');
  };
  document.addEventListener('pointerdown',e=>{
    if(!$('searchPanel').hidden&&!e.target.closest('.search-wrap'))showSearch(false);
  });
  $('toggleRecommendedSpaces').onclick=async()=>{
    state.showGroupSpaces=!state.showGroupSpaces;
    await store();renderRecommendedSpaces();
  };
  $('allSpaces').onclick=()=>{$('spaceExplorer').hidden=!$('spaceExplorer').hidden;};
  $('closeSpaces').onclick=()=>{$('spaceExplorer').hidden=true;};
  $('openDemoSpace').onclick=()=>selectSpace('demo');
  $('loadTestPeer').onclick=async()=>{
    if(!$('peerURLs').value.trim())await loadSuggestions({silent:true});
    await connectPeers();
  };
  $('clansButton').onclick=()=>{renderGroupList();$('clansDialog').showModal();};
  $('verifyGroupButton').onclick=async()=>{
    const output=$('groupProofStatus'),file=$('verifyGroupFile').files?.[0];
    if(!file){output.textContent='Choose a signed proof JSON file first.';return;}
    output.textContent='Verifying independently signed records…';
    try{
      if(file.size>2*1024*1024)throw Error('Proof file exceeds 2 MiB verification limit');
      const bundle=JSON.parse(await file.text());
      const verified=await verifyGroupProof(bundle);
      if(!verified.valid)throw Error(verified.reason);
      output.textContent='VALID SIGNATURE CHAIN · '+verified.information.name+
        ' · '+verified.votingMembers.length+' eligible members · '+
        verified.ratifications.length+' ratified amendments · '+
        verified.head.slice(0,25)+'… · Historical branch inclusion only; competing heads may exist.';
    }catch(error){output.textContent='Verification failed: '+error.message;}
  };

  $('closeClans').onclick=()=>$('clansDialog').close();
  $('createGroupForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const governance=$('groupGovernance').value;
      const name=$('groupName').value.trim();
      const q=Number($('groupQuorum').value);
      const decisionPolicy=$('groupDecisionPolicy').value;
      const charter=await publish('group',{
        name,description:$('groupDescription').value.trim(),governance,
        ...(decisionPolicy==='timed-v1'?{decisionPolicy:{mode:'timed-v1'}}:{}),
        quorum:{numerator:q,denominator:100},
        recommendedSpaces:parseCSV($('groupRecommendedSpaces').value)
      },{space:'groups'});
      if(!state.groupSubscriptions.includes(charter.id))state.groupSubscriptions.push(charter.id);
      await store();await refreshGroups();renderGroupList();
      $('createGroupForm').reset();$('createGroupDetails').open=false;
      toast('Signed group charter published. Members vote on admissions. Names do not reserve spaces.');
    }catch(error){toast('Could not create group: '+error.message);}
  };
  $('identityButton').onclick=openIdentitySettings;
  $('myProfileButton').onclick=()=>{
    $('identityDialog').close();showProfile(state.identity.author);
  };
  $('backToBoardButton').onclick=()=>{
    $('identityDialog').close();selectSpace(state.space);
  };
  $('publishProfile').onclick=async()=>{
    const control=$('publishProfile');control.disabled=true;
    try{
      const name=$('profileName').value.trim(),description=$('profileDescription').value.trim();
      const website=$('profileWebsite').value.trim();
      if(website){
        const url=new URL(website);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)
          throw Error('Profile website must be an HTTP(S) URL without credentials');
      }
      await publish('profile',{name,description,website},{space:'profiles'});
      render();
      identityMessage('Signed profile metadata published to your selected peers.');
    }catch(error){identityMessage('Could not publish profile: '+error.message);}
    finally{control.disabled=false;}
  };
  $('closeIdentity').onclick=()=>{
    $('identityPassword').value='';
    $('identityDialog').close();
  };
  $('copyIdentity').onclick=()=>{
    navigator.clipboard?.writeText(state.identity.author)
      .then(()=>identityMessage('Public signing identity copied.'))
      .catch(()=>identityMessage('Clipboard unavailable. Select and copy the displayed public key.'));
  };
  $('saveIdentityBackup').onclick=async()=>{
    const control=$('saveIdentityBackup');
    control.disabled=true;
    try{
      const backup=await exportIdentityBackup(state.identity,$('identityPassword').value);
      const blob=new Blob([JSON.stringify(backup,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      try{
        const link=document.createElement('a');
        link.href=url;link.download='web9000-identity-'+state.identity.author.slice(-8)+'.encrypted.json';
        document.body.append(link);link.click();link.remove();
      }finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
      identityMessage('Encrypted backup generated. Keep its password securely and separately.');
    }catch(error){identityMessage('Backup failed: '+error.message);}
    finally{control.disabled=false;$('identityPassword').value='';}
  };
  $('restoreIdentityBackup').onclick=()=>{
    if($('identityPassword').value.length<12)
      return identityMessage('Enter the backup password (at least 12 characters) before restoring.');
    $('identityBackupFile').click();
  };
  $('identityBackupFile').onchange=async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>15000)throw Error('Backup exceeds the 15 KB limit');
      const backup=JSON.parse(await file.text());
      const restored=await importIdentityBackup(backup,$('identityPassword').value);
      if(restored.author!==state.identity.author&&!window.confirm(
        'Replace this website’s current signing key with the restored key? '+
        'Your previous posts will still belong to the old identity. '+
        'Keep an encrypted backup of your current key before switching.'
      ))return;
      state.identity=restored;
      await setItem(state.db,'identity',restored);
      $('identityPublicKey').textContent=restored.author;
      render();
      identityMessage('Signing identity restored on this website. Other records were not deleted.');
    }catch(error){identityMessage('Restore rejected: '+error.message);}
    finally{event.target.value='';$('identityPassword').value='';}
  };
  $('mockKarmaButton').onclick=()=>openMockKarma();
  $('closeMockDialog').onclick=()=>$('mockDialog').close();
  $('mockEnabled').onchange=async e=>{
    state.mockMode=e.target.checked;await store();render();
    toast(state.mockMode?
      'TEST MODE enabled: fabricated scores only affect this browser display.':
      'Mock karma disabled; ordinary trust rules restored.');
  };
  $('saveMockKarma').onclick=async()=>{
    try{
      if($('mockScore').value.trim()==='')throw Error('Enter a score');
      state.mockKarma.assign($('mockIdentity').value.trim(),Number($('mockScore').value));
      await store();renderMockRoster();render();
      toast('Simulated local key score saved. No coins checked or locked.');
    }catch(error){toast(error.message);}
  };
  $('showUnverified').onchange=async e=>{state.showUnverified=e.target.checked;await store();render();};
  $('respectWithdrawals').onchange=async e=>{
    state.respectWithdrawals=e.target.checked;await store();render();
  };
  $('viewStyle').onchange=async e=>{state.view=e.target.value;await store();render();};
  $('goSpace').onclick=async()=>{
    const name=$('spaceName').value.trim();if(!safeSpace(name))return toast('Invalid namespace');
    selectSpace(name);
  };
  $('spaceName').onkeydown=e=>{if(e.key==='Enter')$('goSpace').click();};
  $('postNew').onclick=()=>{resetComposition();modal('postDialog');};
  $('composePresentation').onchange=updateComposeType;
  $('composeFiles').onchange=()=>{
    const types=[...$('composeFiles').files].map(file=>file.type);
    if(!$('composePrimaryIndex').dataset.userSelected)
      $('composePrimaryIndex').value=String(Math.max(0,choosePrimaryMediaIndex(types)));
  };
  $('addComposeAttribute').onclick=addComposeAttributeRow;
  $('closeComposer').onclick=()=>close('postDialog');$('cancelPost').onclick=()=>close('postDialog');
  $('debugConsoleButton').onclick=()=>openDebugConsole('events');
  $('closeDebug').onclick=()=>close('debugDialog');
  $('debugSource').onchange=()=>{
    $('debugKind').value='';renderDebugConsole();
  };
  for(const id of ['debugKind','debugSpace','debugAuthor','debugSearch','debugLimit']){
    $(id).addEventListener('input',renderDebugConsole);
    $(id).addEventListener('change',renderDebugConsole);
  }
  $('debugRefresh').onclick=renderDebugConsole;
  $('debugClear').onclick=()=>{
    state.debugTrace.clear();renderDebugConsole();
    toast('This browser session’s network trace cleared. Signed records unchanged.');
  };
  $('debugCopy').onclick=async()=>{
    const raw=$('debugRaw').textContent;
    if(!state.debugItems.length)return toast('Select a record first');
    try{await navigator.clipboard.writeText(raw);toast('Selected raw JSON copied.');}
    catch(error){toast('Clipboard unavailable: '+error.message);}
  };
  $('debugExport').onclick=downloadDebugJSON;
  $('joinNetwork').onclick=()=>{renderMediaProviderSuggestions();modal('networkDialog');};$('closeNetwork').onclick=()=>close('networkDialog');
  $('suggestPeers').onclick=loadSuggestions;
  $('connectPeers').onclick=connectPeers;
  $('disconnectPeers').onclick=async()=>{
    state.mesh.disconnect();state.peers=[];state.autoDemoPeerDisabled=true;await store();$('peerURLs').value='';render();toast('Disconnected; local posts and backups remain.');
  };
  $('postForm').onsubmit=openComposePreview;
  $('composePermanentAck').onchange=()=>{
    $('confirmPublishPost').disabled=!$('composePermanentAck').checked;
  };
  $('editPostPreview').onclick=()=>{
    $('composePreviewDialog').close();
    clearComposerPreview();
  };
  $('closeComposePreview').onclick=$('editPostPreview').onclick;
  $('composePreviewDialog').addEventListener('cancel',event=>{
    if(signingPublication)event.preventDefault();
  });
  $('composePreviewDialog').addEventListener('close',()=>{
    // Esc closes a <dialog> natively; abort its media transfer too.
    if(composerPreviewObjectURLs.length||activeMediaXHR)clearComposerPreview();
  });
  $('confirmPublishPost').onclick=async()=>{
    if(!$('composePermanentAck').checked)return;
    $('confirmPublishPost').disabled=true;
    await compose({preventDefault(){}});
    if($('composeError').hidden){
      $('composePreviewDialog').close();
      clearComposerPreview();
    }else if($('composePreviewDialog').open){
      $('composePreviewError').hidden=false;
      $('composePreviewError').textContent=$('composeError').textContent;
      $('confirmPublishPost').disabled=false;
    }
  };
  document.addEventListener('focusout',event=>{
    if(state.deferredDuringComment && event.target.closest?.('.comment-form')){
      state.deferredDuringComment=false;
      queueMicrotask(()=>{if(!updateOpenDiscussion())render();});
    }
  });
  document.addEventListener('keydown',onKey);
  window.addEventListener('resize',()=>state.selected&&scheduleRender());
}
function renderMediaProviderSuggestions(){
  const target=$('mediaProviderSuggestions');
  if(!target)return;
  target.replaceChildren();
  const entries=claimsFromVerifiedEvents(allEvents()).slice(0,20);
  if(!entries.length){
    target.append(element('small','','No signed provider claims in your currently synchronized records.'));
    return;
  }
  const unique=[...new Map(entries.map(e=>[e.gateway,e])).values()];
  for(const entry of unique){
    const row=element('div','fine');
    const trusted=entry.author===state.identity?.author||state.trust.includes(entry.author);
    row.append(element('span','',(trusted?'Trusted signer · ':'Unverified signer · ')+
      entry.gateway+' · CID claim, not proof · '+new Date(entry.expiresAt).toLocaleDateString()+' '));
    row.append(button('Add to backup list',()=>{
      try{
        const text=[$('mediaMirrorURLs').value,entry.gateway].filter(Boolean).join('\n');
        $('mediaMirrorURLs').value=parseMediaGateways(text,{
          securePage:location.protocol==='https:'}).join('\n');
        toast('Backup added for review. Click Connect to approve its use.');
      }catch(error){toast(error.message);}
    }));
    target.append(row);
  }
}
async function loadSuggestions({silent=false}={}){
  try{
    const data=await(await fetch('./peers.json',{cache:'no-store'})).json();
    if(data.format!=='web9000-peer-suggestions-v1'||!Array.isArray(data.peers)||data.peers.length>8)throw Error('Invalid peer directory');
    state.suggested=data.peers;
    $('peerURLs').value=data.peers.map(x=>x.url).join('\n');
    if(data.peers[0]?.mediaUrl){
      state.mediaBase=normalizeMediaBase(data.peers[0].mediaUrl);
      $('mediaPeerUrl').value=state.mediaBase;
    }
    await store();
    if(!silent)toast('Loaded '+data.peers.length+' voluntary peer suggestion(s). Review before connecting.');
  }catch(error){toast('Cannot load suggestions: '+error.message);}
}
async function connectPeers(){
  try{
    const urls=parsePeerUrls($('peerURLs').value,location.protocol==='https:');
    if(!urls.length)throw Error('Enter one or more peer addresses');
    const mediaBase=normalizeMediaBase($('mediaPeerUrl').value);
    const mediaMirrors=parseMediaGateways($('mediaMirrorURLs').value,{
      securePage:location.protocol==='https:'});
    state.mediaBase=mediaBase;
    state.mediaMirrors=mediaMirrors.filter(url=>url!==mediaBase);
    state.peers=urls;
    state.autoDemoPeerDisabled=false;
    state.mesh.connect(urls,{spaces:['*']});
    await store();close('networkDialog');render();
    toast('Connecting to '+urls.length+' independent peer(s); unverified content remains hidden by default.');
  }catch(error){toast('Connection setup: '+error.message);}
}
function parseCSV(value){return [...new Set(value.split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(validTag))].slice(0,24);}
async function uploadMedia(files){
  if(!files.length)return [];
  if(!state.mediaBase)throw Error('No media peer configured. Connect or choose a voluntary media provider first.');
  validateLocalUploads(files);
  const uploaded=[];
  const base=state.mediaBase.replace(/\/$/,'');
  for(const [index,file] of files.entries()){
    const prefix='Uploading '+(index+1)+'/'+files.length+': '+file.name;
    setUploadStatus(prefix+' · 0%',Math.floor(index/files.length*100));
    const data=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      activeMediaXHR=xhr;
      xhr.open('POST',base+'/upload',true);
      xhr.timeout=120000;
      xhr.setRequestHeader('Content-Type',file.type);
      xhr.upload.onprogress=event=>{
        if(!event.lengthComputable)return;
        const fraction=event.total>0?event.loaded/event.total:0;
        setUploadStatus(prefix+' · '+Math.floor(100*fraction)+'%',
          Math.floor((index+fraction)/files.length*100));
      };
      xhr.onload=()=>{
        if(activeMediaXHR===xhr)activeMediaXHR=null;
        let result=null;
        try{result=JSON.parse(xhr.responseText);}catch{}
        if(xhr.status<200||xhr.status>=300){
          reject(Error('Independent media peer refused '+file.name+' ('+xhr.status+
            '): '+(result?.error||'check its upload settings and 10 MiB cap')));
        }else resolve(result);
      };
      xhr.onerror=()=>{
        if(activeMediaXHR===xhr)activeMediaXHR=null;
        reject(Error('Network error uploading '+file.name));
      };
      xhr.ontimeout=()=>{
        if(activeMediaXHR===xhr)activeMediaXHR=null;
        reject(Error('Media peer upload timed out for '+file.name));
      };
      xhr.onabort=()=>{
        if(activeMediaXHR===xhr)activeMediaXHR=null;
        reject(new DOMException('Upload cancelled','AbortError'));
      };
      xhr.send(file);
    });
    if(typeof data?.cid!=='string'||!/^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(data.cid)||
      data.type!==file.type)
      throw Error('Media peer returned invalid CID or incorrect MIME type');
    uploaded.push({cid:data.cid,type:file.type});
    setUploadStatus('Stored '+(index+1)+'/'+files.length+
      ' attachments on your independent media peer',Math.floor((index+1)/files.length*100));
  }
  setUploadStatus('All uploads stored · signing your publication…',100);
  return uploaded;
}
async function compose(event){
  event.preventDefault();
  const buttonEl=$('submitPost'),error=$('composeError');
  error.hidden=true;buttonEl.disabled=true;
  try{
    if(!$('composePermanentAck').checked)throw Error('Review the permanence notice and confirm before publishing.');
    checkComposeInputs();
    const space=$('composeSpace').value.trim(),title=$('composeTitle').value.trim(),text=$('composeText').value.trim();
    if(!safeSpace(space))throw Error('Invalid namespace');
    const root=state.editingPostId?state.replica.get(state.editingPostId):null;
    if(state.editingPostId&&(!root||root.payload.kind!=='post'||
       root.payload.author!==state.identity.author||root.payload.space!==space))
      throw Error('Correction requires an existing post by this exact signing key in the same namespace');
    const files=[...$('composeFiles').files];
    const tags=parseCSV($('composeTags').value);
    const schedule=$('composeStart').value?{start:$('composeStart').value,end:$('composeEnd').value,location:$('composeLocation').value.trim()}:null;
    const pollQuestion=$('composePollQuestion').value.trim();
    const options=$('composePollOptions').value.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,20);
    if(pollQuestion&&options.length<2)throw Error('Polls need at least two choices');
    const positions=$('composePositions').value.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,20);
    if(!title&&!text&&!files.length&&!state.editingMedia.length)
      throw Error('Provide a headline, text or image');
    const descriptors=files.length?await uploadMedia(files):
      state.editingMedia.map((cid,index)=>({
        cid,type:state.editingFields?.mediaTypes?.[index]||'image/jpeg'
      }));
    const media=descriptors.map(item=>item.cid);
    const fields={...(state.editingFields||{}),tags,presentation:$('composePresentation').value};
    if(media.length){
      fields.mediaTypes=descriptors.map(item=>item.type);
      const preference=Number($('composePrimaryIndex').value);
      fields.primaryMediaIndex=choosePrimaryMediaIndex(fields.mediaTypes,
        Number.isInteger(preference)&&preference>=0&&preference<media.length?preference:undefined);
    }else{
      delete fields.primaryMediaIndex;delete fields.mediaTypes;
    }
    Object.assign(fields,customComposeFields());
    if(root)fields.revises=root.id;
    else delete fields.revises;
    if(fields.presentation==='offer'){
      const price=$('composePrice').value.trim();
      if(price)fields.price=price;
    }
    if(schedule)fields.schedule=schedule;else delete fields.schedule;
    if(pollQuestion)fields.poll={question:pollQuestion,options};else delete fields.poll;
    if(positions.length)fields.positions=positions;else delete fields.positions;
    if($('composePreviewDialog').open)
      setUploadStatus('Signing and distributing your publication…',100);
    const message=await publish('post',{title,text,fields,media},{space});
    if(root)toast('New signed correction '+message.id.slice(0,16)+'… published; the original remains intact.');
    state.editingPostId=null;state.editingMedia=[];state.editingFields=null;
    state.space=space;$('spaceName').value=space;await store();
    $('postForm').reset();
    $('composePrimaryIndex').value='0';
    $('composeAttributeRows').replaceChildren();
    updateComposeType();
    close('postDialog');render();
  }catch(err){
    if(err?.name!=='AbortError'){
      error.textContent=err.message;error.hidden=false;
      toast('Posting failed: '+err.message);
      if(!$('composeUploadIndicator').hidden)
        setUploadStatus('Upload failed · '+err.message,$('composeUploadProgress').value);
    }
  }finally{
    buttonEl.disabled=false;
    if($('composePreviewDialog').open&&signingPublication){
      signingPublication=false;
      $('editPostPreview').disabled=false;
      $('closeComposePreview').disabled=false;
    }
  }
}
async function init(){
  state.db=await openLocal();
  state.identity=await getItem(state.db,'identity');
  if(!state.identity){
    state.identity=await generateIdentity({extractable:true});
    await setItem(state.db,'identity',state.identity);
  }
  state.saved=await getItem(state.db,'records')||[];
  for(const event of state.saved)await state.replica.ingest(event);
  state.outbox=await getItem(state.db,'outbox')||[];
  state.peers=await getItem(state.db,'peer-urls')||[];
  state.trust=await getItem(state.db,'classic-trust')||[];
  state.relations=normalizeRelations(await getItem(state.db,'classic-social-relations'),state.identity.author);
  state.ignoredLabels=(await getItem(state.db,'classic-ignored-labels')||[])
    .filter(id=>typeof id==='string'&&/^sha256:[0-9a-f]{64}$/.test(id)).slice(0,2000);
  state.showUnverified=await getItem(state.db,'classic-show-unknown')===true;
  state.respectWithdrawals=await getItem(state.db,'classic-respect-withdrawals')!==false;
  state.view=await getItem(state.db,'classic-view')||'grid';
  state.showMedia=await getItem(state.db,'classic-show-media')===true;
  state.mediaBase=await getItem(state.db,'classic-media-url')||null;
  try{
    const savedMirrors=await getItem(state.db,'classic-media-mirrors');
    state.mediaMirrors=parseMediaGateways(Array.isArray(savedMirrors)?savedMirrors.join('\n'):'',
      {securePage:location.protocol==='https:'});
  }catch{state.mediaMirrors=[];}
  state.mockKarma=new MockKarmaProvider(await getItem(state.db,'classic-mock-scores')||{});
  state.mockMode=await getItem(state.db,'classic-mock-mode')===true;
  state.followedSpaces=await getItem(state.db,'classic-followed-spaces')||['demo','commons'];
  state.groupSubscriptions=await getItem(state.db,'classic-group-subscriptions')||[];
  const groupHeads=await getItem(state.db,'classic-group-heads');
  state.groupHeads=groupHeads&&typeof groupHeads==='object'&&!Array.isArray(groupHeads)?
    Object.fromEntries(Object.entries(groupHeads).filter(([group,head])=>
      /^sha256:[0-9a-f]{64}$/.test(group)&&/^sha256:[0-9a-f]{64}$/.test(head)).slice(0,100)):{};

  state.showGroupSpaces=await getItem(state.db,'classic-show-group-spaces')!==false;
  state.autoDemoPeerDisabled=await getItem(state.db,'classic-auto-demo-peer-disabled')===true;
  try{
    const demo=await (await fetch('./demo.json',{cache:'no-store'})).json();
    if(demo.space==='demo'&&/^ed25519:[A-Za-z0-9_-]{43}$/.test(demo.author)){
      state.demoAuthor=demo.author;
      state.demoAutoConnect=demo.autoConnectSameOrigin===true;
    }
  }catch{}
  const hint=readSiteContext(location.href);
  state.space=hint.space||await getItem(state.db,'classic-space')||'demo';
  state.ownerHint=hint.preferredAuthor;
  const selectedProfile=new URLSearchParams(location.search).get('profile');
  if(selectedProfile==='me')state.profileAuthor=state.identity.author;
  else if(/^ed25519:[A-Za-z0-9_-]{43}$/.test(selectedProfile||''))state.profileAuthor=selectedProfile;
  window.addEventListener('popstate',()=>{
    const query=new URLSearchParams(location.search).get('profile');
    state.profileAuthor=query==='me'?state.identity.author:
      /^ed25519:[A-Za-z0-9_-]{43}$/.test(query||'')?query:null;
    state.selected=null;render();
  });
  // Owner-preferred views are a host suggestion, not a namespace write lock.
  // The visitor can inspect suppressed records via Audit, and uncheck the
  // owner view at any time from the compact board toolbar.
  if(hint.preferredAuthor){
    const label=element('label','','');
    const checkbox=document.createElement('input');checkbox.type='checkbox';
    checkbox.id='respectOwner';checkbox.checked=true;
    label.append(checkbox,document.createTextNode(' Respect site owner’s presentation'));
    $('peerStatus').before(label);
    checkbox.onchange=()=>{state.respectOwner=checkbox.checked;render();};
  }
  $('spaceName').value=state.space;
  $('showUnverified').checked=state.showUnverified;
  $('viewAudited').classList.toggle('active',state.sort==='trash');
  $('mockEnabled').checked=state.mockMode;
  $('viewStyle').value=state.view;
  $('respectWithdrawals').checked=state.respectWithdrawals;
  $('peerURLs').value=state.peers.join('\n');
  $('mediaPeerUrl').value=state.mediaBase||'';
  $('mediaMirrorURLs').value=state.mediaMirrors.join('\n');
  bind();
  // Pre-fill independently replaceable peer suggestions, without connecting.
  // Consent is still required to open any WebSocket or upload images.
  if(!state.peers.length&&!state.mediaBase)await loadSuggestions({silent:true});
  state.mesh=new BrowserPeerMesh({
    securePage:location.protocol==='https:',
    getPending:()=>state.outbox.map(x=>x.event),
    // Network progress updates must never destroy the grid or the focused
    // element. Previously each batch and ACK replaced every post node,
    // causing lost keyboard focus and detached click targets.
    onStatus:()=>updateNetworkStatus(),
    onPacket:tracePeer,
    onEvent:async e=>{
      const result=await ingest(e);
      if(result.accepted&&['group','proposal','vote','membership'].includes(e.payload.kind))
        void refreshGroups();
      if(result.accepted&&e.payload.kind==='media-provider'&&$('networkDialog').open)
        renderMediaProviderSuggestions();
      updateNetworkStatus();
    },
    onAck:(id,url)=>{
      void(async()=>{
        const item=state.outbox.find(x=>x.event.id===id);
        if(!item)return;
        item.ackedBy=[...new Set([...item.ackedBy,url])];
        if(state.peers.length&&state.peers.every(peer=>item.ackedBy.includes(peer)))
          state.outbox=state.outbox.filter(x=>x.event.id!==id);
        await store();updateNetworkStatus();
      })().catch(console.error);
    },
    onError:(url,message)=>{
      state.lastError=String(message);
      tracePeer({direction:'error',url,payload:String(message)});
      toast('Peer rejected/failed: '+message);
    }
  });
  render();
  await refreshGroups();
  // A self-hosted demo website may explicitly opt in to loading its
  // *own* volunteer peer on first visit. Never silently dial an unrelated
  // remote host just because somebody suggested one in peers.json.
  // Readers may disconnect once and that opt-out is remembered.
  if(state.space==='demo'&&state.demoAutoConnect&&!state.autoDemoPeerDisabled&&!state.peers.length){
    try{
      const urls=parsePeerUrls($('peerURLs').value,location.protocol==='https:');
      const ownPeer=urls.find(value=>{
        const url=new URL(value);
        return url.hostname===location.hostname&&
          (location.protocol==='https:'?url.protocol==='wss:':url.protocol==='ws:');
      });
      if(ownPeer){
        state.peers=[ownPeer];
        await store();
      }
    }catch(error){console.warn('Optional same-origin demo peer unavailable:',error.message);}
  }
  if(state.peers.length){
    try{state.mesh.connect(state.peers,{spaces:['*']});}
    catch(error){toast(error.message);}
  }
  document.documentElement.dataset.web9000ClassicReady='1';
}
init().catch(err=>{
  console.error('Classic board initialization',err);
  $('feedStatus').textContent='Initialization failed: '+err.message;
});