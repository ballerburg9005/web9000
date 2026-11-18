// WEB9000/2 portable signed events. No transport, server, namespace owner or gatekeeper.
export const DOMAIN = 'WEB9000/event/v1';
const utf8 = new TextEncoder();
const kinds = new Set(['post','reply','label','endorse','group','policy','membership','invitation','retraction','proposal','vote']);
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
  }
  if (p.kind === 'label') {
    if (!/^sha256:[0-9a-f]{64}$/.test(p.body.target || '') ||
        typeof p.body.tag !== 'string' || !/^[a-z0-9._:/-]{1,100}$/.test(p.body.tag) ||
        typeof p.body.reason !== 'string' || p.body.reason.length > 500) throw Error('Invalid moderation label');
  }
  // Governance identifiers reference immutable signed events, not claimable names.
  const digest = x => typeof x === 'string' && /^sha256:[0-9a-f]{64}$/.test(x);
  const identity = x => typeof x === 'string' && /^ed25519:[a-zA-Z0-9_-]{43}$/.test(x);
  if (p.kind === 'group') {
    const q=p.body.quorum;
    if (typeof p.body.name !== 'string' || !p.body.name.trim() || p.body.name.length > 80 ||
        !q || !Number.isInteger(q.numerator) || !Number.isInteger(q.denominator) ||
        q.denominator < 1 || q.denominator > 100 || q.numerator < 1 || q.numerator > q.denominator) throw Error('Invalid group charter');
  }
  if (p.kind === 'proposal') {
    const b=p.body,c=b.change;
    if (!digest(b.group) || !digest(b.parent) || !c || typeof c !== 'object' || Array.isArray(c) ||
      !['add-member','remove-member','set-quorum','appoint-reviewer','remove-reviewer','delegate','undelegate','set-label-rules'].includes(c.type)) throw Error('Invalid governance proposal');
    if (['add-member','remove-member','appoint-reviewer','remove-reviewer'].includes(c.type) && !identity(c.author)) throw Error('Invalid member/reviewer identity');
    if (c.type==='appoint-reviewer' && (!Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100)) throw Error('Invalid reviewer weight');
    if (['delegate','undelegate'].includes(c.type) && (!digest(c.group) || c.group===b.group)) throw Error('Invalid delegation');
    if (c.type==='set-quorum' && (!Number.isInteger(c.numerator) || !Number.isInteger(c.denominator) || c.numerator < 1 || c.denominator > 100 || c.numerator > c.denominator)) throw Error('Invalid quorum');
    if (c.type==='set-label-rules' && (!Array.isArray(c.hideTags) || c.hideTags.length > 64 || c.hideTags.some(t=>typeof t!=='string' || !/^[a-z0-9._:/-]{1,100}$/.test(t)))) throw Error('Invalid label rules');
  }
  if (p.kind==='vote' && (!digest(p.body.proposal) || !['approve','reject'].includes(p.body.choice))) throw Error('Invalid governance vote');
  if (p.kind==='invitation' && (!identity(p.body.invitee) || typeof p.body.scope!=='string' || !p.body.scope || p.body.scope.length > 180 ||
      (p.body.expiresAt!==undefined && (!Number.isSafeInteger(p.body.expiresAt) || p.body.expiresAt < p.time)))) throw Error('Invalid invitation');
  if (p.kind === 'endorse' && (typeof p.body.subject !== 'string' || !/^ed25519:[a-zA-Z0-9_-]{43}$/.test(p.body.subject) || !['trust','distrust'].includes(p.body.action))) throw Error('Invalid endorsement');
  return p;
}
export async function generateIdentity() {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign','verify']);
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
