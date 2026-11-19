// Read-only browser diagnostic for TWO reader-selected WebSocket peers.
// A peer's inventory is a self-report, not proof of complete global history,
// independent human reviewers, wrongdoing, or signer authenticity.
import {normalizePeerUrl,normalizeSyncSpaces} from './browser-mesh.js';

const ID=/^sha256:[0-9a-f]{64}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const MAX_IDS=256;

async function openPeer(url,WebSocketImpl,timeout){
  return new Promise((resolve,reject)=>{
    let socket;
    try{socket=new WebSocketImpl(url);}catch(error){reject(error);return;}
    let done=false;
    const clean=()=>{clearTimeout(timer);socket.removeEventListener('open',onOpen);
      socket.removeEventListener('error',onError);socket.removeEventListener('close',onClose);};
    const onOpen=()=>{if(done)return;done=true;clean();resolve(socket);};
    const fail=error=>{if(done)return;done=true;clean();socket.close();reject(error);};
    const onError=()=>fail(Error('WebSocket inventory connection failed'));
    const onClose=()=>fail(Error('WebSocket inventory connection closed'));
    const timer=setTimeout(()=>fail(Error('WebSocket inventory connection timed out')),timeout);
    socket.addEventListener('open',onOpen);
    socket.addEventListener('error',onError);
    socket.addEventListener('close',onClose);
  });
}
function request(socket,command,expected,timeout){
  return new Promise((resolve,reject)=>{
    let done=false;
    const clean=()=>{clearTimeout(timer);socket.removeEventListener('message',onMessage);
      socket.removeEventListener('close',onClose);socket.removeEventListener('error',onError);};
    const finish=(error,value)=>{if(done)return;done=true;clean();if(error)reject(error);else resolve(value);};
    const onClose=()=>finish(Error('Peer disconnected during inventory query'));
    const onError=()=>finish(Error('Peer inventory socket error'));
    const onMessage=e=>{
      if(typeof e.data!=='string'||e.data.length>65536){
        finish(Error('Oversized or non-text peer inventory response'));return;
      }
      let packet;
      try{packet=JSON.parse(e.data);}catch{finish(Error('Invalid inventory response JSON'));return;}
      // Only ignore unsolicited ordinary traffic. An unexpected inventory
      // frame cannot silently satisfy a different request.
      if(['hello','event','batch'].includes(packet?.type))return;
      if(['error','reject'].includes(packet?.type)){
        finish(Error('Peer refused inventory query'));return;
      }
      if(packet?.type!==expected){finish(Error('Unexpected peer inventory response'));return;}
      finish(null,packet);
    };
    const timer=setTimeout(()=>finish(Error('Peer inventory response timed out')),timeout);
    socket.addEventListener('message',onMessage);
    socket.addEventListener('close',onClose);
    socket.addEventListener('error',onError);
    try{socket.send(JSON.stringify(command));}catch(error){finish(error);}
  });
}
// Deployed reconciliation-v1 fingerprints use the TWO LITERAL bytes backslash
// and n between ID strings (not a linefeed). Keep that exact wire encoding
// for interoperability with deployed peers and the existing operator CLI.
function sha256IdList(ids){
  return globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(ids.map(id=>id+'\\n').join('')))
    .then(bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join(''));
}
async function listIds(socket,inventory,timeout){
  let cursor=null;
  const ids=[];
  do{
    const page=await request(socket,{type:'inventory-ids',prefix:'',cursor},'inventory-ids',timeout);
    if(page.prefix!==''||!Array.isArray(page.ids)||page.ids.length>32||
      page.ids.some((id,i)=>!ID.test(id)||(cursor!==null&&id<=cursor)||
        (i>0&&id<=page.ids[i-1]))||
      (page.next!==null&&page.next!==page.ids.at(-1)))
      throw Error('Invalid sorted inventory page');
    ids.push(...page.ids);
    cursor=page.next;
    if(ids.length>MAX_IDS||(cursor!==null&&page.ids.length===0))
      throw Error('Peer inventory exceeds browser diagnostics limit');
  }while(cursor!==null);
  if(ids.length!==inventory.count||await sha256IdList(ids)!==inventory.digest)
    throw Error('Peer IDs disagree with its own inventory fingerprint');
  return ids;
}

/**
 * Query TWO already approved peers only after an explicit UI click.
 * The caller must supply URLs from the browser's existing selected-peer list.
 * This function neither publishes nor downloads signed events or media.
 */
export async function compareApprovedPeerInventories(urls,scopes=['*'],{
  WebSocketImpl=globalThis.WebSocket,timeoutMs=8000,securePage=false
}={}){
  if(!Array.isArray(urls)||urls.length!==2||!WebSocketImpl)
    throw Error('Choose two existing WebSocket peers');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)
    throw Error('Invalid inventory timeout');
  const selected=urls.map(s=>normalizePeerUrl(s,{securePage}));
  if(selected[0]===selected[1])throw Error('Choose two different peers');
  const spaces=normalizeSyncSpaces(scopes);
  const sockets=[];
  try{
    const snapshots=[];
    for(const url of selected){
      const socket=await openPeer(url,WebSocketImpl,timeoutMs);
      sockets.push(socket);
      const subscribe=await request(socket,{type:'subscribe',spaces},'subscribed',timeoutMs);
      if(!Array.isArray(subscribe.spaces)||
        JSON.stringify([...new Set(subscribe.spaces)].sort())!==JSON.stringify([...spaces].sort()))
        throw Error('Peer did not accept the selected namespace scope');
      const inventory=await request(socket,{type:'inventory',prefix:''},'inventory',timeoutMs);
      if(inventory.prefix!==''||!Number.isSafeInteger(inventory.count)||
        inventory.count<0||!DIGEST.test(inventory.digest)||
        !Number.isSafeInteger(inventory.revision)||inventory.revision<0)
        throw Error('Malformed inventory fingerprint');
      snapshots.push({url,count:inventory.count,digest:inventory.digest,
        localRevision:inventory.revision});
    }
    const equal=snapshots[0].count===snapshots[1].count&&
      snapshots[0].digest===snapshots[1].digest;
    const result={kind:'local-peer-inventory-diagnostic',
      peers:snapshots,scopes:spaces,readOnly:true,
      status:equal?'same-reported-inventory':'different-reported-inventories',
      missingFromFirst:[],missingFromSecond:[],
      note:'These are two peer-reported local snapshots. Agreement does not prove complete history; disagreement does not prove deliberate censorship.'};
    if(!equal&&snapshots.every(s=>s.count<=MAX_IDS)){
      const idsA=await listIds(sockets[0],snapshots[0],timeoutMs);
      const idsB=await listIds(sockets[1],snapshots[1],timeoutMs);
      const a=new Set(idsA),b=new Set(idsB);
      result.missingFromFirst=idsB.filter(id=>!a.has(id));
      result.missingFromSecond=idsA.filter(id=>!b.has(id));
      result.status='different-reported-ids';
    }else if(!equal){
      result.note+=' ID-level comparison skipped because this browser diagnostic is capped at '+MAX_IDS+' IDs per peer; use the operator CLI for bounded prefix comparison.';
    }
    return result;
  }finally{
    for(const socket of sockets)try{socket.close();}catch{}
  }
}
