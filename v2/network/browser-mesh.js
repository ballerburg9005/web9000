// No framework/bundler required. Direct browser WebSocket transport to any
// user-selected, replaceable OrbitDB peer. Every incoming record is verified
// before it reaches the caller's local replica. Nodes never sign on behalf of us.
import {verifyEvent} from '../core/events.js';
const ID=/^sha256:[0-9a-f]{64}$/;
const allowedSpace=s=>typeof s==='string'&&s.length>0&&s.length<=180&&!/[\x00-\x1f]/.test(s);
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
export class BrowserPeerMesh{
  #connections=new Map();
  #generation=0;
  constructor({WebSocketImpl=globalThis.WebSocket,onEvent=async()=>{},onAck=()=>{},onStatus=()=>{},onError=()=>{},
      getPending=()=>[],securePage=false}={}){
    if(!WebSocketImpl)throw Error('WebSocket implementation missing');
    this.WS=WebSocketImpl;
    this.onEvent=onEvent;this.onAck=onAck;this.onStatus=onStatus;this.onError=onError;
    this.getPending=getPending;this.securePage=securePage;
    this.scopes=['*'];this.urls=[];this.syncedCount=0;
  }
  get connected(){return [...this.#connections.values()].filter(s=>s.ws.readyState===this.WS.OPEN).length;}
  #status(){this.onStatus({connected:this.connected,total:this.urls.length,synced:this.syncedCount});}
  connect(urls,{spaces=['*']}={}){
    if(!Array.isArray(urls)||urls.length>8||!Array.isArray(spaces)||!spaces.length||spaces.length>64 ||
      spaces.some(s=>s!=='*'&&!allowedSpace(s)))throw Error('Invalid peer configuration');
    const sanitized=[...new Set(urls.map(u=>normalizePeerUrl(u,{securePage:this.securePage})))];
    this.disconnect();
    this.urls=sanitized;this.scopes=[...new Set(spaces)];
    const generation=this.#generation;
    for(const url of sanitized)this.#open(url,generation,0);
    this.#status();
  }
  disconnect(){
    this.#generation++;
    for(const s of this.#connections.values()){
      if(s.timer)clearTimeout(s.timer);
      s.ws.onopen=s.ws.onmessage=s.ws.onerror=s.ws.onclose=null;
      s.ws.close();
    }
    this.#connections.clear();this.urls=[];this.syncedCount=0;this.#status();
  }
  #open(url,generation,attempt){
    if(generation!==this.#generation)return;
    let ws;
    try{ws=new this.WS(url);}catch(error){this.onError(url,error.message);return;}
    const s={ws,timer:null,chain:Promise.resolve(),pages:0,lastCursor:null};
    this.#connections.set(url,s);
    ws.onopen=()=>{if(generation!==this.#generation)return;
      this.#status();
      // Subscribe all namespaces by default. Per-scope replication is optional.
      ws.send(JSON.stringify({type:'subscribe',spaces:this.scopes}));
      ws.send(JSON.stringify({type:'sync',cursor:null,limit:32}));
      for(const event of this.getPending())this.publish(event,[url]);
    };
    ws.onmessage=e=>{
      s.chain=s.chain.then(async()=>{
        if(generation!==this.#generation)return;
        let msg;
        try{if(typeof e.data!=='string'||e.data.length>2*1024*1024)return;msg=JSON.parse(e.data);}
        catch{return;}
        if(msg.type==='batch'){
          if(!Array.isArray(msg.events)||msg.events.length>32)return;
          for(const event of msg.events)await this.#accept(event,url);
          if(typeof msg.next==='string'&&ID.test(msg.next)&&msg.next!==s.lastCursor&&s.pages<1000){
            s.pages++;s.lastCursor=msg.next;
            ws.send(JSON.stringify({type:'sync',cursor:msg.next,limit:32}));
          }
        }else if(msg.type==='event'){
          await this.#accept(msg.event,url);
        }else if(msg.type==='ack'){
          if(ID.test(msg.id))this.onAck(msg.id,url);
        }else if(msg.type==='error'||msg.type==='reject'){
          this.onError(url,msg.error||msg.reason||'peer rejected a message');
        }
      }).catch(err=>this.onError(url,String(err)));
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{if(generation!==this.#generation)return;
      if(this.#connections.get(url)!==s)return;
      this.#connections.delete(url);this.#status();
      const delay=Math.min(30000,1000*Math.pow(2,Math.min(attempt,5)));
      s.timer=setTimeout(()=>this.#open(url,generation,attempt+1),delay);
    };
  }
  async #accept(event,url){
    if(!await verifyEvent(event)){this.onError(url,'peer supplied invalid signature');return;}
    await this.onEvent(event,url);
    this.syncedCount++;this.#status();
  }
  publish(event,onlyUrls=null){
    // Never use a peer as signature authority; publishing sends exactly
    // the caller-signed envelope, unmodified, to whichever nodes are chosen.
    let sent=0;
    for(const [url,s] of this.#connections){
      if(onlyUrls&&!onlyUrls.includes(url))continue;
      if(s.ws.readyState===this.WS.OPEN){
        s.ws.send(JSON.stringify({type:'publish',event}));sent++;
      }
    }
    return sent;
  }
}
