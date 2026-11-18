// Optional one-time demo-media publisher. Reads an EXISTING operator signing
// key from a private data volume; never generates or logs private material.
// These demo audio/video bytes are served by the demo site. Unlike the
// independently pinned example images, they are NOT yet IPFS-addressed.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WebSocket} from 'ws';
import {signEvent} from '../core/events.js';

const dir=path.resolve(process.argv[2]||'/data');
const checkpoint=path.join(dir,'demo-media-state.json');
let existing=null;
try{existing=JSON.parse(await readFile(checkpoint,'utf8'));}catch(e){
  if(e.code!=='ENOENT')throw e;
}
if(existing?.version===1&&existing.events?.length===2){
  console.log('Two demo media events already seeded. No duplicate publication.');
  process.exit(0);
}
const original=JSON.parse(await readFile(path.join(dir,'demo-identity.private.json'),'utf8'));
const identity={author:original.author,
  privateKey:await crypto.subtle.importKey('pkcs8',
    Buffer.from(original.privateKey,'base64url'),'Ed25519',false,['sign'])};
const specs=[
  {title:'Audio mini-player · community demo',text:'A signed example sound post using the original WEB9000 audio asset. The audio bytes are currently hosted by the demo website, not replicated on IPFS.',
    fields:{presentation:'audio',tags:['sound','music','demo'],demo:true,demoVersion:1,
      demoAudio:'../content/festival_theme.mp3'}},
  {title:'Video hover preview · community demo',text:'A signed example video post. Hover to see the moving thumbnail, then open the custom video player. The video bytes are currently hosted by the demo website.',
    fields:{presentation:'video',tags:['video','animation','demo'],demo:true,demoVersion:1,
      demoVideo:'../thumb/thumb10.mp4',demoThumb:'../thumb/thumb11.jpg'}}
];
const events=[];
for(const spec of specs)events.push(await signEvent(identity,{
  kind:'post',space:'demo',body:{...spec,media:[]}
}));
const endpoint=process.env.WEB9000_DEMO_WS_URL||'ws://127.0.0.1:8787/';
const ws=new WebSocket(endpoint);
let seq=0;
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Demo media signing peer timed out')),28000);
  function finish(error){
    clearTimeout(timer);ws.close();error?reject(error):resolve();
  }
  ws.on('error',finish);
  ws.on('open',()=>ws.send(JSON.stringify({type:'subscribe',spaces:['demo']})));
  ws.on('message',bytes=>{
    let msg;try{msg=JSON.parse(String(bytes));}catch{return;}
    if(msg.type==='subscribed')ws.send(JSON.stringify({type:'publish',event:events[seq]}));
    if(msg.type==='reject')finish(Error('Independent peer rejected signed demo: '+msg.reason));
    if(msg.type==='ack'&&msg.id===events[seq]?.id){
      seq++;
      if(seq>=events.length)finish();
      else ws.send(JSON.stringify({type:'publish',event:events[seq]}));
    }
  });
});
await writeFile(checkpoint,JSON.stringify({
  version:1,events:events.map(x=>x.id),author:identity.author,
  mediaHost:'DEMO WEBSITE ONLY, NO IPFS PIN CLAIM'
},null,2)+'\n',{mode:0o600});
console.log('Published '+events.length+' independently signed audio/video demo records; key material remains private.');