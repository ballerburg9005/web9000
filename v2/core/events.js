// WEB9000/2 portable signed events. No transport, server, namespace owner or gatekeeper.
export const DOMAIN = 'WEB9000/event/v1';
const utf8 = new TextEncoder();
const kinds = new Set(['post','reply','label','endorse','group','policy','membership','invitation','retraction','proposal','vote','accept','reaction','tag-vote','poll-choice','profile','media-provider']);
const toB64 = a => typeof Buffer !== 'undefined' ? Buffer.from(a).toString('base64url') : btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64 = s => {
  if (typeof s !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s)) throw Error('Invalid encoding');
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(s,'base64url'));
  const raw = atob(s.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
export function canonical(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  throw Error('Unsupported JSON value');
}
const sha = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(data))), b => b.toString(16).padStart(2,'0')).join('');
export function validatePayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.version !== 1 || !kinds.has(p.kind)) throw Error('Unsupported event');
  if (typeof p.author !== 'string' || !/^ed25519:[a-zA-Z0-9_-]{43}$/.test(p.author)) throw Error('Bad author');
  if (typeof p.space !== 'string' || p.space.length < 1 || p.space.length > 180 || /[\x00-\x1f]/.test(p.space)) throw Error('Bad space');
  if (!Number.isSafeInteger(p.time) || p.time < 0 || p.time > 8640000000000000) throw Error('Bad timestamp');
  if (typeof p.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(p.nonce)) throw Error('Bad nonce');
  if (!p.body || typeof p.body !== 'object' || Array.isArray(p.body)) throw Error('Bad body');
  const data = canonical(p);
  if (utf8.encode(data).byteLength > 32768) throw Error('Event too large: media must be content-addressed');
  if (p.kind === 'post' || p.kind === 'reply') {
    if (typeof p.body.title !== 'string' || p.body.title.length > 160 || typeof p.body.text !== 'string' || p.body.text.length > 16000) throw Error('Invalid post');
    if (p.kind === 'reply' && !/^sha256:[0-9a-f]{64}$/.test(p.body.parent || '')) throw Error('Bad parent');
    if (p.body.media !== undefined && (!Array.isArray(p.body.media) || p.body.media.length > 12 || p.body.media.some(m => typeof m !== 'string' || !/^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(m)))) throw Error('Media must be IPFS CIDs');
    // body.fields is an arbitrary JSON object: market listings, event dates, job positions etc.
    if (p.body.fields !== undefined && (!p.body.fields || typeof p.body.fields !== 'object' || Array.isArray(p.body.fields))) throw Error('Invalid custom fields');
    // Ordered MIME metadata describes the matching CID entries. It does not
    // embed binary bytes or grant media-host authority to a post author.
    const mime=p.body.fields?.mediaTypes;
    if(mime!==undefined&&(!Array.isArray(mime)||mime.length!==(p.body.media||[]).length||
      mime.some(type=>!['image/jpeg','image/png','image/webp','audio/mpeg',
        'audio/ogg','audio/wav','video/mp4','video/webm'].includes(type))))
      throw Error('Invalid ordered media MIME metadata');
    const primary=p.body.fields?.primaryMediaIndex;
    if(primary!==undefined&&(!Number.isInteger(primary)||primary<0||
      primary>=(p.body.media||[]).length))throw Error('Invalid primary media selection');

    // A correction is a NEW signed post referring to a previous immutable
    // publication. No event mutates, overwrites or deletes the previous one.
    if (p.kind === 'post' && p.body.fields?.revises !== undefined &&
      (typeof p.body.fields.revises !== 'string' ||
       !/^sha256:[0-9a-f]{64}$/.test(p.body.fields.revises)))
      throw Error('Invalid signed revision target');
  }
  if(p.kind==='retraction'){
    // Signed non-deletion withdrawal of a *post*; the author and exact
    // target are checked against immutable records at projection time.
    const b=p.body;
    if(typeof b.target!=='string'||!/^sha256:[0-9a-f]{64}$/.test(b.target)||
       !['withdraw','restore'].includes(b.action)||
       (b.reason!==undefined&&(typeof b.reason!=='string'||b.reason.length>500)))
      throw Error('Invalid signed withdrawal/restore');
  }
  if(p.kind==='media-provider'){
    // An independently signed, revocable CID availability CLAIM, not proof
    // of storage, a mirror permission, or a browser download instruction.
    const b=p.body;
    const allowedURL=typeof b.gateway==='string'&&b.gateway.length<=512&&
      /^https?:\/\/[^\s?#]+\/?$/.test(b.gateway);
    if(!allowedURL || !['offer','withdraw'].includes(b.action) ||
       !Array.isArray(b.cids)||b.cids.length<1||b.cids.length>32||
       b.cids.some(cid=>typeof cid!=='string'||!/^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(cid)) ||
       new Set(b.cids).size!==b.cids.length ||
       !Number.isSafeInteger(b.expiresAt)||b.expiresAt<p.time||
       b.expiresAt>p.time+7*86400000)
      throw Error('Invalid media-provider availability claim');
  }
  if(p.kind==='profile'){
    const b=p.body;
    if(typeof b.name!=='string'||b.name.length>80 ||
       typeof b.description!=='string'||b.description.length>2000 ||
       (b.website!==undefined&&(typeof b.website!=='string'||b.website.length>400)))
      throw Error('Invalid signed profile metadata');
  }
  if (p.kind === 'reaction' && (!/^sha256:[0-9a-f]{64}$/.test(p.body.target||'') ||
      ![-2,-1,1,2].includes(p.body.value))) throw Error('Invalid reaction');
  if (p.kind === 'tag-vote' && (!/^sha256:[0-9a-f]{64}$/.test(p.body.target||'') ||
      typeof p.body.tag!=='string' || !/^[a-z0-9][a-z0-9._:-]{0,47}$/.test(p.body.tag) ||
      ![-1,1].includes(p.body.value))) throw Error('Invalid tag vote');
  if (p.kind === 'poll-choice' && (!/^sha256:[0-9a-f]{64}$/.test(p.body.target||'') ||
      !Number.isInteger(p.body.option) || p.body.option<0 || p.body.option>31)) throw Error('Invalid poll choice');
  if (p.kind === 'label') {
    if (!(/^sha256:[0-9a-f]{64}$/.test(p.body.target || '') || /^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(p.body.target || '')) ||
        typeof p.body.tag !== 'string' || !/^[a-z0-9._:/-]{1,100}$/.test(p.body.tag) ||
        typeof p.body.reason !== 'string' || p.body.reason.length > 500) throw Error('Invalid moderation label');
  }
  // Governance identifiers reference immutable signed events, not claimable names.
  const digest = x => typeof x === 'string' && /^sha256:[0-9a-f]{64}$/.test(x);
  const identity = x => typeof x === 'string' && /^ed25519:[a-zA-Z0-9_-]{43}$/.test(x);
  if (p.kind === 'membership' && (!digest(p.body.group) || !['request','withdraw'].includes(p.body.action)))
    throw Error('Invalid signed group membership request');
  if (p.kind === 'group') {
    const q=p.body.quorum;
    if(p.body.recommendedSpaces!==undefined &&
      (!Array.isArray(p.body.recommendedSpaces)||p.body.recommendedSpaces.length>20||
        p.body.recommendedSpaces.some(space=>typeof space!=='string'||space.length<1||
          space.length>180||/[\x00-\x1f]/.test(space))))
      throw Error('Invalid group space recommendations');
    if(p.body.decisionPolicy!==undefined&&(
      !p.body.decisionPolicy||typeof p.body.decisionPolicy!=='object'||
      Array.isArray(p.body.decisionPolicy)||
      p.body.decisionPolicy.mode!=='timed-v1'||
      Object.keys(p.body.decisionPolicy).some(key=>key!=='mode')
    ))throw Error('Invalid versioned group decision policy');
    if (typeof p.body.name !== 'string' || !p.body.name.trim() || p.body.name.length > 80 ||
        !q || !Number.isInteger(q.numerator) || !Number.isInteger(q.denominator) ||
        q.denominator < 1 || q.denominator > 100 || q.numerator < 1 || q.numerator > q.denominator) throw Error('Invalid group charter');
  }
  if (p.kind === 'proposal') {
    const b=p.body,c=b.change;
    if (!digest(b.group) || !digest(b.parent) || !c || typeof c !== 'object' || Array.isArray(c) ||
      !['add-member','remove-member','set-quorum','appoint-reviewer','remove-reviewer','delegate','undelegate','set-label-rules','set-group-info','resolution','set-decision-policy'].includes(c.type)) throw Error('Invalid governance proposal');
    if (['add-member','remove-member','appoint-reviewer','remove-reviewer'].includes(c.type) && !identity(c.author)) throw Error('Invalid member/reviewer identity');
    if (c.type==='appoint-reviewer' && (!Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100)) throw Error('Invalid reviewer weight');
    if (['delegate','undelegate'].includes(c.type) && (!digest(c.group) || c.group===b.group)) throw Error('Invalid delegation');
    if (c.type==='set-quorum' && (!Number.isInteger(c.numerator) || !Number.isInteger(c.denominator) || c.numerator < 1 || c.denominator > 100 || c.numerator > c.denominator)) throw Error('Invalid quorum');
    if (c.type==='set-label-rules' && (!Array.isArray(c.hideTags) || c.hideTags.length > 64 || c.hideTags.some(t=>typeof t!=='string' || !/^[a-z0-9._:/-]{1,100}$/.test(t)))) throw Error('Invalid label rules');
    if (c.type==='resolution' && (
      typeof c.title!=='string'||!c.title.trim()||c.title.length>160||
      typeof c.text!=='string'||c.text.length>2000
    ))throw Error('Invalid ordinary group resolution');
    if (c.type==='set-decision-policy' && (
      c.mode!=='timed-v1'||Object.keys(c).some(key=>!['type','mode'].includes(key))
    ))throw Error('Invalid group decision policy transition');
    if (c.type==='set-group-info' && (
      typeof c.name!=='string'||!c.name.trim()||c.name.length>80||
      typeof c.description!=='string'||c.description.length>2000||
      !Array.isArray(c.recommendedSpaces)||c.recommendedSpaces.length>20||
      c.recommendedSpaces.some(space=>typeof space!=='string'||space.length<1||
        space.length>180||/[\x00-\x1f]/.test(space))||
      new Set(c.recommendedSpaces).size!==c.recommendedSpaces.length
    )) throw Error('Invalid group information amendment');
  }
  if (p.kind==='vote' && (!digest(p.body.proposal) || !['approve','reject'].includes(p.body.choice))) throw Error('Invalid governance vote');
  if (p.kind==='invitation' && (!identity(p.body.invitee) || typeof p.body.scope!=='string' || !p.body.scope || p.body.scope.length > 180 ||
      (p.body.expiresAt!==undefined && (!Number.isSafeInteger(p.body.expiresAt) || p.body.expiresAt < p.time)))) throw Error('Invalid invitation');
  if (p.kind==='accept' && !digest(p.body.invitation)) throw Error('Invalid invitation acceptance');
  if (p.kind === 'endorse' && (typeof p.body.subject !== 'string' || !/^ed25519:[a-zA-Z0-9_-]{43}$/.test(p.body.subject) || !['trust','distrust'].includes(p.body.action))) throw Error('Invalid endorsement');
  return p;
}
export async function generateIdentity({extractable=false}={}) {
  const keys = await crypto.subtle.generateKey('Ed25519', extractable, ['sign','verify']);
  const raw = await crypto.subtle.exportKey('raw', keys.publicKey);
  return {author: 'ed25519:' + toB64(new Uint8Array(raw)), privateKey: keys.privateKey, publicKey: keys.publicKey};
}
export async function signEvent(identity, {kind='post',space='commons',body,time=Date.now()}) {
  const random = new Uint8Array(16); crypto.getRandomValues(random);
  const nonce = Array.from(random,b=>b.toString(16).padStart(2,'0')).join('');
  const payload = {version:1,kind,space,body,time,nonce,author:identity.author};
  validatePayload(payload);
  const id = 'sha256:' + await sha(canonical(payload));
  const signature = toB64(new Uint8Array(await crypto.subtle.sign('Ed25519',identity.privateKey,utf8.encode(DOMAIN+'\n'+id))));
  return {id,payload,signature};
}
export async function verifyEvent(event) {
  try {
    if (!event || typeof event.id !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(event.id)) return false;
    validatePayload(event.payload);
    if (event.id !== 'sha256:' + await sha(canonical(event.payload))) return false;
    const pub = fromB64(event.payload.author.slice(8)), sig = fromB64(event.signature);
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = await crypto.subtle.importKey('raw',pub,'Ed25519',false,['verify']);
    return crypto.subtle.verify('Ed25519',key,sig,utf8.encode(DOMAIN+'\n'+event.id));
  } catch { return false; }
}
export const shortAuthor = author => author ? author.slice(0,18)+'…'+author.slice(-5) : 'unknown';