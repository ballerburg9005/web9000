// Explicit operator-facing signed media CID advertisement. Public claims
// are optional, untrusted until locally assessed, and never pin any bytes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocket} from 'ws';
import {CID} from 'multiformats/cid';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {normalizeMediaGateway} from '../core/media-discovery.js';

export async function initializeProviderIdentity(file){
 if(typeof file!=='string'||!file)throw Error('Key file is required');
 const id=await generateIdentity({extractable:true});
 const jwk=await crypto.subtle.exportKey('jwk',id.privateKey);
 await mkdir(path.dirname(path.resolve(file)),{recursive:true});
 await writeFile(file,JSON.stringify({format:'web9000-media-provider-key-v1',
  author:id.author,jwk},null,2)+'\n',{flag:'wx',mode:0o600});
 return {author:id.author,file};
}
async function loadIdentity(file){
 const value=JSON.parse(await readFile(file,'utf8'));
 if(value?.format!=='web9000-media-provider-key-v1'||
    !/^ed25519:[A-Za-z0-9_-]{43}$/.test(value.author)||!value.jwk||
    'ed25519:'+value.jwk.x!==value.author)throw Error('Invalid provider key');
 const key=await crypto.subtle.importKey('jwk',value.jwk,'Ed25519',false,['sign']);
 return {author:value.author,privateKey:key};
}
export async function createProviderClaim({file,gateway,cids,action='offer',now=Date.now()}){
 if(!['offer','withdraw'].includes(action))throw Error('Invalid availability action');
 if(!Array.isArray(cids)||cids.length<1||cids.length>32)
   throw Error('Provide 1–32 CIDs per signed advertisement');
 const ids=[...new Set(cids.map(v=>'ipfs://'+CID.parse(v.replace(/^ipfs:\/\//,'')).toString()))];
 const identity=await loadIdentity(file);
 const body={gateway:normalizeMediaGateway(gateway),cids:ids,
   action,expiresAt:now+2*86400000};
 return signEvent(identity,{kind:'media-provider',space:'media-providers',body,time:now});
}
export async function publishClaim({url,event,origin=null,timeoutMs=15000}){
 if(!await verifyEvent(event))throw Error('Invalid signed advertisement');
 const wsUrl=new URL(url);
 if(!['wss:','ws:'].includes(wsUrl.protocol)||wsUrl.username||wsUrl.password||
    wsUrl.hash||wsUrl.search)throw Error('Explicit WebSocket peer URL required');
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(wsUrl.href,{headers:origin?{Origin:origin}:{}});
  let done=false;
  const timer=setTimeout(()=>finish(Error('Peer acknowledgment timed out')),timeoutMs);
  function finish(err){
   if(done)return;done=true;clearTimeout(timer);
   ws.terminate();
   if(err)reject(err);else resolve({id:event.id,peer:wsUrl.href});
  }
  ws.on('open',()=>ws.send(JSON.stringify({type:'publish',event})));
  ws.on('message',raw=>{
   let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
   if(msg.type==='ack'&&msg.id===event.id)finish();
   if(msg.type==='reject'&&(!msg.id||msg.id===event.id))
     finish(Error('Mirror refused claim: '+(msg.reason||'unspecified')));
  });
  ws.on('error',error=>finish(error));
  ws.on('close',()=>{if(!done)finish(Error('Peer disconnected before acknowledgment'));});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,...args]=process.argv.slice(2);
 try{
  if(command==='init'&&args.length===1)
    console.log(JSON.stringify(await initializeProviderIdentity(args[0])));
  else if(['offer','withdraw'].includes(command)&&args.length>=3)
    console.log(JSON.stringify(await createProviderClaim({
      action:command,file:args[0],gateway:args[1],cids:args.slice(2)})));
  else if(command==='publish'&&(args.length===2||args.length===3)){
   let raw='';
   if(args[1]==='-'){for await(const chunk of process.stdin)raw+=chunk;}
   else raw=await readFile(args[1],'utf8');
   console.log(JSON.stringify(await publishClaim({
    url:args[0],event:JSON.parse(raw),origin:args[2]||null})));
  }else{
   console.error('Usage: announce-media.mjs init <private-jwk-file>');
   console.error('       announce-media.mjs offer|withdraw <private-jwk-file> <media-gateway> <CID> [...]');
   console.error('       announce-media.mjs publish <ws://peer> <event.json|-> [browser-origin]');
   process.exitCode=2;
  }
 }catch(error){console.error('Provider advertisement failed:',error.message);process.exitCode=1;}
}
