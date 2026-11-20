// No framework/bundler required. Direct browser WebSocket transport to any
// user-selected, replaceable OrbitDB peer. Every incoming record is verified
// before it reaches the caller's local replica. Nodes never sign on behalf of us.
import {verifyEvent} from '../core/events.js';
import {verifySourceReceipt} from './source-receipt.js';
import {verifySourceFeed} from './source-feed.js';
import {verifySourceFeedManifest,verifySourceFeedChunk,assembleSourceFeedBundle} from './source-feed-bundle.js';
const ID=/^sha256:[0-9a-f]{64}$/;
const allowedSpace=s=>typeof s==='string'&&s.length>0&&s.length<=180&&!/[\x00-\x1f]/.test(s);
// Transport subscriptions are independent of followed-space UI filters.
// '*' means all published namespaces. Never silently infer a permission
// or deletion from a user's limited synchronization choice.
export function normalizeSyncSpaces(value){
  if(!Array.isArray(value)||!value.length||value.length>64 ||
     value.some(s=>s!=='*'&&!allowedSpace(s)))throw Error('Invalid namespace subscription');
  const unique=[...new Set(value)];
  return unique.includes('*')?['*']:unique;
}
export function parseSyncSpaces(value){
  if(typeof value!=='string'||value.length>12000)
    throw Error('Invalid namespace subscription text');
  // Newlines are the ONLY separator: comma, semicolon and spaces may be
  // legitimate characters in a namespace, so every valid name is selectable.
  const fields=value.split(/\n/).map(x=>x.trim()).filter(Boolean);
  return normalizeSyncSpaces(fields.length?fields:['*']);
}

export function normalizePeerUrl(input,{securePage=false}={}){
  if(typeof input!=='string'||input.length>2048)throw Error('Invalid peer address');
  let u;
  try{u=new URL(input.trim());}catch{throw Error('Expected ws:// or wss:// peer URL');}
  if(!['ws:','wss:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash)
    throw Error('Expected a valid unauthenticated WebSocket peer URL');
  if(securePage&&u.protocol==='ws:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))
    throw Error('Use wss:// for HTTPS-hosted sites');
  return u.href;
}
export function parsePeerUrls(text,securePage=false){
  const items=String(text||'').split(/[\s,]+/).filter(Boolean);
  if(items.length>8)throw Error('Maximum 8 browser peers');
  return [...new Set(items.map(s=>normalizePeerUrl(s,{securePage})))];
}
export function parseSourcePins(text,{securePage=false}={}){
 if(typeof text!=='string'||text.length>18000)throw Error('Invalid observer pin list');
 const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(rows.length>8)throw Error('Maximum eight pinned source observers');
 const pins={};
 for(const row of rows){
  const parts=row.split(/\s+/);
  if(parts.length!==2||!/^ed25519:[A-Za-z0-9_-]{43}$/.test(parts[1]))
   throw Error('Source observer pin requires a WebSocket URL and signing key');
  const url=normalizePeerUrl(parts[0],{securePage});
  if(pins[url]&&pins[url]!==parts[1])
   throw Error('Conflicting pinned source observer');
  pins[url]=parts[1];
 }
 return pins;
}
const MAX_PENDING_PACKETS=16,MAX_PENDING_BYTES=2*1024*1024;
const MAX_VERIFICATIONS_PER_MINUTE=480;
const RESOURCE_BUDGETS=Object.freeze({unknown:96,general:360,concentrated:48});
export class BrowserPeerMesh{
  #connections=new Map();
  #generation=0;
  constructor({WebSocketImpl=globalThis.WebSocket,onEvent=async()=>{},onAck=()=>{},onStatus=()=>{},onError=()=>{},
      onSource=()=>{},onSourceFeed=()=>{},getPending=()=>[],securePage=false,onPacket=()=>{},
      now=()=>Date.now()}={}){
    if(!WebSocketImpl)throw Error('WebSocket implementation missing');
    this.WS=WebSocketImpl;
    this.onEvent=onEvent;this.onAck=onAck;this.onStatus=onStatus;this.onError=onError;
    this.getPending=getPending;this.securePage=securePage;this.onPacket=onPacket;
    this.onSource=onSource;this.onSourceFeed=onSourceFeed;this.now=now;
    this.scopes=['*'];this.urls=[];this.syncedCount=0;this.sourcePins={};
  }
  get connected(){return [...this.#connections.values()].filter(s=>s.ws.readyState===this.WS.OPEN).length;}
  #status(){this.onStatus({connected:this.connected,total:this.urls.length,synced:this.syncedCount});}
  #trace(direction,url,payload){
    // An optional passive inspection callback. Never let debugging alter
    // publication, verification or peer-reconnect behavior.
    try{this.onPacket({direction,url,payload});}catch{}
  }
  #send(ws,url,packet){
    const raw=JSON.stringify(packet);
    this.#trace('out',url,raw);
    ws.send(raw);
  }
  connect(urls,{spaces=['*'],sourcePins={},sourceCheckpoints={}}={}){
    if(!Array.isArray(urls)||urls.length>8)throw Error('Invalid peer configuration');
    const scopes=normalizeSyncSpaces(spaces);
    const sanitized=[...new Set(urls.map(u=>normalizePeerUrl(u,{securePage:this.securePage})))];
    if(!sourcePins||typeof sourcePins!=='object'||Array.isArray(sourcePins)||
       Object.keys(sourcePins).length>8)throw Error('Invalid source observer pin map');
    for(const [url,author] of Object.entries(sourcePins)){
      if(!sanitized.includes(normalizePeerUrl(url,{securePage:this.securePage}))||
         !/^ed25519:[A-Za-z0-9_-]{43}$/.test(author))
        throw Error('Source observer must be pinned to an explicitly selected peer');
    }
    this.disconnect();
    this.urls=sanitized;this.scopes=scopes;this.sourcePins={...sourcePins};
    this.sourceCheckpoints={};
    if(sourceCheckpoints&&typeof sourceCheckpoints==='object'&&!Array.isArray(sourceCheckpoints)){
      for(const [url,checkpoint] of Object.entries(sourceCheckpoints)){
        if(!sanitized.includes(url)||!sourcePins[url])continue;
        if(!Number.isSafeInteger(checkpoint?.revision)||checkpoint.revision<1||
          !/^[0-9a-f]{64}$/.test(checkpoint.digest||''))continue;
        this.sourceCheckpoints[url]={revision:checkpoint.revision,digest:checkpoint.digest};
      }
    }
    const generation=this.#generation;
    for(const url of sanitized)this.#open(url,generation,0);
    this.#status();
  }
  disconnect(){
    this.#generation++;
    for(const s of this.#connections.values()){
      if(s.timer)clearTimeout(s.timer);
      if(s.resumeTimer)clearTimeout(s.resumeTimer);
      if(s.initialSyncTimer)clearTimeout(s.initialSyncTimer);
      s.ws.onopen=s.ws.onmessage=s.ws.onerror=s.ws.onclose=null;
      s.ws.close();
    }
    this.#connections.clear();this.urls=[];this.syncedCount=0;this.#status();
  }
  #open(url,generation,attempt){
    if(generation!==this.#generation)return;
    let ws;
    try{ws=new this.WS(url);}catch(error){this.onError(url,error.message);return;}
    const s={ws,timer:null,chain:Promise.resolve(),pages:0,lastCursor:null,
      queued:0,queuedBytes:0,minute:-1,verifiedCount:0,
      deferred:null,resumeTimer:null,feedPending:null,
      initialSyncStarted:false,initialSyncTimer:null,
      laneCounts:new Map(),receiptIssuer:null,
      feedRevision:this.sourceCheckpoints[url]?.revision||0,
      feedDigest:this.sourceCheckpoints[url]?.digest||null,
      feedValidated:false};
    this.#connections.set(url,s);
    const initialSync=()=>{
      if(s.initialSyncStarted||generation!==this.#generation||
         ws.readyState!==this.WS.OPEN)return;
      s.initialSyncStarted=true;
      if(s.initialSyncTimer)clearTimeout(s.initialSyncTimer);
      s.initialSyncTimer=null;
      this.#send(ws,url,{type:'sync',cursor:null,limit:32});
    };
    const processBatch=async msg=>{
      if(!Array.isArray(msg.events)||msg.events.length>32||
         msg.sourceReceipts!==undefined&&
         (!Array.isArray(msg.sourceReceipts)||
          msg.sourceReceipts.length!==msg.events.length))return;
      for(let i=0;i<msg.events.length;i++){
        if(!await this.#accept(msg.events[i],url,
          msg.sourceReceipts?.[i]??null,s)){
          // Defer at most ONE bounded page. Do not silently skip history
          // when an unverified geographic box is exhausted.
          s.deferred={...msg,events:msg.events.slice(i),
            ...(msg.sourceReceipts?{
              sourceReceipts:msg.sourceReceipts.slice(i)}:{})};
          const delay=Math.max(1000,
            (Math.floor(this.now()/60000)+1)*60000+100-this.now());
          if(s.resumeTimer)clearTimeout(s.resumeTimer);
          s.resumeTimer=setTimeout(()=>{
            s.resumeTimer=null;
            const page=s.deferred;s.deferred=null;
            if(page&&generation===this.#generation&&
               ws.readyState===this.WS.OPEN)
              s.chain=s.chain.then(()=>processBatch(page))
                .catch(err=>this.onError(url,String(err)));
          },Math.min(delay,61000));
          this.#trace('source-deferred',url,'History will resume at next resource window');
          return;
        }
      }
      s.deferred=null;
      if(typeof msg.next==='string'&&ID.test(msg.next)&&
         msg.next!==s.lastCursor&&s.pages<1000){
        s.pages++;s.lastCursor=msg.next;
        this.#send(ws,url,{type:'sync',cursor:msg.next,limit:32});
      }
    };
    ws.onopen=()=>{if(generation!==this.#generation)return;
      this.#trace('status',url,'WebSocket open');
      this.#status();
      // Subscribe all namespaces by default. Per-scope replication is optional.
      this.#send(ws,url,{type:'subscribe',spaces:this.scopes});
      // If the reader pinned a source observer, fetch its complete signed
      // CIDR manifest BEFORE walking potentially thousands of historical
      // pages. Otherwise both requests compete for a server's bounded
      // per-socket message budget. Legacy/nonparticipating peers fall back
      // to unknown-source synchronization after a short bounded delay.
      if(this.sourcePins[url]){
        s.initialSyncTimer=setTimeout(initialSync,5000);
      }else initialSync();
      for(const event of this.getPending())this.publish(event,[url]);
    };
    ws.onmessage=e=>{
      // Harden the receive queue BEFORE parsing or cryptographic checks.
      // Unbounded WS event callbacks used to accumulate arbitrary promises.
      const length=typeof e.data==='string'?e.data.length:MAX_PENDING_BYTES+1;
      if(length>MAX_PENDING_BYTES||s.queued>=MAX_PENDING_PACKETS||
        s.queuedBytes+length>MAX_PENDING_BYTES){
        this.onError(url,'untrusted peer exceeded bounded receive queue');
        ws.close(1008,'Browser receive capacity');return;
      }
      s.queued++;s.queuedBytes+=length;
      s.chain=s.chain.then(async()=>{
        if(generation!==this.#generation)return;
        let msg;
        try{
          if(typeof e.data!=='string'||e.data.length>2*1024*1024){
            this.#trace('error',url,'Rejected oversize or nontext WebSocket frame');return;
          }
          this.#trace('in',url,e.data);
          msg=JSON.parse(e.data);
        }
        catch{return;}
        if(msg.type==='hello'){
          if(this.sourcePins[url]&&
             msg.sourceObserver!==this.sourcePins[url]){
            this.onError(url,'pinned observer does not match selected peer');
            ws.close(1008,'Source observer mismatch');
            return;
          }
          s.receiptIssuer=typeof msg.sourceObserver==='string'?
            msg.sourceObserver:null;
        }else if(msg.type==='source-feed'){
          // Only the reader's separately pinned peer key may update a
          // source list. Unknown signers cannot smuggle geography rules.
          const expectedIssuer=this.sourcePins[url];
          if(expectedIssuer){
            const feed=await verifySourceFeed(msg.document,{
              expectedIssuer,minimumRevision:s.feedRevision||1,
              now:this.now()
            });
            if(feed.valid){
              if(feed.revision===s.feedRevision&&s.feedDigest&&
                feed.digest!==s.feedDigest){
                this.onError(url,'source feed fork at pinned revision');
              }else{
                s.feedRevision=feed.revision;s.feedDigest=feed.digest;
                s.feedValidated=true;
                this.sourceCheckpoints[url]={revision:feed.revision,digest:feed.digest};
                this.onSourceFeed(feed,url);
                initialSync();
              }
            }else this.onError(url,'unverified or stale source-feed update');
          }
        }else if(msg.type==='source-feed-manifest'){
          const expectedIssuer=this.sourcePins[url];
          if(expectedIssuer){
            const manifest=await verifySourceFeedManifest(msg.manifest,{
              expectedIssuer,minimumRevision:s.feedRevision||1,now:this.now()
            });
            if(!manifest.valid){
              this.onError(url,'unverified or stale source manifest');
            }else if(manifest.revision===s.feedRevision&&s.feedDigest&&
                     manifest.digest!==s.feedDigest){
              this.onError(url,'signed source manifest fork at pinned revision');
            }else if(!(s.feedValidated&&manifest.digest===s.feedDigest)){
              // Only a verified, independently pinned manifest can make the
              // browser request additional data. Each chunk is requested
              // AFTER the previous one verifies, never sent unsolicited.
              s.feedPending={manifest,index:0,checked:[]};
              // 64 sequential chunks may require considerable latency on
              // a slow mobile connection. A valid signed manifest extends
              // the fallback without allowing an unverified peer to keep
              // historical sync indefinitely suspended.
              if(s.initialSyncTimer)clearTimeout(s.initialSyncTimer);
              s.initialSyncTimer=setTimeout(initialSync,120000);
              this.#send(ws,url,{type:'source-feed-chunk',
                revision:manifest.revision,index:0});
            }
          }
        }else if(msg.type==='source-feed-chunk'){
          const pending=s.feedPending;
          if(pending&&msg.revision===pending.manifest.revision&&
             msg.index===pending.index){
            const verified=await verifySourceFeedChunk(msg.document,{
              manifest:pending.manifest,index:pending.index,now:this.now()
            });
            if(!verified.valid){
              s.feedPending=null;
              this.onError(url,'source chunk failed manifest verification');
            }else{
              pending.checked.push(verified);pending.index++;
              if(pending.index<pending.manifest.chunks.length){
                this.#send(ws,url,{type:'source-feed-chunk',
                  revision:pending.manifest.revision,index:pending.index});
              }else{
                s.feedPending=null;
                let assembled;
                try{
                  assembled=assembleSourceFeedBundle(pending.manifest,pending.checked);
                }catch{
                  this.onError(url,'signed source chunks conflict or are incomplete');
                  return;
                }
                // Commit the new local feed checkpoint ONLY when all
                // chunks match the same signed operator manifest.
                s.feedRevision=assembled.revision;s.feedDigest=assembled.digest;
                s.feedValidated=true;
                this.sourceCheckpoints[url]={revision:assembled.revision,
                  digest:assembled.digest};
                this.onSourceFeed(assembled,url);
                initialSync();
              }
            }
          }
        }else if(msg.type==='batch'){
          if(!s.deferred)await processBatch(msg);
        }else if(msg.type==='event'){
          await this.#accept(msg.event,url,msg.sourceReceipt??null,s);
        }else if(msg.type==='source-receipt'){
          // Only a signed observation of a LOCAL inlet is usable. The
          // original signed event may already be in the replica, but this
          // signal never changes record validity or grants publication rights.
          const issuer=this.sourcePins[url];
          if(issuer&&msg.receipt&&s.feedValidated){
            const observed=await verifySourceReceipt(msg.receipt,{
              expectedIssuer:issuer,eventId:msg.eventId,now:this.now()});
            if(observed.valid&&observed.feedDigest===s.feedDigest)
              this.onSource(observed,url);
          }
        }else if(msg.type==='ack'){
          if(ID.test(msg.id))this.onAck(msg.id,url);
        }else if(msg.type==='error'||msg.type==='reject'){
          this.onError(url,msg.error||msg.reason||'peer rejected a message');
        }
      }).catch(err=>this.onError(url,String(err))).finally(()=>{
        s.queued--;s.queuedBytes-=length;
      });
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{this.#trace('status',url,'WebSocket closed');if(generation!==this.#generation)return;
      if(this.#connections.get(url)!==s)return;
      if(s.resumeTimer)clearTimeout(s.resumeTimer);
      if(s.initialSyncTimer)clearTimeout(s.initialSyncTimer);
      this.#connections.delete(url);this.#status();
      const delay=Math.min(30000,1000*Math.pow(2,Math.min(attempt,5)));
      const boundedDelay=s.budgetPauseUntil?
        Math.max(delay,s.budgetPauseUntil-this.now()):delay;
      s.timer=setTimeout(()=>this.#open(url,generation,attempt+1),
        Math.min(65000,boundedDelay));
    };
  }
  async #accept(event,url,receipt=null,s=null){
    const session=s||this.#connections.get(url);
    if(!session||!event||typeof event!=='object')return false;
    const window=Math.floor(this.now()/60000);
    if(session.minute!==window){
      session.minute=window;session.verifiedCount=0;session.laneCounts.clear();
    }
    if(++session.verifiedCount>MAX_VERIFICATIONS_PER_MINUTE){
      this.onError(url,'untrusted peer exceeded local signature-verification budget');
      return false;
    }
    let observed=null;
    const pinned=this.sourcePins[url];
    if(receipt&&pinned){
      const result=await verifySourceReceipt(receipt,{
        expectedIssuer:pinned,eventId:event.id,now:this.now()
      });
      if(result.valid&&session.feedValidated&&
        result.feedDigest===session.feedDigest)observed=result;
    }
    const cls=observed?.resourceClass||'unknown';
    // Split congestion by operator-attested category AND coarse geography.
    // A missing/unpinned receipt enters UNKNOWN. Do not trust a forwarded
    // body field or an observer key first presented by an adversarial node.
    const box=observed?
      [cls,observed.country,observed.asn,observed.networkKind].join('|'):
      'unknown';
    const count=session.laneCounts.get(box)||0;
    // Do not silently throttle existing, explicitly selected legacy WS
    // mirrors to the stricter source-class budget before readers opt in
    // to a pinned observer. The bounded global verification limit remains.
    const classCap=cls==='unknown'&&!pinned?
      MAX_VERIFICATIONS_PER_MINUTE:RESOURCE_BUDGETS[cls];
    if(count>=classCap){
      this.#trace('source-throttle',url,box);
      return false;
    }
    session.laneCounts.set(box,count+1);
    if(!await verifyEvent(event)){
      this.onError(url,'peer supplied invalid signature');return true;
    }
    // Do not rely on a peer to respect subscriptions: a compromised or
    // misconfigured bridge can send unrelated signed events. Verified !=
    // subscribed; only the reader chooses what to add to local storage.
    if(!this.scopes.includes('*')&&!this.scopes.includes(event.payload.space)){
      this.#trace('scope-drop',url,
        JSON.stringify({id:event.id,space:event.payload.space,
          reason:'outside opted-in namespace synchronization'}));
      return true;
    }
    if(observed)this.onSource(observed,url);
    await this.onEvent(event,url);
    this.syncedCount++;this.#status();
    return true;
  }
  publish(event,onlyUrls=null){
    // Never use a peer as signature authority; publishing sends exactly
    // the caller-signed envelope, unmodified, to whichever nodes are chosen.
    let sent=0;
    for(const [url,s] of this.#connections){
      if(onlyUrls&&!onlyUrls.includes(url))continue;
      if(s.ws.readyState===this.WS.OPEN){
        this.#send(s.ws,url,{type:'publish',event});sent++;
      }
    }
    return sent;
  }
}
