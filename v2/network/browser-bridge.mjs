// Optional browser-facing transport attached to ANY independently operated OrbitDB peer.
// The bridge is not a namespace authority, identity provider, or global deletion service.
// It only exchanges independently verified signed records over a replaceable WebSocket.
import {WebSocketServer, WebSocket} from 'ws';
import {isIP} from 'node:net';
import {verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {ScopedEventCatalog} from './scoped-event-catalog.mjs';
import {verifySourceFeed,classifyObservedIp,parseNetworkIp} from './source-feed.js';
import {signSourceReceipt} from './source-receipt.js';
import {verifySourceProvenance,digestRules} from './source-provenance.js';
import {verifySourceFeedDocument} from './source-feed-bundle.js';

const MAX_INBOUND = 48 * 1024;
const MAX_BUFFERED = 2 * 1024 * 1024;
const MAX_SYNC = 32;
const VALID_ID = /^sha256:[0-9a-f]{64}$/;
const VALID_PREFIX = /^[0-9a-f]{0,8}$/;
const VALID_SPACE = v => typeof v==='string' && v.length>0 && v.length<=180 && !/[\x00-\x1f]/.test(v);
const wire = (ws, object) => {
  if (ws.readyState!==WebSocket.OPEN) return false;
  if (ws.bufferedAmount>MAX_BUFFERED) { ws.close(1008,'Slow consumer');return false; }
  ws.send(JSON.stringify(object));
  return true;
};
const allow = (session,event) => session.spaces?.has('*') || session.spaces?.has(event?.payload?.space);

/**
 * @param {object} config
 * @param {object} config.index - openPublicIndex adapter with publish/loadInto/onUpdate.
 * @param {Replica} [config.replica] - independently chosen local mirror.
 * @param {string} [config.host='127.0.0.1'] - loopback only by default.
 * @param {number} [config.port=8787] - use 0 for ephemeral test port.
 * @param {string[]} [config.allowedOrigins] - optional Origin restriction for hosted peers.
 */
export async function createBrowserBridge({
  index,replica=new Replica({maxEvents:30000}),
  host='127.0.0.1',port=8787,maxClients=64,allowedOrigins=null,publicTestLimits=false,
  sourceObserver=null,trustedProxyAddress=null
}={}) {
  if (!index?.publish || !index?.loadInto || !index?.onUpdate) throw Error('Active OrbitDB index required');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Invalid browser bridge port');
  if(trustedProxyAddress!==null&&!isIP(trustedProxyAddress))
    throw Error('Trusted proxy must be one explicitly pinned socket IP');
  // Optional direct-connection observation. The observer must pin a signed
  // source feed; an author's country/VPN JSON and arbitrary HTTP headers are
  // NEVER accepted as proof. Existing peers work unchanged with this off.
  let observedFeed=null;
  if(sourceObserver){
    if(!sourceObserver.signer?.privateKey||
      !/^ed25519:[A-Za-z0-9_-]{43}$/.test(sourceObserver.signer.author||'')||
      typeof sourceObserver.feedIssuer!=='string'||
      (sourceObserver.trustedProxyAddress!==undefined&&
       !isIP(sourceObserver.trustedProxyAddress)))
      throw Error('Pinned source-observer signing key and trusted feed issuer required');
    observedFeed=await verifySourceFeedDocument(sourceObserver.feed,{
      expectedIssuer:sourceObserver.feedIssuer
    });
    if(!observedFeed.valid)throw Error('Unverifiable source-classification list: '+observedFeed.reason);
    if(sourceObserver.provenance){
      const attested=await verifySourceProvenance(sourceObserver.provenance,{
        expectedIssuer:sourceObserver.feedIssuer,
        revision:observedFeed.revision,feedDigest:observedFeed.digest
      });
      if(!attested.valid||attested.rulesSha256!==await digestRules(observedFeed.rules)||
        attested.rulesCount!==observedFeed.rules.length)
        throw Error('Source provenance must match verified signed feed and rule contents');
    }
  }
  const recentObservations=new Map();
  // A signed country/ASN/VPN feed may have up to 2,048 CIDR rules. Classify
  // once per real WebSocket connection, not once per forged signing identity.
  // The weak cache is discarded with the socket and invalidates on updates.
  const connectionClassCache=new WeakMap();
  const sourceAttemptBudgets=new Map();
  let sourceAttemptWindow=-1;
  const SOURCE_ATTEMPTS=Object.freeze({
    residential:120,mobile:80,vpn:12,proxy:8,tor:8,
    datacenter:12,hosting:12,relay:12,unknown:16
  });
  function observedConnection(request){
    let ip=request.socket.remoteAddress||null,hop='direct-socket';
    const expectedProxy=sourceObserver?.trustedProxyAddress||trustedProxyAddress;
    if(expectedProxy&&ip===expectedProxy){
      // Only the exact operator-pinned proxy socket may assert a single
      // X-Real-IP. Never accept an arbitrary X-Forwarded-For chain.
      const forwarded=request.headers['x-real-ip'];
      if(typeof forwarded==='string'&&parseNetworkIp(forwarded)){
        ip=forwarded;hop='trusted-proxy';
      }else{ip=null;hop='unknown';}
    }
    return {ip,hop};
  }
  function observedClass(request){
    const sourceFeedFresh=observedFeed&&observedFeed.expiresAt>Date.now();
    const feedDigest=sourceFeedFresh?observedFeed.digest:null;
    const cached=connectionClassCache.get(request);
    if(cached&&cached.feedDigest===feedDigest)return cached.observation;
    const {ip,hop}=observedConnection(request);
    const classification=classifyObservedIp(ip,
      sourceFeedFresh?observedFeed:null);
    const observation={...classification,ip,hop,feedDigest};
    connectionClassCache.set(request,{feedDigest,observation});
    return observation;
  }
  function sourceAttempt(request){
    if(!sourceObserver)return {allowed:true};
    const observed=observedClass(request);
    const parsed=parseNetworkIp(observed.ip);
    // Never replicate raw IP/cohort. Keep only a bounded, local coarse
    // network-prefix counter before expensive signature verification.
    const subnet=parsed?parsed.version===4?
      parsed.bytes.slice(0,3).join('.'):
      parsed.bytes.slice(0,6).map(x=>x.toString(16).padStart(2,'0')).join(''):
      'no-observable-source';
    const family=observed.networkKind;
    const now=Date.now(),minute=Math.floor(now/60000);
    if(minute!==sourceAttemptWindow){
      sourceAttemptWindow=minute;sourceAttemptBudgets.clear();
    }
    const kindKey=family+'|'+observed.country+'|'+observed.asn;
    let key=kindKey+'|'+subnet;
    if(!sourceAttemptBudgets.has(key)&&sourceAttemptBudgets.size>=128)
      key='overflow|'+family;
    const attempts=sourceAttemptBudgets.get(key)||0;
    if(attempts>=SOURCE_ATTEMPTS[family])
      return {allowed:false,
        reason:'This observer source compartment is temporarily full'};
    sourceAttemptBudgets.set(key,attempts+1);
    return {allowed:true};
  }
  async function receiptFor(event,request){
    if(!sourceObserver)return null;
    const observed=observedClass(request);
    return signSourceReceipt(sourceObserver.signer,{
      eventId:event.id,observedAt:Date.now(),hop:observed.hop,
      networkKind:observed.networkKind,country:observed.country,
      asn:observed.asn,feedDigest:observed.feedDigest
    });
  }
  function rememberReceipt(id,receipt){
    if(!receipt)return;
    for(const [key,value] of recentObservations){
      if(value.body.expiresAt<=Date.now())recentObservations.delete(key);
    }
    if(recentObservations.size>=1024)
      recentObservations.delete(recentObservations.keys().next().value);
    recentObservations.set(id,receipt);
  }
  await index.loadInto(replica);
  // Build once from locally verified immutable records. Future index updates
  // are added incrementally; no more O(all records) clone/filter/sort on
  // every 32-item browser pagination request.
  const catalog=new ScopedEventCatalog(replica.list());
  const server=new WebSocketServer({
    host,port,perMessageDeflate:false,maxPayload:MAX_INBOUND,clientTracking:true,
    verifyClient(info,done) {
      if(allowedOrigins && !allowedOrigins.includes(info.origin))return done(false,403,'Origin not allowed');
      if(server.clients.size >= maxClients)return done(false,503,'Peer capacity reached');
      done(true);
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('listening',resolve);
    server.once('error',reject);
  });
  const sessions=new Set();
  function announceSignedSourceList(ws){
    if(!sourceObserver)return;
    // Multipart data stays outside OrbitDB. Only the small signed manifest
    // is sent unsolicited; readers opt into bounded, sequential chunk fetch.
    if(sourceObserver.feed.manifest)
      wire(ws,{type:'source-feed-manifest',manifest:sourceObserver.feed.manifest});
    else wire(ws,{type:'source-feed',document:sourceObserver.feed});
    if(sourceObserver.provenance)
      wire(ws,{type:'source-provenance',document:sourceObserver.provenance});
  }
  // RAM-only, operator-defined caps protect the unaudited *test peer*.
  // These are not global publication rules. Any user can host another peer.
  const budgets=new Map();
  function allowTestPublication(event,request){
    if(!publicTestLimits)return {allowed:true};
    const now=Date.now(),day=Math.floor(now/86400000);
    const ip=observedConnection(request).ip||'unknown';
    const author=event.payload.author,kind=event.payload.kind;
    const actor=author+'|'+day,client='client:'+ip+'|'+day;
    const entry=budgets.get(actor)||{post:0,reply:0,other:0};
    const user=budgets.get(client)||{post:0,reply:0,other:0};
    const key=kind==='post'?'post':kind==='reply'?'reply':'other';
    const caps={post:5,reply:80,other:120};
    if(entry[key]>=caps[key]||user.post+user.reply+user.other>=120)
      return {allowed:false,reason:'This test mirror has reached its local daily rate cap'};
    entry[key]++;user[key]++;budgets.set(actor,entry);budgets.set(client,user);
    if(budgets.size>10000)for(const [key] of budgets){if(!key.endsWith('|'+day))budgets.delete(key);if(budgets.size<=8000)break;}
    return {allowed:true};
  }
  function announce(event) {
    for(const session of sessions)if(allow(session,event))wire(session.ws,{
      type:'event',event,...(recentObservations.has(event.id)?
        {sourceReceipt:recentObservations.get(event.id)}:{})});
  }
  async function receive(event) {
    const result=await replica.ingest(event);
    if(result.accepted && !result.duplicate){
      catalog.add(event);
      announce(event);
    }
    return result;
  }
  const unsubscribe=index.onUpdate(event=>{receive(event).catch(err=>console.error('Bridge update error',err));});
  server.on('connection',(ws,request)=>{
    const session={ws,spaces:null,snapshot:null,
      window:Date.now(),received:0,chain:Promise.resolve(),inventoryMemo:new Map(),
      chunkWindow:Date.now(),chunkRequests:0};
    sessions.add(session);
    ws.on('close',()=>sessions.delete(session));
    ws.on('error',()=>{});
    wire(ws,{type:'hello',protocol:'web9000-ws/1',index:index.address,
      ...(sourceObserver?{sourceObserver:sourceObserver.signer.author,
        sourceFeedIssuer:sourceObserver.feedIssuer,
        sourceFeedDigest:observedFeed.digest}:{}),
      peer:'independent-browser-bridge',maxSync:MAX_SYNC,
      capabilities:['scoped-id-index-v1','local-observation-snapshot-v1','read-only-reconciliation-v1']});
    // Source intelligence is operator-signed public *data*, not an
    // executable rule, a peer-wide ban or a trusted author identity.
    announceSignedSourceList(ws);
    ws.on('message',raw=>{
      const now=Date.now();
      if(now-session.window>=60000){session.window=now;session.received=0;}
      if(++session.received>90){ws.close(1008,'Peer rate limit');return;}
      if(raw.byteLength>MAX_INBOUND){ws.close(1009,'Too large');return;}
      // Serialize per-socket commands to avoid races between subscribe and sync.
      session.chain=session.chain.then(async()=>{
        let msg;
        try{msg=JSON.parse(raw.toString('utf8'));}catch{wire(ws,{type:'error',error:'invalid JSON'});return;}
        if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
        if(msg.type==='source-feed-chunk'){
          if(!sourceObserver?.feed?.manifest)return;
          const data=sourceObserver.feed;
          if(!Number.isSafeInteger(msg.revision)||
             msg.revision!==data.manifest.body.revision||
             !Number.isSafeInteger(msg.index)||msg.index<0||
             msg.index>=data.chunks.length){
            wire(ws,{type:'error',error:'invalid signed source chunk request'});
            return;
          }
          const moment=Date.now();
          if(moment-session.chunkWindow>=60000){
            session.chunkWindow=moment;session.chunkRequests=0;
          }
          if(++session.chunkRequests>68){
            wire(ws,{type:'error',error:'signed source chunk request budget'});
            return;
          }
          wire(ws,{type:'source-feed-chunk',revision:msg.revision,
            index:msg.index,document:data.chunks[msg.index]});
          return;
        }
        if(msg.type==='subscribe'){
          if(!Array.isArray(msg.spaces)||msg.spaces.length<1||msg.spaces.length>64 ||
             msg.spaces.some(s=>s!=='*'&&!VALID_SPACE(s))){
            wire(ws,{type:'error',error:'invalid spaces'});return;
          }
          session.spaces=new Set(msg.spaces);
          // A fresh subscription begins a new local observation snapshot.
          // New signed events remain visible via live updates.
          session.snapshot=null;
          session.inventoryMemo.clear();
          wire(ws,{type:'subscribed',spaces:[...session.spaces]});
          return;
        }
        if(msg.type==='sync'){
          if(!session.spaces){wire(ws,{type:'error',error:'subscribe first'});return;}
          const cursor=msg.cursor===null||msg.cursor===undefined?null:msg.cursor;
          if(cursor!==null&&!VALID_ID.test(cursor)){wire(ws,{type:'error',error:'invalid cursor'});return;}
          const limit=Number.isInteger(msg.limit)?Math.min(Math.max(msg.limit,1),MAX_SYNC):MAX_SYNC;
          // Capture exactly one LOCAL observation revision per subscription.
          // A concurrent append is delivered via a live 'event' frame, but
          // cannot destabilize this history walk by changing its pages.
          if(!session.snapshot)session.snapshot=catalog.capture([...session.spaces]);
          const result=catalog.page(session.snapshot,{cursor,limit});
          const page=result.ids.map(id=>replica.get(id)).filter(Boolean);
          wire(ws,{type:'batch',events:page,next:result.next,
            ...(sourceObserver?{sourceReceipts:page.map(ev=>
              recentObservations.get(ev.id)||null)}:{}),
            snapshotRevision:result.revision});
          return;
        }
        // Read-only, range-bounded inventory reconciliation. Neither the
        // digest nor record list is a signed completeness or timestamp proof.
        // Keep the same local observation snapshot as the current history walk.
        if(['inventory','inventory-ids','inventory-get'].includes(msg.type)){
          if(!session.spaces){wire(ws,{type:'error',error:'subscribe first'});return;}
          if(!session.snapshot)session.snapshot=catalog.capture([...session.spaces]);
          const snapshot=session.snapshot;
          if(msg.type==='inventory-get'){
            if(!Array.isArray(msg.ids)||msg.ids.length>8||
               msg.ids.some(id=>typeof id!=='string'||!VALID_ID.test(id))){
              wire(ws,{type:'error',error:'invalid requested ids'});return;
            }
            const events=msg.ids.filter(id=>catalog.inSnapshot(snapshot,id))
              .map(id=>replica.get(id)).filter(Boolean);
            wire(ws,{type:'inventory-records',events,snapshotRevision:snapshot.revision});
            return;
          }
          if(typeof msg.prefix!=='string'||!VALID_PREFIX.test(msg.prefix)){
            wire(ws,{type:'error',error:'invalid inventory prefix'});return;
          }
          if(msg.type==='inventory'){
            let result=session.inventoryMemo.get(msg.prefix);
            if(!result){
              result=catalog.fingerprint(snapshot,{prefix:msg.prefix});
              if(session.inventoryMemo.size>=64)session.inventoryMemo.clear();
              session.inventoryMemo.set(msg.prefix,result);
            }
            wire(ws,{type:'inventory',...result});
            return;
          }
          const cursor=msg.cursor??null;
          if(cursor!==null&&!VALID_ID.test(cursor)){
            wire(ws,{type:'error',error:'invalid inventory cursor'});return;
          }
          try{
            const result=catalog.page(snapshot,{cursor,prefix:msg.prefix,limit:MAX_SYNC});
            wire(ws,{type:'inventory-ids',prefix:msg.prefix,...result});
          }catch{
            wire(ws,{type:'error',error:'invalid inventory range'});
          }
          return;
        }
        if(msg.type==='publish'){
          // Network-origin admission is cheaper than validating thousands
          // of forged signing identities. The source budget resets each
          // minute; it does not ban an author or alter signed event validity.
          const sourceBudget=sourceAttempt(request);
          if(!sourceBudget.allowed){
            wire(ws,{type:'reject',reason:sourceBudget.reason,
              id:VALID_ID.test(msg.event?.id)?msg.event.id:null});
            return;
          }
          if(!await verifyEvent(msg.event)){wire(ws,{type:'reject',reason:'bad signature or envelope'});return;}
          if(replica.size>=replica.maxEvents&&!replica.get(msg.event.id)){
            wire(ws,{type:'reject',reason:'local node capacity'});return;
          }
          // A node may refuse to store any publication. That cannot revoke
          // an independently stored record or prevent another peer accepting it.
          const budget=allowTestPublication(msg.event,request);
          if(!budget.allowed){wire(ws,{type:'reject',reason:budget.reason,id:msg.event.id});return;}
          try{
            const receipt=await receiptFor(msg.event,request);
            rememberReceipt(msg.event.id,receipt);
            await index.publish(msg.event);
            await receive(msg.event);
            // Returning the signed observation to its source does not
            // turn the source's IP classification into author identity.
            if(receipt)wire(ws,{type:'source-receipt',eventId:msg.event.id,receipt});
            wire(ws,{type:'ack',id:msg.event.id});
          }catch(error){
            recentObservations.delete(msg.event?.id);
            wire(ws,{type:'reject',reason:'this peer could not append',id:msg.event.id});
          }
          return;
        }
        wire(ws,{type:'error',error:'unknown command'});
      }).catch(error=>{console.error('Browser bridge session error',error);wire(ws,{type:'error',error:'peer operation failed'});});
    });
  });
  return {
    replica,catalog,index: index.address,
    host,port:server.address().port,
    url:'ws://'+(host.includes(':')?'['+host+']':host)+':'+server.address().port+'/',
    async updateSourceFeed(document,{provenance=null}={}){
      if(!sourceObserver)throw Error('Source classification is not enabled at this peer');
      const verified=await verifySourceFeedDocument(document,{
        expectedIssuer:sourceObserver.feedIssuer,
        minimumRevision:observedFeed.revision+1
      });
      if(!verified.valid)throw Error('Source feed update rejected: '+verified.reason);
      if(sourceObserver.provenance&&!provenance)
        throw Error('Cannot silently discard an existing signed source provenance trail');
      if(provenance){
        const attested=await verifySourceProvenance(provenance,{
          expectedIssuer:sourceObserver.feedIssuer,
          revision:verified.revision,feedDigest:verified.digest
        });
        if(!attested.valid||attested.rulesSha256!==await digestRules(verified.rules)||
          attested.rulesCount!==verified.rules.length)
          throw Error('Source feed update provenance mismatch');
      }
      observedFeed=verified;sourceObserver.feed=document;
      sourceObserver.provenance=provenance;
      for(const session of sessions)announceSignedSourceList(session.ws);
      return {revision:verified.revision,digest:verified.digest};
    },
    async close(){
      unsubscribe();
      for(const session of sessions)session.ws.terminate();
      await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    }
  };
}
