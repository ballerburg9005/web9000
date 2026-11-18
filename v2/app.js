import {generateIdentity,signEvent,verifyEvent,shortAuthor} from './core/events.js';
import {Replica} from './core/replica.js';
import {buildFeed,DEFAULT_POLICY} from './core/policy.js';
import {deriveGroup} from './core/governance.js';
import {exportIdentityBackup,importIdentityBackup} from './core/identity-backup.js';
import {openLocal,getItem,setItem} from './core/persist.js';
import {BrowserPeerMesh,parsePeerUrls} from './network/browser-mesh.js';
import {mirrorDecision} from './network/mirror-policy.js';
import {readSiteContext} from './network/site-context.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const spaces={commons:'Commons',art:'Creative works',organize:'Organize',exchange:'Exchange',projects:'Projects'};
const types=['All','Discussion','Art','Event','Offer','Project','Job'];
const state={replica:new Replica(),identity:null,db:null,space:'all',type:'All',layout:'grid',sort:'new',search:'',showFiltered:false,showUnknown:false,subscribed:[],policy:null,selected:null,fixtureKeys:{},localIds:[],groupIds:{},compiledGroups:{},groupViews:[],userTrusted:[],followedSpaces:Object.keys(spaces),mesh:null,peerUrls:[],replicationScopes:Object.keys(spaces),pending:[],lastConnected:0,autoMirror:false,siteContext:null,honorSiteOwner:true,groupHeadChoices:{}};
// Moderation authority derives from signed group checkpoints, not hard-coded group objects.
const previewContent=[
 {space:'art',type:'Art',title:'Some interesting visual experiments',text:'A small collection of sketches and procedural compositions. What should be explored next?',image:'../thumb/thumb11.jpg',fields:{media:'Image gallery',count:4},author:'maker'},
 {space:'organize',type:'Event',title:'A neighborhood tool-sharing meetup',text:'Bring something you can repair or lend. A loosely organized public gathering with no central organizer.',fields:{start:'2027-04-14',location:'Local community center'},author:'organizer'},
 {space:'exchange',type:'Offer',title:'Vintage synthesizer modules for trade',text:'Looking to exchange older analog modules for DIY components. Direct peer-to-peer negotiation.',image:'../thumb/thumb15.jpg',fields:{price:{amount:90,currency:'USD'},condition:'Used'},author:'maker'},
 {space:'commons',type:'Discussion',title:'How should communities delegate moderation?',text:'Should a federation inherit another guild’s labels by default, or require approval for every category?',fields:{topic:'Governance'},author:'thinker'},
 {space:'projects',type:'Project',title:'Open hardware: solar-powered mesh node',text:'Seeking people interested in off-grid data replication and tiny standalone client devices.',image:'../thumb/thumb25.jpg',fields:{status:'Prototyping',positions:3},author:'organizer'},
 {space:'art',type:'Art',title:'A fragment of an experimental photo archive',text:'A freely indexed collection of images with independent tags and copies across different peers.',image:'../thumb/thumb22.jpg',fields:{media:'Photos'},author:'thinker'},
 {space:'organize',type:'Job',title:'Volunteer translators for open documentation',text:'Help translate network resilience notes. Contribute whenever you have time.',fields:{role:'Translation',remote:true},author:'maker'},
 {space:'exchange',type:'Offer',title:'Suspicious bulk listing (moderation demo)',text:'This fixture illustrates how a guild may classify an offer without deleting the signed record.',fields:{price:{amount:1,currency:'USD'},category:'Demo'},author:'outsider'},
 {space:'commons',type:'Discussion',title:'Every namespace belongs to nobody',text:'A claimed space can opt into owner-preferred visibility while anyone can still publish to it.',fields:{topic:'Protocol design'},author:'organizer'},
 {space:'projects',type:'Project',title:'Collaborative collection of public-domain audio',text:'A community catalog of independently hosted audio and searchable contributor metadata.',image:'../thumb/thumb31.jpg',fields:{license:'Public domain'},author:'maker'}
];
const newToast = msg => {
  const el=$('#toast');el.textContent=msg;el.classList.add('visible');
  clearTimeout(newToast.timer);newToast.timer=setTimeout(()=>el.classList.remove('visible'),3600);
};
const nickname=author=>Object.entries(state.fixtureKeys).find(([,v])=>v.author===author)?.[0] || (author===state.identity?.author?'You':shortAuthor(author));
function policy() {
  return {...DEFAULT_POLICY,followedSpaces:state.followedSpaces,showUnknown:state.showUnknown,
    trustedAuthors:[...new Set([state.identity.author,...Object.values(state.fixtureKeys).filter(x=>x.name!=='outsider').map(x=>x.author),...(state.userTrusted || []),...(state.honorSiteOwner&&state.siteContext?.preferredAuthor?[state.siteContext.preferredAuthor]:[])])],
    groups:state.compiledGroups,subscriptions:state.subscribed,
    reviewerWeights:{[state.identity.author]:1},
    ownerPreference:state.honorSiteOwner&&state.siteContext?.space&&state.siteContext?.preferredAuthor?
      {[state.siteContext.space]:state.siteContext.preferredAuthor}:{}
  };
}
async function saveLocal() {
  if(state.db) await setItem(state.db,'records',state.localIds.map(id=>state.replica.get(id)).filter(Boolean));
}
async function addLocal(event){
  const answer=await state.replica.ingest(event);
  if(answer.accepted&&!answer.duplicate){state.localIds.push(event.id);await saveLocal();}
  return answer;
}
// Imported/mirrored records are local data, not automatic republications.
// Only events authored through this UI join the durable outgoing queue.
async function publishLocal(event){
  const result=await addLocal(event);
  if(!result.accepted)throw Error(result.reason||'local replica refused event');
  if(!state.pending.some(x=>x.event.id===event.id)){
    state.pending.push({event,ackedBy:[]});await persistNetwork();
  }
  state.mesh?.publish(event);
  updateNetworkStatus();
}
async function persistNetwork(){
  if(!state.db)return;
  await Promise.all([
    setItem(state.db,'outbox',state.pending),
    setItem(state.db,'peer-urls',state.peerUrls),
    setItem(state.db,'replicate-scopes',state.replicationScopes),
    setItem(state.db,'followed-spaces',state.followedSpaces),
    setItem(state.db,'auto-mirror',state.autoMirror),
    setItem(state.db,'group-heads',state.groupHeadChoices),
    setItem(state.db,'group-subscriptions',state.subscribed)
  ]);
}
function ensureSpace(name){
  if(typeof name!=='string'||!name||name.length>180)return;
  if(!Object.prototype.hasOwnProperty.call(spaces,name)) {
    spaces[name]=name;
    const button=textEl('button','side-link','◈ '+name);
    button.dataset.space=name;
    button.onclick=()=>{followSpace(name);state.space=name;render();};
    $('.side-section .side-link[data-space="all"]').parentElement.append(button);
  }
}
function followSpace(name){
  if(!name||name.length>180||/[\x00-\x1f]/.test(name))throw Error('Invalid namespace');
  ensureSpace(name);
  if(!state.followedSpaces.includes(name)) {
    state.followedSpaces.push(name);void persistNetwork();
  }
}
function updateNetworkStatus(){
  const connected=state.mesh?.connected||0;
  $('#statPeers').textContent=connected;
  $('#networkSummary').textContent=connected
    ? connected+' connected peer'+(connected===1?'':'s')+' · '+state.pending.length+' outgoing queued'
    : 'Local mode · '+state.peerUrls.length+' peer address'+(state.peerUrls.length===1?'':'es')+' configured · '+state.pending.length+' queued';
  $('#networkStatusBar').textContent=connected?'● '+connected+' PEER'+(connected===1?'':'S')+' CONNECTED':'● LOCAL / NO PEERS';
  $('#networkStatusBar').classList.toggle('online',connected>0);
  const notice=$('#notice .notice-message');
  if(notice)notice.textContent=connected
    ? 'Connected to independent WebSocket-accessible OrbitDB peers. Records are signed and verified locally; peers cannot edit them or authorize namespaces. Transport peers can refuse to store or forward records.'
    : 'No browser peer connected. Signed posts stay in local storage and your outgoing queue. Add independently operated WebSocket peer addresses to exchange records without an administrator.';
}
let groupRefreshTimer=null;
async function setupNetwork(){
  if(state.db){
    state.pending=await getItem(state.db,'outbox')||[];
    state.peerUrls=await getItem(state.db,'peer-urls')||[];
    state.replicationScopes=await getItem(state.db,'replicate-scopes')||Object.keys(spaces);
    state.followedSpaces=await getItem(state.db,'followed-spaces')||Object.keys(spaces);
    state.autoMirror=await getItem(state.db,'auto-mirror')===true;
    const savedScopes=await getItem(state.db,'replicate-scopes');
    if(!savedScopes && state.siteContext?.space)
      state.replicationScopes=[...new Set([...state.replicationScopes,state.siteContext.space])];
  }
  if(!state.db && state.siteContext?.space)
    state.replicationScopes=[...new Set([...state.replicationScopes,state.siteContext.space])];
  $('#autoMirror').checked=state.autoMirror;
  for(const name of state.followedSpaces)ensureSpace(name);
  $('#networkEndpoints').value=state.peerUrls.join('\n');
  $('#suggestedPeers').onclick=async()=>{
    try{
      const response=await fetch('./peers.json',{cache:'no-store'});
      if(!response.ok)throw Error('No published peer suggestions on this host');
      const data=await response.json();
      if(data.format!=='web9000-peer-suggestions-v1'||!Array.isArray(data.peers)||data.peers.length>8)
        throw Error('Invalid suggested peer list');
      const addresses=data.peers.map(p=>p.url);
      const urls=parsePeerUrls(addresses.join('\n'),location.protocol==='https:');
      $('#networkEndpoints').value=urls.join('\n');
      $('#networkLastError').textContent='Suggested peers are independent operators, not trusted authorities. Review before connecting.';
    }catch(error){newToast('No peer suggestions: '+error.message);}
  };
  $('#networkScopes').value=state.replicationScopes.join(', ');
  state.mesh=new BrowserPeerMesh({
    securePage:location.protocol==='https:',
    onEvent:async(event,sourceUrl)=>{
      const result=await addLocal(event);
      if(!result.accepted||result.duplicate)return;
      const decision=mirrorDecision(event,state.replica.list(),policy(),state.identity.author,
        {enabled:state.autoMirror,spaces:state.replicationScopes});
      if(decision.mirror)state.mesh?.publish(event,state.peerUrls.filter(url=>url!==sourceUrl));
      if(['group','proposal','vote'].includes(event.payload.kind)){
        clearTimeout(groupRefreshTimer);
        groupRefreshTimer=setTimeout(async()=>{await refreshGroups();render();},120);
      } else render();
    },
    onAck:(id,url)=>{void (async()=>{
      const item=state.pending.find(x=>x.event.id===id);
      if(!item)return;
      item.ackedBy=[...new Set([...item.ackedBy,url])];
      if(state.peerUrls.length && state.peerUrls.every(peer=>item.ackedBy.includes(peer)))
        state.pending=state.pending.filter(x=>x.event.id!==id);
      await persistNetwork();updateNetworkStatus();
    })().catch(error=>console.error('Outbox persistence',error));},
    onStatus:({connected})=>{
      if(connected>state.lastConnected)
        for(const item of state.pending)if(!item.ackedBy.every(x=>state.peerUrls.includes(x)) || item.ackedBy.length<state.peerUrls.length)
          state.mesh?.publish(item.event);
      state.lastConnected=connected;updateNetworkStatus();
    },
    onError:(_url,error)=>{
      $('#networkLastError').textContent='Peer: '+String(error).slice(0,180);
    }
  });
  updateNetworkStatus();
  if(state.peerUrls.length){
    try{state.mesh.connect(state.peerUrls,{spaces:state.replicationScopes});}
    catch(error){$('#networkLastError').textContent=error.message;}
  }
}
async function init() {
  try {
    state.db=await openLocal();
    state.identity=await getItem(state.db,'identity');
    if(!state.identity){state.identity=await generateIdentity({extractable:true});await setItem(state.db,'identity',state.identity);}
  } catch (e) { console.warn('IndexedDB unavailable',e);state.identity=await generateIdentity({extractable:true});newToast('Browser storage unavailable: session is temporary'); }
  state.siteContext=readSiteContext(location.href);
  refreshIdentityUI();
  for(const name of ['maker','organizer','thinker','outsider','guildReviewer','safetyReviewer']){
    state.fixtureKeys[name]=await generateIdentity();
    state.fixtureKeys[name].name=name;
  }
  // Signed demonstration groups with member-ratified reviewer appointments.
  for(const [key,name] of [['guild','Open Commons Guild'],['safety','Safety Cooperative']]){
    const issuer=state.fixtureKeys[key==='guild'?'guildReviewer':'safetyReviewer'];
    const charter=await signEvent(issuer,{kind:'group',body:{name,quorum:{numerator:2,denominator:3}}});
    const proposal=await signEvent(issuer,{kind:'proposal',body:{
      group:charter.id,parent:charter.id,change:{type:'appoint-reviewer',author:issuer.author,weight:1}
    }});
    const ballot=await signEvent(issuer,{kind:'vote',body:{proposal:proposal.id,choice:'approve'}});
    state.groupIds[key]=charter.id;
    for(const event of [charter,proposal,ballot])await state.replica.ingest(event);
  }
  let k=0;
  for(const item of previewContent) {
    const identity=state.fixtureKeys[item.author],fields={...item.fields,uiType:item.type};
    const event=await signEvent(identity,{space:item.space,body:{title:item.title,text:item.text,fields},time:Date.now()-(++k*84000000)});
    await state.replica.ingest(event);
    if(item.author==='outsider'){
      const label=await signEvent(state.fixtureKeys.guildReviewer,{kind:'label',space:item.space,body:{target:event.id,tag:'spam',reason:'Guild demonstration label; no universal verdict'}});
      await state.replica.ingest(label);
    }
  }
  const local=state.db?await getItem(state.db,'records') || []:[];
  for(const event of local) {
    if((await state.replica.ingest(event)).accepted) state.localIds.push(event.id);
  }
  if(state.db){
    state.groupHeadChoices=await getItem(state.db,'group-heads')||{};
    state.subscribed=await getItem(state.db,'group-subscriptions')||[];
  }
  await refreshGroups();
  bindEvents();await setupNetwork();applySiteContext();render();
  document.documentElement.dataset.web9000Ready='1';
}
async function refreshGroups() {
  const events=state.replica.list(), compiled={},views=[];
  for(const record of events.filter(e=>e.payload.kind==='group')){
    const view=await deriveGroup(events,record.id,{selectedHead:state.groupHeadChoices[record.id]||null});
    if(!view.found)continue;
    compiled[record.id]={reviewers:view.state.reviewers,inherits:view.state.delegates};
    views.push({id:record.id,name:view.state.name,heads:view.heads,selectedHead:view.selectedHead,ambiguous:view.ambiguous});
  }
  state.compiledGroups=compiled;state.groupViews=views;
  // Preserve subscriptions even when a group is temporarily undiscoverable.
  // Reappearance of its signed charter must not require central approval.
  renderGroupChoices();
}
function renderGroupChoices() {
  const target=$('#customGroups');
  target.replaceChildren();
  for(const info of state.groupViews.filter(v=>!Object.values(state.groupIds).includes(v.id))){
    const label=textEl('label','federation',''),input=document.createElement('input');
    input.type='checkbox';input.checked=state.subscribed.includes(info.id);
    input.onchange=()=>{state.subscribed=input.checked?[...new Set([...state.subscribed,info.id])]:state.subscribed.filter(x=>x!==info.id);void persistNetwork();render();};
    const mark=textEl('span','federation-mark mark-blue','C'),copy=textEl('span','','');
    copy.append(textEl('strong','',info.name),textEl('small','',info.ambiguous?'Conflicting histories: founder rules':'Signed group · '+info.id.slice(0,16)+'…'));
    label.append(input,mark,copy);target.append(label);
    if(info.heads.length>1){
      const wrapper=textEl('div','group-fork-select','');
      wrapper.append(textEl('span','','Conflicting ratified branches — choose which to recognize:'));
      const select=document.createElement('select');
      const opts=[info.id,...info.heads].filter((head,i,a)=>a.indexOf(head)===i);
      for(const head of opts){
        const item=document.createElement('option');item.value=head;
        const proposal=state.replica.get(head);
        const summary=head===info.id?'Founding rules (no branch selected)':
          (proposal?.payload.body.change?.type||'branch')+' · '+head.slice(7,19)+'…';
        item.textContent=summary;select.append(item);
      }
      select.value=state.groupHeadChoices[info.id]||info.id;
      select.onchange=async()=>{
        state.groupHeadChoices[info.id]=select.value===info.id?null:select.value;
        await persistNetwork();await refreshGroups();render();
      };
      wrapper.append(select);target.append(wrapper);
    }
  }
}
function applySiteContext(){
  const ctx=state.siteContext;
  if(ctx?.embedded)document.body.classList.add('embedded');
  if(!ctx?.space)return;
  followSpace(ctx.space);
  state.space=ctx.space;
  $('#postSpace').value=ctx.space;
  $('#siteSpaceName').textContent=ctx.space;
  $('#siteSpaceBanner').hidden=false;
  if(ctx.preferredAuthor){
    $('#siteOwnerArea').hidden=false;
    $('#siteOwnerKey').textContent=shortAuthor(ctx.preferredAuthor);
    $('#honorSiteOwner').checked=state.honorSiteOwner;
  }
}
function refreshIdentityUI(){
  $('#identityKey').textContent=shortAuthor(state.identity.author);
  $('#migrateLegacyIdentity').hidden=!!state.identity.privateKey.extractable;
}
function downloadJSON(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function howLong(ts){
  const hours=Math.max(0,Math.floor((Date.now()-ts)/3600000));
  return hours<1?'Just now':hours<24?hours+'h ago':Math.floor(hours/24)+'d ago';
}
function typeOf(p){return p.body.fields?.uiType || (p.body.fields?.start?'Event':p.body.fields?.price?'Offer':'Discussion');}
function textEl(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=text;return e;}
function summaryFields(fields){
  const out=[];if(!fields)return out;
  for(const [k,v] of Object.entries(fields)){
    if(k==='uiType')continue;
    let value=typeof v==='object'&&v!==null?('amount' in v?String(v.amount)+' '+(v.currency||''):JSON.stringify(v)):String(v);
    if(value.length>23)value=value.slice(0,22)+'…';
    out.push(k+': '+value);
  }
  return out.slice(0,3);
}
function card({event,decision}){
  const p=event.payload,kind=typeOf(p);
  const filtered=!decision.visible;
  const item=textEl('article','post'+(filtered?' filtered':''),'');
  item.tabIndex=0;item.setAttribute('role','button');item.setAttribute('aria-label',filtered?'Filtered record metadata':'Open '+p.body.title);
  item.addEventListener('click',()=>openDetail(event));
  item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(event);}});
  const media=textEl('div','post-media','');
  if(filtered){media.append(textEl('span','art-icon','⛨'));}
  else{
    const fixture=previewContent.find(x=>x.title===p.body.title && state.fixtureKeys[x.author]?.author===p.author);
    if(fixture?.image){const img=document.createElement('img');img.src=fixture.image;img.loading='lazy';img.alt='Sample media for demo record';media.append(img);}
    else media.append(textEl('span','art-icon',({Event:'◷',Offer:'◇',Project:'⬡',Job:'✧',Art:'▦'}[kind]||'⌘')));
  }
  const typeBadge=textEl('span','badge-type',filtered?'FILTERED':kind.toUpperCase());media.append(typeBadge);
  if(!filtered && p.body.media?.length)media.append(textEl('span','media-count',p.body.media.length+' IPFS reference(s)'));
  const body=textEl('div','post-body',''),meta=textEl('div','post-meta','');
  meta.append(textEl('span','space-chip',(spaces[p.space]||p.space)),textEl('span','post-time',howLong(p.time)));
  body.append(meta,textEl('h3','',filtered?'Record filtered by your rules':p.body.title),textEl('p','post-description',filtered?decision.reason:p.body.text));
  if(!filtered){const chips=textEl('div','data-chips','');for(const f of summaryFields(p.body.fields))chips.append(textEl('span','',f));body.append(chips);}
  const footer=textEl('div','post-footer','');
  footer.append(textEl('span','author-name',filtered?'Signed record · '+shortAuthor(p.author):'◈ '+nickname(p.author)));
  footer.append(textEl('span','trust'+(decision.reason==='unverified'?' unknown':''),filtered?'Filtered':decision.reason==='trusted'?'● Trusted':'○ Unknown'));
  body.append(footer);item.append(media,body);return item;
}
function render(){
  state.policy=policy();
  const all=buildFeed(state.replica.list(),state.policy,state.identity.author);
  const visible=all.filter(x=>x.decision.visible).length,hidden=all.length-visible;
  $('#statVisible').textContent=visible;$('#statHidden').textContent=hidden;
  $('#followedCount').textContent=state.followedSpaces.length;
  const q=state.search.trim().toLowerCase();
  let results=all.filter(x=>(state.showFiltered||x.decision.visible))
    .filter(x=>state.space==='all'||x.event.payload.space===state.space)
    .filter(x=>state.type==='All'||typeOf(x.event.payload)===state.type)
    .filter(x=>!q||[x.event.payload.body.title,x.event.payload.body.text,x.event.payload.space,JSON.stringify(x.event.payload.body.fields||{})].some(s=>(s||'').toLowerCase().includes(q)));
  if(state.sort==='old')results=results.reverse();
  const feed=$('#feed');feed.replaceChildren(...results.map(card));feed.classList.toggle('list',state.layout==='list');
  $('#emptyState').hidden=results.length!==0;
  $('#resultCount').textContent=results.length+' records';
  $('#currentSpace').textContent=state.space==='all'?'All followed spaces':spaces[state.space]||state.space;
  $('#hiddenToggle').textContent=state.showFiltered?'Hide filtered':'Show filtered ('+hidden+')';
  $$('#typeFilters button').forEach(b=>b.classList.toggle('selected',b.dataset.type===state.type));
  $$('.side-link[data-space]').forEach(b=>b.classList.toggle('active',b.dataset.space===state.space));
}
function openDetail(event) {
  state.selected=event;
  const p=event.payload;const decision=buildFeed(state.replica.list(),state.policy,state.identity.author).find(x=>x.event.id===event.id)?.decision;
  $('#detailTitle').textContent=decision?.visible?p.body.title:'Filtered record';
  $('#detailBody').textContent=decision?.visible?p.body.text:'Your subscribed rules filter this record. Its signed metadata remains available and the underlying event is not deleted.';
  const info=$('#detailInfo');info.replaceChildren();
  for(const [key,val] of [['Event ID',event.id],['Author',p.author],['Space',p.space],['Type',p.kind],['Visibility',decision?.reason||'Unknown'],['Fields',decision?.visible?JSON.stringify(p.body.fields||{}):'(suppressed in filtered preview)'],['IPFS CIDs',decision?.visible?(p.body.media||[]).join(', ')||'None':'(suppressed)']]){
    const line=document.createElement('div');line.append(textEl('strong','',key+': '),textEl('code','',val));info.append(line);
  }
  $('#trustAuthor').textContent=state.policy.trustedAuthors.includes(p.author)?'Author already trusted':'Trust author';
  $('#flagEvent').disabled=p.author===state.identity.author;
  $('#detail').showModal();
}
function bindEvents(){
  $('#honorSiteOwner').onchange=e=>{state.honorSiteOwner=e.target.checked;render();};
  $('#managePeers').onclick=()=>{$('#peerSettings').hidden=!$('#peerSettings').hidden;};
  $('#autoMirror').onchange=async e=>{
    state.autoMirror=e.target.checked;
    await persistNetwork();
    newToast(state.autoMirror?'Trusted-record mirroring enabled: local policies still apply.':'Cross-index mirroring disabled.');
  };
  $('#mirrorNowButton').onclick=()=>{
    if(!state.mesh?.connected)return newToast('Connect to at least one peer first.');
    let n=0;
    const records=state.replica.list(),p=policy();
    for(const event of records){
      if(mirrorDecision(event,records,p,state.identity.author,{enabled:true,spaces:state.replicationScopes}).mirror){
        state.mesh.publish(event);n++;
      }
    }
    newToast('Submitted '+n+' locally approved signed posts to your selected peers.');
  };
  $('#connectPeers').onclick=async()=>{
    try{
      const peers=parsePeerUrls($('#networkEndpoints').value,location.protocol==='https:');
      const raw=$('#networkScopes').value.trim();
      const scopes=raw==='*'?['*']:raw.split(/[\s,]+/).filter(Boolean);
      if(!scopes.length||scopes.length>64||scopes.some(s=>s.length>180))throw Error('Invalid replication scopes');
      state.peerUrls=peers;state.replicationScopes=scopes;
      state.mesh.connect(peers,{spaces:scopes});await persistNetwork();
      updateNetworkStatus();newToast('Configured '+peers.length+' independently operated peer endpoint(s).');
    }catch(error){$('#networkLastError').textContent=error.message;newToast(error.message);}
  };
  $('#disconnectPeers').onclick=async()=>{
    state.mesh.disconnect();state.peerUrls=[];await persistNetwork();updateNetworkStatus();
    newToast('Disconnected. Local signed records are preserved.');
  };
  $('#followSpaceButton').onclick=()=>{
    try{
      const name=$('#followSpaceInput').value.trim();
      followSpace(name);state.space=name;render();$('#followSpaceInput').value='';
      newToast('Following '+name+' locally; update replication scopes to mirror it.');
    }catch(error){newToast(error.message);}
  };
  $('#republishButton').onclick=()=>{
    if(!state.mesh?.connected)return newToast('Connect a peer first.');
    let count=0;
    for(const id of state.localIds){
      const event=state.replica.get(id);
      if(event?.payload.author===state.identity.author){
        state.mesh.publish(event);count++;
      }
    }
    newToast('Reannounced '+count+' own signed event(s) to your connected peers.');
  };
  const filter=$('#typeFilters');
  for(const name of types){const b=textEl('button','',name);b.dataset.type=name;b.onclick=()=>{state.type=name;render();};filter.append(b);}
  $$('.side-link[data-space]').forEach(b=>b.onclick=()=>{state.space=b.dataset.space;render();window.scrollTo({top:0,behavior:'smooth'});});
  $$('#layoutOptions button').forEach(b=>b.onclick=()=>{$$('#layoutOptions button').forEach(x=>x.classList.toggle('selected',x===b));state.layout=b.dataset.layout;render();});
  $('#sortBy').onchange=e=>{state.sort=e.target.value;render();};
  $('#searchInput').oninput=e=>{state.search=e.target.value;render();};
  $('#showUnknown').onchange=e=>{state.showUnknown=e.target.checked;render();};
  $('#showFiltered').onchange=e=>{state.showFiltered=e.target.checked;render();};
  $('#hiddenToggle').onclick=()=>{state.showFiltered=!state.showFiltered;$('#showFiltered').checked=state.showFiltered;render();};
  $('#subscribeGuild').onchange=e=>{state.subscribed=e.target.checked?[...new Set([...state.subscribed,state.groupIds.guild])]:state.subscribed.filter(x=>x!==state.groupIds.guild);void persistNetwork();render();};
  $('#subscribeSafety').onchange=e=>{state.subscribed=e.target.checked?[...new Set([...state.subscribed,state.groupIds.safety])]:state.subscribed.filter(x=>x!==state.groupIds.safety);void persistNetwork();render();};
  $('#createGroupButton').onclick=()=>$('#groupComposer').showModal();
  $('#closeGroup').onclick=()=>$('#groupComposer').close();
  $('#groupForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const name=$('#groupName').value.trim();
      const quorum={numerator:Number($('#groupThreshold').value),denominator:100};
      const charter=await signEvent(state.identity,{kind:'group',body:{name,quorum}});
      await publishLocal(charter);
      if($('#selfReviewer').checked){
        const proposal=await signEvent(state.identity,{kind:'proposal',body:{
          group:charter.id,parent:charter.id,
          change:{type:'appoint-reviewer',author:state.identity.author,weight:1}}});
        const ballot=await signEvent(state.identity,{kind:'vote',body:{proposal:proposal.id,choice:'approve'}});
        await publishLocal(proposal);await publishLocal(ballot);
      }
      state.subscribed.push(charter.id);
      await refreshGroups();
      $('#groupComposer').close();$('#groupForm').reset();render();
      newToast('Signed group created. Export events to share its charter and ballots.');
    }catch(error){newToast('Group creation failed: '+error.message);}
  };
  $('#identityBackupButton').onclick=()=>$('#identityDialog').showModal();
  $('#closeIdentity').onclick=()=>{ $('#backupPassword').value='';$('#identityDialog').close(); };
  $('#downloadBackup').onclick=async()=>{
    try{
      const pass=$('#backupPassword').value;
      const backup=await exportIdentityBackup(state.identity,pass);
      downloadJSON(backup,'web9000-identity-encrypted.json');
      newToast('Encrypted signing-key backup exported. Keep the password and file separately.');
    }catch(e){newToast('Backup failed: '+e.message);}
  };
  $('#restoreBackup').onclick=()=>{
    if($('#backupPassword').value.length<12){newToast('Enter your backup password (at least 12 characters).');return;}
    $('#identityFile').click();
  };
  $('#identityFile').onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>15000)throw Error('Identity backup exceeds 15 KB');
      const restored=await importIdentityBackup(JSON.parse(await file.text()),$('#backupPassword').value);
      if(restored.author!==state.identity.author && state.localIds.some(id=>state.replica.get(id)?.payload.author===state.identity.author)){
        if(!window.confirm('Changing signing identity means your previous posts remain attributed to your old key. Have you securely backed up the old key?'))return;
      }
      state.identity=restored;
      if(state.db)await setItem(state.db,'identity',restored);
      refreshIdentityUI();render();
      $('#backupPassword').value='';$('#identityDialog').close();
      newToast('Encrypted identity restored on this website. Signatures remain portable.');
    }catch(err){newToast('Restore rejected: '+err.message);}finally{e.target.value='';}
  };
  $('#migrateLegacyIdentity').onclick=async()=>{
    if(!window.confirm('This old non-exportable key cannot be backed up. Migrate to a new portable key? A signed endorsement will link your old identity to the new one, but the old key will no longer be usable in this browser.'))return;
    try{
      const newIdentity=await generateIdentity({extractable:true});
      const linkage=await signEvent(state.identity,{kind:'endorse',body:{subject:newIdentity.author,action:'trust'}});
      await publishLocal(linkage);
      state.identity=newIdentity;if(state.db)await setItem(state.db,'identity',newIdentity);
      refreshIdentityUI();render();newToast('New identity created; back it up now. Old endorsement is in your signed records.');
    }catch(error){newToast('Migration failed: '+error.message);}
  };
  $('#composeButton').onclick=()=>{
    $('#postSpace').value=state.space==='all'?'commons':state.space;
    $('#composer').showModal();
  };
  $('#closeCompose').onclick=()=>$('#composer').close();
  $('#closeDetail').onclick=()=>$('#detail').close();
  $('#noticeClose').onclick=()=>$('#notice').remove();
  $('#settingsButton').onclick=()=>newToast('Adjust the switches or subscribe to voluntary reviewer groups.');
  $('#showRules').onclick=()=>{
    const subscribed=state.groupViews.filter(g=>state.subscribed.includes(g.id));
    $('#rulesDetails').textContent=
      'Your view trusts '+subscribed.length+' independently signed group(s).\n\n'+
      (subscribed.length?subscribed.map(g=>g.name+'\ncharter: '+g.id+
      '\nbranch: '+(state.groupHeadChoices[g.id]||'founding/unique')+
      '\ncompeting heads: '+g.heads.length).join('\n\n'):'No groups selected.')+
      '\n\nNo selection above changes the right to publish or deletes anyone’s records.';
    $('#rulesDialog').showModal();
  };
  $('#closeRules').onclick=()=>$('#rulesDialog').close();
  $('#composeForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const fieldsText=$('#postFields').value.trim(),fields=fieldsText?JSON.parse(fieldsText):{};
      if(!fields || typeof fields!=='object' || Array.isArray(fields))throw Error('Fields must be a JSON object');
      fields.uiType=({discussion:'Discussion',art:'Art',event:'Event',offer:'Offer',project:'Project',job:'Job'})[$('#postKind').value];
      const media=$('#postMedia').value.trim().split(/[\s,]+/).filter(Boolean);
      const event=await signEvent(state.identity,{space:$('#postSpace').value.trim(),body:{
        title:$('#postTitle').value,text:$('#postText').value,media,fields
      }});
      await publishLocal(event);
      followSpace(event.payload.space);
      $('#composer').close();$('#composeForm').reset();state.space='all';state.type='All';render();newToast('Signed and saved locally. Export to share with independent peers.');
    }catch(error){$('#composeMessage').textContent=error.message;newToast('Cannot sign: '+error.message);}
  };
  $('#trustAuthor').onclick=()=>{const author=state.selected?.payload.author;if(author){state.userTrusted=[...new Set([...(state.userTrusted || []),author])];
    try{localStorage.setItem('w9-trusted',JSON.stringify(state.userTrusted));}catch{}
    render();openDetail(state.selected);newToast('Trusted locally. No global reputation changed.');}};
  $('#flagEvent').onclick=async()=>{
    const target=state.selected;if(!target || target.payload.author===state.identity.author)return;
    const label=await signEvent(state.identity,{kind:'label',space:target.payload.space,body:{target:target.id,tag:'spam',reason:'Locally submitted label'}});
    await publishLocal(label);$('#detail').close();render();newToast('Signed label created. The source event remains intact.');
  };
  $('#copyEvent').onclick=async()=>{if(!state.selected)return;try{await navigator.clipboard.writeText(JSON.stringify(state.selected,null,2));newToast('Portable signed event copied.');}catch{newToast('Clipboard unavailable in this browser. Use Export instead.');}};
  $('#exportButton').onclick=()=>{
    const payload=JSON.stringify({format:'web9000-events-v1',events:state.replica.list()},null,2);
    const url=URL.createObjectURL(new Blob([payload],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='web9000-signed-events.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    newToast('Exported signed records; import them into another instance.');
  };
  $('#importButton').onclick=()=>$('#importFile').click();
  $('#importFile').onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>4*1024*1024)throw Error('Maximum import size is 4 MB');
      const parsed=JSON.parse(await file.text());
      if(parsed.format!=='web9000-events-v1'||!Array.isArray(parsed.events)||parsed.events.length>3000)throw Error('Invalid signed export');
      let count=0;
      for(const event of parsed.events){if(!await verifyEvent(event))continue;const result=await addLocal(event);if(result.accepted&&!result.duplicate)count++;}
      await refreshGroups();render();newToast('Imported '+count+' valid new events. No moderator approval.');
    }catch(err){newToast('Import rejected: '+err.message);}finally{e.target.value='';}
  };
  // Stored user trust is independent of the embedded site, group or namespace.
  try{state.userTrusted=JSON.parse(localStorage.getItem('w9-trusted')||'[]');}catch{state.userTrusted=[];}
}
init().catch(e=>{console.error(e);$('#feed').append(textEl('p','', 'This browser cannot initialize the Ed25519 demo: '+e.message));});
