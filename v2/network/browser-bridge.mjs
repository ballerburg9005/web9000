// Optional browser-facing transport attached to ANY independently operated OrbitDB peer.
// The bridge is not a namespace authority, identity provider, or global deletion service.
// It only exchanges independently verified signed records over a replaceable WebSocket.
import {WebSocketServer, WebSocket} from 'ws';
import {verifyEvent} from '../core/events.js';
import {Replica} from '../core/replica.js';
import {ScopedEventCatalog} from './scoped-event-catalog.mjs';

const MAX_INBOUND = 48 * 1024;
const MAX_BUFFERED = 2 * 1024 * 1024;
const MAX_SYNC = 32;
const VALID_ID = /^sha256:[0-9a-f]{64}$/;
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
  host='127.0.0.1',port=8787,maxClients=64,allowedOrigins=null,publicTestLimits=false
}={}) {
  if (!index?.publish || !index?.loadInto || !index?.onUpdate) throw Error('Active OrbitDB index required');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('Invalid browser bridge port');
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
  // RAM-only, operator-defined caps protect the unaudited *test peer*.
  // These are not global publication rules. Any user can host another peer.
  const budgets=new Map();
  function allowTestPublication(event,request){
    if(!publicTestLimits)return {allowed:true};
    const now=Date.now(),day=Math.floor(now/86400000);
    // Since the bridge may be behind a reverse proxy, it receives a trusted
    // visitor IP only if the operator configured X-Real-IP at that proxy.
    const ip=request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown';
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
    for(const session of sessions)if(allow(session,event))wire(session.ws,{type:'event',event});
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
      window:Date.now(),received:0,chain:Promise.resolve()};
    sessions.add(session);
    ws.on('close',()=>sessions.delete(session));
    ws.on('error',()=>{});
    wire(ws,{type:'hello',protocol:'web9000-ws/1',index:index.address,
      peer:'independent-browser-bridge',maxSync:MAX_SYNC,
      capabilities:['scoped-id-index-v1','local-observation-snapshot-v1']});
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
        if(msg.type==='subscribe'){
          if(!Array.isArray(msg.spaces)||msg.spaces.length<1||msg.spaces.length>64 ||
             msg.spaces.some(s=>s!=='*'&&!VALID_SPACE(s))){
            wire(ws,{type:'error',error:'invalid spaces'});return;
          }
          session.spaces=new Set(msg.spaces);
          // A fresh subscription begins a new local observation snapshot.
          // New signed events remain visible via live updates.
          session.snapshot=null;
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
            snapshotRevision:result.revision});
          return;
        }
        if(msg.type==='publish'){
          if(!await verifyEvent(msg.event)){wire(ws,{type:'reject',reason:'bad signature or envelope'});return;}
          if(replica.size>=replica.maxEvents&&!replica.get(msg.event.id)){
            wire(ws,{type:'reject',reason:'local node capacity'});return;
          }
          // A node may refuse to store any publication. That cannot revoke
          // an independently stored record or prevent another peer accepting it.
          const budget=allowTestPublication(msg.event,request);
          if(!budget.allowed){wire(ws,{type:'reject',reason:budget.reason,id:msg.event.id});return;}
          try{
            await index.publish(msg.event);
            await receive(msg.event);
            wire(ws,{type:'ack',id:msg.event.id});
          }catch(error){wire(ws,{type:'reject',reason:'this peer could not append',id:msg.event.id});}
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
    async close(){
      unsubscribe();
      for(const session of sessions)session.ws.terminate();
      await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    }
  };
}
