// WEB9000 independent, signed content assessments; NO group-to-group
// decision challenges. The same target can have different, contradictory
// assessments from independently selected reviewers and groups.
//
// This layer is a local projection over already signature-verified events.
// It NEVER deletes records, declares laws, grants moderator privileges, or
// edits a group charter. Numeric policy is versioned and reader-revisable.

export const AGE_TIERS=Object.freeze([
  'All audiences',
  'PG / parental guidance',
  'Age 13+',
  'Age 18+',
  'Extreme / disturbing adult material',
  'Graphic gore / disturbing news imagery',
  'Potential legal concern (unverified allegation)'
]);
export const RATING_AXES=Object.freeze({
  controversy:'Controversy / censorship pressure',
  democraticUrgency:'Democratic urgency / public interest',
  intellectualImportance:'Intellectual importance',
  spamLikelihood:'Spam / low-value likelihood'
});
export const DEFAULT_RATING_RULES=Object.freeze({
  version:1,
  active:false,             // never silently start hiding content via a new rule
  minAgeTier:3,             // 18+ through advisory legal concern
  blurVotes:2,
  hideVotes:5,
  dissentVotes:2,           // trusted counterevidence blocks automatic restrictions
  sourceMode:'trusted',     // explicitly approved authors & ratified group reviewers
  ageOnText:false,         // ratings affect media presentation, not political discussion text
  showTextFirstWhenHighUrgency:true,
  textFirstUrgency:4,
  textFirstImportance:4,
  alertVotes:2
});
const cleanInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function normalizeRatingRules(raw){
  const d=DEFAULT_RATING_RULES;
  if(raw==null)return {...d};
  if(typeof raw!=='object'||Array.isArray(raw)||raw.version!==1)
    throw Error('Unsupported reader rating policy version');
  const p={...d,...raw};
  if(typeof p.active!=='boolean'||typeof p.ageOnText!=='boolean'||
    typeof p.showTextFirstWhenHighUrgency!=='boolean'||
    p.sourceMode!=='trusted'||
    !cleanInt(p.minAgeTier,0,6)||!cleanInt(p.blurVotes,1,100)||
    !cleanInt(p.hideVotes,p.blurVotes,100)||
    !cleanInt(p.dissentVotes,1,100)||
    !cleanInt(p.textFirstUrgency,0,5)||
    !cleanInt(p.textFirstImportance,0,5)||
    !cleanInt(p.alertVotes,1,100)||
    Object.keys(p).some(k=>!Object.hasOwn(d,k)))
    throw Error('Invalid reader rating threshold policy');
  return p;
}
const digest=id=>typeof id==='string'&&/^sha256:[a-f0-9]{64}$/.test(id);
export function validateRatingBody(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||!digest(body.target)||
    !cleanInt(body.age,0,6)||
    !body.axes||typeof body.axes!=='object'||Array.isArray(body.axes)||
    Object.keys(body.axes).length!==Object.keys(RATING_AXES).length||
    Object.keys(RATING_AXES).some(k=>!cleanInt(body.axes[k],0,5))||
    Object.keys(body.axes).some(k=>!Object.hasOwn(RATING_AXES,k))||
    (body.note!==undefined&&(typeof body.note!=='string'||body.note.length>500))||
    (body.publicInterestAlert!==undefined&&typeof body.publicInterestAlert!=='boolean')||
    (body.group!==undefined&&!digest(body.group))||
    Object.keys(body).some(k=>!['target','age','axes','note','group','publicInterestAlert'].includes(k)))
      throw Error('Invalid signed content rating (target, age 0-6, four axes 0-5)');
  return body;
}
// The index, bridge and local replica verify Ed25519 envelopes before this
// function is invoked. Tests also check all records with verifyEvent.
function recentByAuthor(events,target){
  const latest=new Map();
  for(const event of events){
    if(event?.payload?.kind!=='content-rating'||event.payload.body?.target!==target)continue;
    try{validateRatingBody(event.payload.body);}catch{continue;}
    const author=event.payload.author;
    if(typeof author!=='string')continue;
    const prior=latest.get(author);
    if(!prior||event.payload.time>prior.payload.time||
       (event.payload.time===prior.payload.time&&event.id>prior.id))
      latest.set(author,event);
  }
  return [...latest.values()].sort((a,b)=>a.payload.author.localeCompare(b.payload.author));
}
function median(nums){
  if(!nums.length)return null;
  const s=[...nums].sort((a,b)=>a-b);
  const m=(s.length-1)/2;
  return (s[Math.floor(m)]+s[Math.ceil(m)])/2;
}
/**
 * Descriptive spider background — NOT a trusted moderation verdict.
 *
 * Default: every independently signed rating OBSERVED by this reader from
 * OTHER authors. Latest valid event per author counts once. Explicit reader
 * trust is intentionally irrelevant to this visual-only discovery view.
 *
 * Future "extended federation" filtering can supply a set of independently
 * ratified trusted author keys using mode='approved-authors'. A claimed
 * body.group, first-claimer namespace or numerical popularity cannot become
 * a credential. Absence here proves nothing about network-wide completeness.
 */
export function summarizeSpiderBackground(signedEvents,target,{
  viewerAuthor=null,mode='all-signed',approvedAuthors=[]
}={}){
  if(!digest(target))throw Error('Invalid signed content target');
  if(!['all-signed','approved-authors'].includes(mode))
    throw Error('Unsupported spider background scope');
  const approved=new Set(approvedAuthors);
  const ratings=recentByAuthor(signedEvents,target)
    .filter(e=>e.payload.author!==viewerAuthor&&
      (mode==='all-signed'||approved.has(e.payload.author)));
  const age=median(ratings.map(e=>e.payload.body.age));
  const axes=Object.fromEntries(Object.keys(RATING_AXES).map(key=>[
    key,median(ratings.map(e=>e.payload.body.axes[key]))
  ]));
  return {scope:mode,count:ratings.length,age,axes,
    signerIds:ratings.map(e=>e.payload.author),
    informationalOnly:true};
}
/**
 * signedEvents: caller-supplied, previously verified signed records.
 * trustAuthors: reader-chosen public key list.
 * verifiedGroupReviewers: Map(groupId -> Set of signer IDs actually appointed
 *                       by independently derived RATIFIED group charter).
 * subscribedGroups: reader-chosen group IDs, never guessed from a post label.
 *
 * A signer only counts once per target. A claimed group field cannot confer
 * standing. Subjective opinion disagreement remains visible as distribution,
 * not an endorsement/counter-flag referencing another group's event.
 */
export function assessContentRatings(signedEvents,target,{
  rules=DEFAULT_RATING_RULES,
  trustAuthors=[],subscribedGroups=[],verifiedGroupReviewers=new Map(),
  selfAuthor=null,media=true
}={}){
  if(!digest(target))throw Error('Invalid signed content target');
  const policy=normalizeRatingRules(rules);
  const all=recentByAuthor(signedEvents,target);
  const trustedKeys=new Set([...trustAuthors,selfAuthor].filter(Boolean));
  const subscriptions=new Set(subscribedGroups);
  const verified=[];
  for(const event of all){
    const b=event.payload.body,author=event.payload.author;
    const group=b.group;
    const approvedGroup=group&&subscriptions.has(group)&&
      verifiedGroupReviewers.get(group)?.has(author);
    if(trustedKeys.has(author)||approvedGroup)verified.push(event);
  }
  const ages=Array.from({length:7},()=>0);
  // The special democratic/public-interest flag is a signed label inside
  // ⚑ Report, never an implied 0/6 age rating or default-zero spider score.
  // Keep legacy rating.publicInterestAlert for older signed events.
  const alertTag='public-interest-censorship-pressure';
  const latestAlertByAuthor=new Map();
  for(const e of signedEvents){
    if(e?.payload?.kind!=='label'||e.payload.body?.target!==target||
       e.payload.body?.tag!==alertTag||typeof e.payload.author!=='string')continue;
    const author=e.payload.author,old=latestAlertByAuthor.get(author);
    if(!old||e.payload.time>old.payload.time||
      (e.payload.time===old.payload.time&&e.id>old.id))
      latestAlertByAuthor.set(author,e);
  }
  const alertAuthors=new Set(verified.filter(e=>e.payload.body.publicInterestAlert===true)
    .map(e=>e.payload.author));
  for(const e of latestAlertByAuthor.values()){
    const author=e.payload.author;
    const groupId=e.payload.body.group;
    if(trustedKeys.has(author)||
      (groupId&&subscriptions.has(groupId)&&verifiedGroupReviewers.get(groupId)?.has(author)))
      alertAuthors.add(author);
  }
  const publicInterestAlerts=alertAuthors.size;
  const groupCounts=Object.create(null),groupBuckets=new Map(),axisValues={};
  for(const key of Object.keys(RATING_AXES))axisValues[key]=[];
  for(const e of verified){
    const b=e.payload.body;
    ages[b.age]++;
    for(const key of Object.keys(RATING_AXES))axisValues[key].push(b.axes[key]);
    // Group reputation is based on independent ratings of the same target,
    // not on voting to invalidate another reviewer's decision.
    if(b.group&&subscriptions.has(b.group)&&verifiedGroupReviewers.get(b.group)?.has(e.payload.author)){
      groupCounts[b.group]=(groupCounts[b.group]||0)+1;
      if(!groupBuckets.has(b.group))groupBuckets.set(b.group,{ages:[],
        axes:Object.fromEntries(Object.keys(RATING_AXES).map(key=>[key,[]]))});
      const bucket=groupBuckets.get(b.group);
      bucket.ages.push(b.age);
      for(const key of Object.keys(RATING_AXES))bucket.axes[key].push(b.axes[key]);
    }
  }
  const cut=policy.minAgeTier;
  const high=verified.filter(e=>e.payload.body.age>=cut);
  const low=verified.filter(e=>e.payload.body.age<cut);
  // User's 10 high vs 2 credible low example: material disagreement should
  // not auto-hide/blindside readers. The exact numbers are local and versioned,
  // NOT claimed scientific calibration or an authoritative safety verdict.
  const disputed=high.length>0&&low.length>=policy.dissentVotes;
  const action=!policy.active||disputed||(!media&&!policy.ageOnText)?
    'clear':high.length>=policy.hideVotes?'hide':
      high.length>=policy.blurVotes?'blur':'clear';
  const axisMedian=Object.fromEntries(
    Object.entries(axisValues).map(([k,values])=>[k,median(values)]));
  const groupComparisons=Object.fromEntries([...groupBuckets.entries()].map(([id,bucket])=>
    [id,{count:bucket.ages.length,ageMedian:median(bucket.ages),
      axes:Object.fromEntries(Object.entries(bucket.axes).map(([key,values])=>
        [key,median(values)]))}]));
  // A single self-described urgent meme must not receive public-interest
  // promotion. Even qualified alerts are only an advisory display hint.
  const textFirst=policy.showTextFirstWhenHighUrgency&&
    publicInterestAlerts>=policy.alertVotes&&(
    (axisMedian.democraticUrgency??0)>=policy.textFirstUrgency||
    (axisMedian.intellectualImportance??0)>=policy.textFirstImportance);
  return {
    action,disputed,allSignedCount:all.length,qualifiedCount:verified.length,
    untrustedCount:all.length-verified.length,ages,high:high.length,low:low.length,
    axes:axisMedian,groupCounts,groupComparisons,
    latest:all,qualified:verified,publicInterestAlerts,
    textFirst,
    note:policy.active?disputed?'Conflicting recognized age opinions: no automatic age restriction':
      'Reader-selected thresholds applied locally':
      'Advisory ratings only: automatic age filtering not enabled'
  };
}
