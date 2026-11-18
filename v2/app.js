import {generateIdentity,signEvent,verifyEvent,shortAuthor} from './core/events.js';
import {Replica} from './core/replica.js';
import {buildFeed,DEFAULT_POLICY} from './core/policy.js';
import {deriveGroup} from './core/governance.js';
import {openLocal,getItem,setItem} from './core/persist.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const spaces={commons:'Commons',art:'Creative works',organize:'Organize',exchange:'Exchange',projects:'Projects'};
const types=['All','Discussion','Art','Event','Offer','Project','Job'];
const state={replica:new Replica(),identity:null,db:null,space:'all',type:'All',layout:'grid',sort:'new',search:'',showFiltered:false,showUnknown:true,subscribed:[],policy:null,selected:null,fixtureKeys:{},localIds:[],groupIds:{},compiledGroups:{},groupViews:[],userTrusted:[]};
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
  return {...DEFAULT_POLICY,followedSpaces:Object.keys(spaces),showUnknown:state.showUnknown,
    trustedAuthors:[...new Set([state.identity.author,...Object.values(state.fixtureKeys).filter(x=>x.name!=='outsider').map(x=>x.author),...(state.userTrusted || [])])],
    groups:state.compiledGroups,subscriptions:state.subscribed,
    reviewerWeights:{[state.identity.author]:1}
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
async function init() {
  try {
    state.db=await openLocal();
    state.identity=await getItem(state.db,'identity');
    if(!state.identity){state.identity=await generateIdentity();await setItem(state.db,'identity',state.identity);}
  } catch (e) { console.warn('IndexedDB unavailable',e);state.identity=await generateIdentity();newToast('Browser storage unavailable: session is temporary'); }
  $('#identityKey').textContent=shortAuthor(state.identity.author);
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
  await refreshGroups();
  state.policy=policy(); bindEvents();render();
}
async function refreshGroups() {
  const events=state.replica.list(), compiled={},views=[];
  for(const record of events.filter(e=>e.payload.kind==='group')){
    const view=await deriveGroup(events,record.id);
    if(!view.found)continue;
    compiled[record.id]={reviewers:view.state.reviewers,inherits:view.state.delegates};
    views.push({id:record.id,name:view.state.name,heads:view.heads,ambiguous:view.ambiguous});
  }
  state.compiledGroups=compiled;state.groupViews=views;
  const known=new Set(views.map(x=>x.id));
  state.subscribed=state.subscribed.filter(id=>known.has(id));
  renderGroupChoices();
}
function renderGroupChoices() {
  const target=$('#customGroups');
  target.replaceChildren();
  for(const info of state.groupViews.filter(v=>!Object.values(state.groupIds).includes(v.id))){
    const label=textEl('label','federation',''),input=document.createElement('input');
    input.type='checkbox';input.checked=state.subscribed.includes(info.id);
    input.onchange=()=>{state.subscribed=input.checked?[...new Set([...state.subscribed,info.id])]:state.subscribed.filter(x=>x!==info.id);render();};
    const mark=textEl('span','federation-mark mark-blue','C'),copy=textEl('span','','');
    copy.append(textEl('strong','',info.name),textEl('small','',info.ambiguous?'Conflicting histories: founder rules':'Signed group · '+info.id.slice(0,16)+'…'));
    label.append(input,mark,copy);target.append(label);
  }
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
  $('#followedCount').textContent=Object.keys(spaces).length;
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
  for(const [key,val] of [['Event ID',event.id],['Author',p.author],['Space',p.space],['Type',p.kind],['Visibility',decision?.reason||'Unknown'],['Fields',decision?.visible?JSON.stringify(p.body.fields||{}):'(suppressed in filtered preview)']]){
    const line=document.createElement('div');line.append(textEl('strong','',key+': '),textEl('code','',val));info.append(line);
  }
  $('#trustAuthor').textContent=state.policy.trustedAuthors.includes(p.author)?'Author already trusted':'Trust author';
  $('#flagEvent').disabled=p.author===state.identity.author;
  $('#detail').showModal();
}
function bindEvents(){
  const filter=$('#typeFilters');
  for(const name of types){const b=textEl('button','',name);b.dataset.type=name;b.onclick=()=>{state.type=name;render();};filter.append(b);}
  $$('.side-link[data-space]').forEach(b=>b.onclick=()=>{state.space=b.dataset.space;render();window.scrollTo({top:0,behavior:'smooth'});});
  $$('#layoutOptions button').forEach(b=>b.onclick=()=>{$$('#layoutOptions button').forEach(x=>x.classList.toggle('selected',x===b));state.layout=b.dataset.layout;render();});
  $('#sortBy').onchange=e=>{state.sort=e.target.value;render();};
  $('#searchInput').oninput=e=>{state.search=e.target.value;render();};
  $('#showUnknown').onchange=e=>{state.showUnknown=e.target.checked;render();};
  $('#showFiltered').onchange=e=>{state.showFiltered=e.target.checked;render();};
  $('#hiddenToggle').onclick=()=>{state.showFiltered=!state.showFiltered;$('#showFiltered').checked=state.showFiltered;render();};
  $('#subscribeGuild').onchange=e=>{state.subscribed=e.target.checked?[...new Set([...state.subscribed,state.groupIds.guild])]:state.subscribed.filter(x=>x!==state.groupIds.guild);render();};
  $('#subscribeSafety').onchange=e=>{state.subscribed=e.target.checked?[...new Set([...state.subscribed,state.groupIds.safety])]:state.subscribed.filter(x=>x!==state.groupIds.safety);render();};
  $('#composeButton').onclick=()=>$('#composer').showModal();
  $('#closeCompose').onclick=()=>$('#composer').close();
  $('#closeDetail').onclick=()=>$('#detail').close();
  $('#noticeClose').onclick=()=>$('#notice').remove();
  $('#settingsButton').onclick=()=>newToast('Adjust the switches or subscribe to voluntary reviewer groups.');
  $('#showRules').onclick=()=>newToast('Your view is determined by local switches and voluntary guild subscriptions.');
  $('#composeForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const fieldsText=$('#postFields').value.trim(),fields=fieldsText?JSON.parse(fieldsText):{};
      if(!fields || typeof fields!=='object' || Array.isArray(fields))throw Error('Fields must be a JSON object');
      fields.uiType=({discussion:'Discussion',art:'Art',event:'Event',offer:'Offer',project:'Project',job:'Job'})[$('#postKind').value];
      const event=await signEvent(state.identity,{space:$('#postSpace').value.trim(),body:{title:$('#postTitle').value,text:$('#postText').value,fields}});
      await addLocal(event);
      const newSpace=event.payload.space;if(!state.policy.followedSpaces.includes(newSpace)){
        spaces[newSpace]=newSpace;const button=textEl('button','side-link','◈ '+newSpace);button.dataset.space=newSpace;button.onclick=()=>{state.space=newSpace;render();};$('.side-section .side-link[data-space="all"]').parentElement.append(button);
      }
      $('#composer').close();$('#composeForm').reset();state.space='all';state.type='All';render();newToast('Signed and saved locally. Export to share with independent peers.');
    }catch(error){$('#composeMessage').textContent=error.message;newToast('Cannot sign: '+error.message);}
  };
  $('#trustAuthor').onclick=()=>{const author=state.selected?.payload.author;if(author){state.userTrusted=[...new Set([...(state.userTrusted || []),author])];
    try{localStorage.setItem('w9-trusted',JSON.stringify(state.userTrusted));}catch{}
    render();openDetail(state.selected);newToast('Trusted locally. No global reputation changed.');}};
  $('#flagEvent').onclick=async()=>{
    const target=state.selected;if(!target || target.payload.author===state.identity.author)return;
    const label=await signEvent(state.identity,{kind:'label',space:target.payload.space,body:{target:target.id,tag:'spam',reason:'Locally submitted label'}});
    await addLocal(label);$('#detail').close();render();newToast('Signed label created. The source event remains intact.');
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
