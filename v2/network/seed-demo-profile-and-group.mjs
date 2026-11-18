// Optional independently signed profile and recommendation-charter examples.
// Uses ONLY the existing private demo signing key on the operator's machine;
// never transfers that key to a server, browser, log, or repository.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WebSocket} from 'ws';
import {signEvent} from '../core/events.js';
const dir=path.resolve(process.argv[2]||'/data');
const checkpoint=path.join(dir,'demo-profile-groups-state.json');
try{
  const state=JSON.parse(await readFile(checkpoint,'utf8'));
  if(state.version===1&&state.events.length===2){
    console.log('Demo signed profile and group already prepared: no duplicate action.');
    process.exit(0);
  }
}catch(error){if(error.code!=='ENOENT')throw error;}
const saved=JSON.parse(await readFile(path.join(dir,'demo-identity.private.json'),'utf8'));
const identity={author:saved.author,privateKey:await crypto.subtle.importKey('pkcs8',
  Buffer.from(saved.privateKey,'base64url'),'Ed25519',false,['sign'])};
const payloads=[
  {kind:'profile',space:'profiles',body:{
    name:'WEB9000 Demo Publisher',
    description:'This is a publicly signed example profile for the experimental /demo space. Posts, comments and gallery examples belong to this test signing identity. Other users can publish to /demo without permission.',
    website:''
  }},
  {kind:'group',space:'groups',body:{
    name:'Open Media Circle',description:'An example self-governed group recommending open, nonexclusive places to share pictures, music and gatherings. Following does not reserve or own those spaces.',
    governance:'democracy',quorum:{numerator:50,denominator:100},
    recommendedSpaces:['demo','photography','music','meetups']
  }}
];
const events=[];
for(const item of payloads)events.push(await signEvent(identity,item));
const socket=new WebSocket(process.env.WEB9000_DEMO_WS_URL||'ws://127.0.0.1:8787/');
let n=0;
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Peer did not acknowledge demo metadata')),28000);
  function finish(err){clearTimeout(timer);socket.close();err?reject(err):resolve();}
  socket.on('error',finish);
  socket.on('open',()=>socket.send(JSON.stringify({type:'subscribe',spaces:['*']})));
  socket.on('message',raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='subscribed')socket.send(JSON.stringify({type:'publish',event:events[n]}));
    if(msg.type==='reject')finish(Error('Peer rejected signed example: '+msg.reason));
    if(msg.type==='ack'&&msg.id===events[n]?.id){
      n++;if(n>=events.length)finish();
      else socket.send(JSON.stringify({type:'publish',event:events[n]}));
    }
  });
});
await writeFile(checkpoint,JSON.stringify({
  version:1,events:events.map(x=>x.id),author:identity.author
},null,2)+'\n',{mode:0o600});
console.log('Peer acknowledged two independently signed public demo metadata events.');