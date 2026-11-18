// WEB9000 classic imageboard: restoration of the original image-first interface,
// backed by genuine portable signed records. Never grants namespace ownership.
import {generateIdentity,signEvent,shortAuthor} from './core/events.js';
import {Replica} from './core/replica.js';
import {openLocal,getItem,setItem} from './core/persist.js';
import {buildFeed,DEFAULT_POLICY} from './core/policy.js';
import {BrowserPeerMesh,parsePeerUrls} from './network/browser-mesh.js';
import {readSiteContext} from './network/site-context.js';

const $=id=>document.getElementById(id);
const state={
  db:null,identity:null,replica:new Replica({maxEvents:25000}),saved:[],outbox:[],
  peers:[],mesh:null,suggested:[],mediaBase:null,
  space:'commons',sort:'new',view:'grid',search:'',showUnverified:false,
  ownerHint:null,respectOwner:true,selected:null,trust:[],audit:false,showMedia:false,
  demo:[],lastError:'',renderPending:false
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
function mediaURL(cid){
  return state.mediaBase?.replace(/\/$/,'')+'/ipfs/'+encodeURIComponent(cid.slice(7));
}
function trustedForMedia(author){
  return author===state.identity?.author||state.trust.includes(author);
}
const demoImages=[1,2,3,5,6,7,8,9,11,12,14,15,16,18,19,20,22,23,24,25,26,27,28,31];
const sampleTitles=[
  'Cats enjoy cardboard boxes','Small image experiment','An unexpected visitor','Photographic archive',
  'Something found on the internet','Simple collage','Look at this thing','Creative commons',
  'Walking around town','Old computers','A pattern worth sharing','Beautiful sky',
  'Strange architecture','An internet memory','Underground art','Useful electronics',
  'Open source project','What is your favorite design?','A tiny meetup',
  'Listen to this audio idea','A public domain illustration','Weekend discussion',
  'Freely shared research','Something worth remembering'
];
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
const who=author=>author===state.identity?.author?'You':author==='demo'?'Demo fixture':shortAuthor(author);
function choosePolicy(){
  const known=[state.identity.author,...state.trust,...(state.ownerHint&&state.respectOwner?[state.ownerHint]:[])];
  const owner=state.ownerHint&&state.respectOwner?{[state.space]:state.ownerHint}:{};
  return {...DEFAULT_POLICY,followedSpaces:[state.space],trustedAuthors:known,
    showUnknown:state.showUnverified,ownerPreference:owner,
    reviewerWeights:{[state.identity.author]:1}};
}
const allEvents=()=>state.replica.list();
const currentPosts=()=>{
  const records=allEvents(),all=buildFeed(records,choosePolicy(),state.identity.author)
    .filter(x=>x.event.payload.kind==='post');
  let feed=all.filter(x=>x.decision.visible||state.audit);
  const q=state.search.toLowerCase().trim();
  if(q)feed=feed.filter(x=>{
    const p=x.event.payload;const f=p.body.fields||{};
    return [p.body.title,p.body.text,p.space,JSON.stringify(f)].join(' ').toLowerCase().includes(q);
  });
  if(state.sort==='old')feed.reverse();
  if(state.sort==='popular')feed.sort((a,b)=>reactionScore(b.event.id,records)-reactionScore(a.event.id,records));
  return feed.map(x=>({event:x.event,decision:x.decision,demo:false}));
};
function makeDemo(){
  state.demo=demoImages.map((n,i)=>{
    const title=sampleTitles[i]||'Example image';
    const p={kind:'post',author:'demo',space:'commons',time:Date.now()-i*86400000,
      body:{title,text:i%5===0?'This is an illustrative tile from the original prototype layout. It is not a publication on the shared network.':'Visual demo content, not published.',fields:{tags:['demo','image','classic'],presentation:'image'}}};
    return {event:{id:'demo:'+i,payload:p},demo:true,thumb:'../thumb/thumb'+String(n).padStart(2,'0')+'.jpg',
      decision:{visible:true,reason:'visual fixture'}};
  });
}
function effectiveFeed(){
  const actual=currentPosts();
  // Never mix illustrative thumbnails with live network records.
  return actual.length===0 && state.replica.list().filter(e=>e.payload.kind==='post').length===0 && state.space==='commons'
    ?state.demo:actual;
}
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
function recognizedTags(post,records=allEvents()){
  const total=new Map();
  for(const raw of post.payload.body.fields?.tags||[]){
    if(typeof raw!=='string'||!validTag(raw))continue;
    total.set(raw,(total.get(raw)||0)+1);
  }
  for(const e of latestVotes('tag-vote',post.id,records))
    total.set(e.payload.body.tag,(total.get(e.payload.body.tag)||0)+e.payload.body.value);
  return [...total.entries()].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
}
function columns(){
  const w=window.innerWidth;
  return state.view==='blog'?1:w<=410?2:w<=620?3:w<=800?4:w<=1130?5:7;
}
function tile(item,i,replyCounts){
  const p=item.event.payload,b=p.body;
  const card=element('div','post'+(item.decision?.visible?'':' filtered')+(b.fields?.presentation==='text'||!item.thumb&&!b.media?.length?' text-only':''));
  card.dataset.index=String(i);card.dataset.id=item.event.id;
  card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',b.title||'Post');
  if(item.thumb){
    const img=document.createElement('img');img.className='post-thumb';img.loading='lazy';img.src=item.thumb;img.alt=b.title||'Demo picture';
    card.append(img);
  } else if(b.media?.length){
    if(item.decision?.visible && state.mediaBase && trustedForMedia(p.author)){
      // Only self-uploaded images or identities this viewer explicitly trusts.
      // Raw publications by strangers NEVER trigger media download.
      const img=document.createElement('img');
      img.className='post-thumb';img.loading='lazy';img.alt=b.title||'Trusted image';
      img.src=mediaURL(b.media[0]);
      img.onerror=()=>img.replaceWith(element('div','post-reveal','Media unavailable · click to inspect CID'));
      card.append(img);
    } else {
      card.append(element('div','post-reveal','IPFS image · open to load'));
    }
  }else{
    card.append(element('div','post-text-preview',b.text||b.title||'Text post'));
  }
  if(b.title)card.append(element('div','post-headline',b.title));
  const icons=[];if(item.demo)icons.push('DEMO');if(b.media?.length)icons.push('▣ '+b.media.length);
  if(b.fields?.poll)icons.push('▤');if(b.fields?.schedule)icons.push('▣');
  if(b.fields?.positions?.length)icons.push('◈');
  const replyCount=replyCounts.get(item.event.id)||0;
  if(replyCount)icons.push('☰ '+replyCount);
  if(icons.length)card.append(element('div','post-icons',icons.join(' ')));
  if(!item.decision?.visible)card.append(element('div','post-small','FILTERED · AUDIT'));
  card.addEventListener('click',()=>{ if(state.selected===item.event.id){state.selected=null;render();}else expand(item.event.id); });
  return card;
}
function updateNetworkStatus(){
  if(!state.identity)return;
  $('peerStatus').textContent=(state.mesh?.connected||0)+' peer(s) · '+
    allEvents().filter(e=>e.payload.kind==='post').length+
    ' signed posts · '+state.outbox.length+' queued';
  $('joinNetwork').textContent=state.mesh?.connected?'◉ Network':'Join Network';
  $('joinNetwork').classList.toggle('connected',!!state.mesh?.connected);
}
function render(){
  if(!state.identity)return;
  const feed=effectiveFeed(),grid=$('imageGrid');
  const prev=state.selected;
  grid.className='grid '+state.view;
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
    (feed.some(x=>x.demo)?' · demo images only, not network data':'')+
    (state.audit?' · showing suppressed publications and moderation evidence':'');
  if(prev && feed.some(x=>x.event.id===prev))expand(prev,{focus:false});
  else state.selected=null;
}
function scheduleRender(){
  if(state.renderPending)return;
  state.renderPending=true;
  // Browser tabs without focus may suspend requestAnimationFrame indefinitely.
  // Network replies must still update their stored and displayed threads.
  // A microtask coalesces same-turn updates without depending on paint frames.
  queueMicrotask(()=>{state.renderPending=false;render();});
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
    setItem(state.db,'classic-show-unknown',state.showUnverified),
    setItem(state.db,'classic-view',state.view),
    setItem(state.db,'classic-show-media',state.showMedia),
    setItem(state.db,'classic-media-url',state.mediaBase)
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
  try{await publish('reaction',{target:id,value});}
  catch(e){toast('Reaction not accepted: '+e.message);}
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
    textarea.value='';
    expand(post.id,{focus:false});
    toast('Signed reply '+message.id.slice(0,18)+'…');
  }catch(error){toast('Could not publish reply: '+error.message);}
}
function addCommentForm(area,post,parent=post.id){
  const box=element('div','comment-form');
  const ta=document.createElement('textarea');ta.placeholder=parent===post.id?'Write a comment...':'Reply to comment...';
  box.append(ta,button('Send signed reply',()=>appendReply(post,ta,parent)));
  area.append(box);return box;
}
function formatDate(t){
  const time=typeof t==='number'?new Date(t):new Date(t);
  return Number.isNaN(time.getTime())?'Unknown date':time.toLocaleString();
}
function renderReplies(body,post){
  const replies=allEvents().filter(e=>e.payload.kind==='reply');
  const byParent=new Map();
  for(const e of replies){
    if(!state.showUnverified&&e.payload.author!==state.identity.author&&!state.trust.includes(e.payload.author))continue;
    if(!byParent.has(e.payload.body.parent))byParent.set(e.payload.body.parent,[]);
    byParent.get(e.payload.body.parent).push(e);
  }
  for(const values of byParent.values())values.sort((a,b)=>a.payload.time-b.payload.time);
  const section=element('section','comments-section');
  section.append(element('h3','','Comments ('+(byParent.get(post.id)?.length||0)+' direct)'));
  let count=0;const visited=new Set();
  const walk=(parent,depth)=>{
    for(const reply of byParent.get(parent)||[]){
      if(visited.has(reply.id)||depth>7||++count>300)continue;
      visited.add(reply.id);
      const box=element('div','comment'+(depth?' reply':''));
      const head=element('div','comment-head');
      head.append(element('b','',who(reply.payload.author)),document.createTextNode(' · '+formatDate(reply.payload.time)));
      box.append(head,element('div','comment-text',reply.payload.body.text));
      const actions=element('div','comment-actions');
      const replier=button('Reply',()=>{replier.remove();addCommentForm(box,post,reply.id).querySelector('textarea').focus();});
      actions.append(replier);box.append(actions);section.append(box);walk(reply.id,depth+1);
    }
  };
  walk(post.id,0);addCommentForm(section,post);body.append(section);
}
function markAudit(body,item){
  const post=item.event;
  const labels=allEvents().filter(e=>e.payload.kind==='label'&&(e.payload.body.target===post.id));
  if(!state.audit&&!labels.length)return;
  const section=element('div','audit-summary');
  section.append(element('b','',item.decision.visible?'Audit: this post remains visible under your rules':'Audit: this post is hidden by your currently selected rules'));
  section.append(element('p','',item.decision.reason+' · Signed original record remains unchanged and may be mirrored elsewhere.'));
  if(!labels.length)section.append(element('div','','No signed moderation labels for this record.'));
  for(const label of labels){
    const el=element('div','audit-label',who(label.payload.author)+' applied '+label.payload.body.tag+' — '+label.payload.body.reason);
    section.append(el);
  }
  section.append(element('small','','Rule decisions are local, and any steward’s action is a signed claim, not universal deletion.'));
  body.append(section);
}
function showMedia(body,post){
  if(!post.payload.body.media?.length)return;
  const area=element('div','attachments');
  for(const cid of post.payload.body.media){
    const wrap=element('div','media-ref');
    const short=cid.slice(0,32)+'…';
    wrap.append(element('div','',short));
    const load=button('Load image manually',()=>{
      const url=state.mediaBase;
      if(!url){toast('No independent IPFS media gateway configured. The signed CID can be copied to another gateway.');return;}
      const img=document.createElement('img');
      img.loading='lazy';img.alt='Explicitly loaded IPFS attachment';
      img.src=mediaURL(cid);
      img.onerror=()=>{img.replaceWith(element('p','','Image unavailable at this peer. CID is still present.'));};
      wrap.replaceChildren(img);
    });
    if(state.mediaBase&&trustedForMedia(post.payload.author)){
      // Safe-to-fetch self / explicitly trusted images render in the
      // expanded post without an additional manual click.
      load.click();
    }else{
      wrap.append(load);
    }
    wrap.append(button('Copy CID',()=>navigator.clipboard?.writeText(cid).then(()=>toast('CID copied'))));
    area.append(wrap);
  }
  body.append(area);
}
function expand(id,{focus=true}={}){
  const feed=effectiveFeed(),index=feed.findIndex(x=>x.event.id===id);
  if(index<0)return;
  state.selected=id;
  const current=feed[index],p=current.event.payload,b=p.body;
  for(const container of document.querySelectorAll('.post-container'))container.remove();
  for(const tile of document.querySelectorAll('.post.selected'))tile.classList.remove('selected');
  const cards=[...document.querySelectorAll('.post')],card=cards[index];
  card.classList.add('selected');
  const panel=element('div','post-container expanded'),row=element('div','expanded-row');
  const left=element('span','nav-arrow','◀'),right=element('span','nav-arrow','▶');
  left.tabIndex=0;right.tabIndex=0;
  left.addEventListener('click',()=>navigate(-1));right.addEventListener('click',()=>navigate(1));
  const body=element('div','expanded-body');
  body.append(element('h2','',b.title||'Untitled post'));
  const metadata=element('div','details-line');
  metadata.append(element('span','','From '+who(p.author)),
    element('span','','Space: '+p.space),element('span','',formatDate(p.time)));
  if(current.demo)metadata.append(element('span','','Unpublished local visual example'));
  body.append(metadata);
  if(current.thumb){
    const region=element('div','attachments'),img=document.createElement('img');
    img.src=current.thumb;img.alt=b.title||'Demo image';img.loading='lazy';region.append(img);body.append(region);
  }else showMedia(body,current.event);
  if(b.text)body.append(element('p','',b.text));
  const field=b.fields||{};
  if(field.schedule){
    const date=element('div','schedule');
    date.append(element('strong','','Event schedule'));
    for(const [label,value] of [['Starts',field.schedule.start],['Ends',field.schedule.end],['Place',field.schedule.location]]){
      if(value)date.append(element('p','',label+': '+(label==='Place'?value:formatDate(value))));
    }body.append(date);
  }
  if(field.positions?.length){
    const block=element('div','positions');block.append(element('strong','','Open positions'));
    for(const position of field.positions)block.append(element('p','',position));
    body.append(block);
  }
  if(field.poll?.options?.length){
    const choices=latestVotes('poll-choice',id);
    const poll=element('div','poll');poll.append(element('strong','',field.poll.question));
    for(const [i,opt] of field.poll.options.entries()){
      const tally=choices.filter(x=>x.payload.body.option===i).length;
      poll.append(button(opt+' · '+tally+' vote(s)',()=>current.demo?toast('Demo poll is not networked'):pollVote(id,i)));
    }body.append(poll);
  }
  const tags=element('div','label-row');
  for(const [name,count] of recognizedTags(current.event)){
    tags.append(button('#'+name+' '+count+' +',()=>current.demo?toast('Demo tags are illustrative'):tagVote(id,name,1),'tag'));
    if(!current.demo)tags.append(button('−',()=>tagVote(id,name,-1),'tag'));
  }
  if(!current.demo)tags.append(button('+ Add tag',()=>{
    const input=window.prompt('Tag (letters, numbers, period, dash, colon or underscore)');
    const tag=String(input||'').trim().toLowerCase();
    if(!tag)return;if(!validTag(tag))return toast('Invalid tag name');
    tagVote(id,tag,1);
  }));
  body.append(tags);
  if(!current.demo){
    const votes=element('div','reactions');
    votes.append(element('span','score',String(reactionScore(id))));
    for(const [label,v] of [['++',2],['+',1],['−',-1],['−−',-2]])
      votes.append(button(label,()=>react(id,v)));
    votes.append(button('Flag spam',async()=>{
      const reason=window.prompt('Why is this post mass-produced commercial spam?');
      if(!reason)return;
      try{await publish('label',{target:id,tag:'spam',reason:reason.slice(0,500)});expand(id,{focus:false});}
      catch(error){toast(error.message);}
    }));
    votes.append(button('Trust author',async()=>{
      if(!state.trust.includes(p.author))state.trust.push(p.author);
      await store();scheduleRender();toast('You locally trust this author. No global rule changed.');
    }));
    votes.append(button('Copy signed record',()=>navigator.clipboard?.writeText(JSON.stringify(current.event,null,2)).then(()=>toast('Signed record copied'))));
    body.append(votes);
    markAudit(body,current);renderReplies(body,current.event);
  }
  row.append(left,body,right);panel.append(row);
  // Insert below the *actual rendered CSS grid row*, including mixed tiles.
  const top=card.offsetTop;let end=card;
  for(const next of cards.slice(index+1)){
    if(next.offsetTop!==top)break;end=next;
  }
  end.after(panel);
  if(focus){card.focus({preventScroll:true});panel.scrollIntoView({block:'nearest',behavior:'instant'});}
}
function navigate(direction){
  const feed=effectiveFeed(),idx=feed.findIndex(x=>x.event.id===state.selected);
  if(idx<0)return;
  const next=idx+direction;if(next>=0&&next<feed.length)expand(feed[next].event.id);
}
function onKey(e){
  const target=e.target;
  if(target.matches?.('input,textarea,select,[contenteditable],dialog')||target.closest?.('dialog'))return;
  if(e.key==='Escape'){state.selected=null;render();return;}
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
  if(next){e.preventDefault();next.focus();if(state.selected)expand(next.dataset.id,{focus:false});}
}
function bind(){
  for(const btn of document.querySelectorAll('[data-sort]'))
    btn.onclick=()=>{state.sort=btn.dataset.sort;document.querySelectorAll('[data-sort]').forEach(b=>b.classList.toggle('active',b===btn));render();};
  $('viewAudited').onclick=()=>{state.audit=!state.audit;$('viewAudited').classList.toggle('active',state.audit);render();};
  $('searchPosts').oninput=e=>{state.search=e.target.value;render();};
  $('showUnverified').onchange=async e=>{state.showUnverified=e.target.checked;await store();render();};
  $('viewStyle').onchange=async e=>{state.view=e.target.value;await store();render();};
  $('goSpace').onclick=async()=>{
    const name=$('spaceName').value.trim();if(!safeSpace(name))return toast('Invalid namespace');
    state.space=name;state.selected=null;await store();render();
  };
  $('spaceName').onkeydown=e=>{if(e.key==='Enter')$('goSpace').click();};
  $('postNew').onclick=()=>{$('composeSpace').value=state.space;modal('postDialog');};
  $('closeComposer').onclick=()=>close('postDialog');$('cancelPost').onclick=()=>close('postDialog');
  $('joinNetwork').onclick=()=>modal('networkDialog');$('closeNetwork').onclick=()=>close('networkDialog');
  $('suggestPeers').onclick=loadSuggestions;
  $('connectPeers').onclick=connectPeers;
  $('disconnectPeers').onclick=async()=>{
    state.mesh.disconnect();state.peers=[];await store();$('peerURLs').value='';render();toast('Disconnected; local posts and backups remain.');
  };
  $('postForm').onsubmit=compose;
  document.addEventListener('keydown',onKey);
  window.addEventListener('resize',()=>state.selected&&scheduleRender());
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
    state.mediaBase=normalizeMediaBase($('mediaPeerUrl').value);
    state.peers=urls;
    state.mesh.connect(urls,{spaces:['*']});
    await store();close('networkDialog');render();
    toast('Connecting to '+urls.length+' independent peer(s); unverified content remains hidden by default.');
  }catch(error){toast('Connection setup: '+error.message);}
}
function parseCSV(value){return [...new Set(value.split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(validTag))].slice(0,24);}
async function uploadMedia(files){
  if(!files.length)return [];
  if(!state.mediaBase)throw Error('No media peer configured. Connect or choose a voluntary media provider first.');
  if(files.length>3)throw Error('Maximum three images per test post');
  const uploaded=[];
  for(const file of files){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>256*1024)
      throw Error('Test upload supports JPEG/PNG/WebP files up to 256 KiB each.');
    const response=await fetch(state.mediaBase.replace(/\/$/,'')+'/upload',
      {method:'POST',headers:{'content-type':file.type},body:file});
    if(!response.ok)throw Error('Media peer refused upload ('+response.status+'). Try an independently operated peer.');
    const data=await response.json();
    if(typeof data.cid!=='string'||!/^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(data.cid))
      throw Error('Media peer returned invalid CID');
    uploaded.push(data.cid);
  }
  return uploaded;
}
async function compose(event){
  event.preventDefault();
  const buttonEl=$('submitPost'),error=$('composeError');
  error.hidden=true;buttonEl.disabled=true;
  try{
    const space=$('composeSpace').value.trim(),title=$('composeTitle').value.trim(),text=$('composeText').value.trim();
    if(!safeSpace(space))throw Error('Invalid namespace');
    const files=[...$('composeFiles').files];
    const tags=parseCSV($('composeTags').value);
    const schedule=$('composeStart').value?{start:$('composeStart').value,end:$('composeEnd').value,location:$('composeLocation').value.trim()}:null;
    const pollQuestion=$('composePollQuestion').value.trim();
    const options=$('composePollOptions').value.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,20);
    if(pollQuestion&&options.length<2)throw Error('Polls need at least two choices');
    const positions=$('composePositions').value.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,20);
    if(!title&&!text&&!files.length)throw Error('Provide a headline, text or image');
    const media=await uploadMedia(files);
    const fields={tags,presentation:$('composePresentation').value};
    if(schedule)fields.schedule=schedule;
    if(pollQuestion)fields.poll={question:pollQuestion,options};
    if(positions.length)fields.positions=positions;
    await publish('post',{title,text,fields,media},{space});
    state.space=space;$('spaceName').value=space;await store();
    $('postForm').reset();close('postDialog');render();
  }catch(err){
    error.textContent=err.message;error.hidden=false;
    toast('Posting failed: '+err.message);
  }finally{buttonEl.disabled=false;}
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
  state.showUnverified=await getItem(state.db,'classic-show-unknown')===true;
  state.view=await getItem(state.db,'classic-view')||'grid';
  state.showMedia=await getItem(state.db,'classic-show-media')===true;
  state.mediaBase=await getItem(state.db,'classic-media-url')||null;
  const hint=readSiteContext(location.href);
  state.space=hint.space||await getItem(state.db,'classic-space')||'commons';
  state.ownerHint=hint.preferredAuthor;
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
  $('viewStyle').value=state.view;
  $('peerURLs').value=state.peers.join('\n');
  $('mediaPeerUrl').value=state.mediaBase||'';
  makeDemo();
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
    onEvent:async e=>{
      await ingest(e); // new signed records schedule one redraw per frame
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
    onError:(url,message)=>{state.lastError=String(message);toast('Peer rejected/failed: '+message);}
  });
  render();
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
