// One-time operator example clans and real comments for the signed demo space.
// This is a separate operator-controlled seed; it cannot grant namespace
// control or privileged access to anybody else's event index.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {signEvent} from '../core/events.js';

const dir=path.resolve(process.argv[2]||'./.demo-data');
const stateFile=path.join(dir,'demo-extra-state.json');
const saved=JSON.parse(await readFile(path.join(dir,'demo-state.json'),'utf8'));
let present=null;
try{present=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(present?.version===1){
 console.log('Demo groups/replies already prepared:',present.posts,'publisher',saved.author);
 process.exit(0);
}
const privateKey=JSON.parse(await readFile(path.join(dir,'demo-identity.private.json'),'utf8'));
const id={author:privateKey.author,
  privateKey:await crypto.subtle.importKey('pkcs8',Buffer.from(privateKey.privateKey,'base64url'),'Ed25519',false,['sign'])};
const entries=[];
const stamp=Date.UTC(2026,10,18,14,0);
const groups=[
 {name:'Photography Circle',description:'An experimental open group for people sharing images, meetups and creative discussions. Following this charter is voluntary.',governance:'democracy',quorum:{numerator:50,denominator:100}},
 {name:'Commons Documentation Guild',description:'Experimental group for improving shared documentation and auditing open moderation. The group does not own any space.',governance:'democracy',quorum:{numerator:67,denominator:100}}
];
for(let i=0;i<groups.length;i++)
 entries.push(await signEvent(id,{kind:'group',space:'groups',body:groups[i],time:stamp+i*1000}));
const comments=[
 {parent:saved.eventIds[0],text:'A first signed example comment. The reply rail should align to its own text; there is no administrator-only database for discussion.'},
 {parent:saved.eventIds[0],text:'This example has an actual cryptographic signature. Your reply here will be a separate signed event.'},
 {parent:saved.eventIds[1],text:'The date and location above are structured fields, not just an image-board label.'},
 {parent:saved.eventIds[7],text:'Different people can propose different presentation and moderation rules. None of these suggestions owns this public space.'}
];
for(let i=0;i<comments.length;i++)
 entries.push(await signEvent(id,{kind:'reply',space:'demo',
   body:{parent:comments[i].parent,title:'',text:comments[i].text},time:stamp+2000+i*1000}));
entries.push(await signEvent(id,{kind:'reaction',space:'demo',
 body:{target:saved.eventIds[0],value:2},time:stamp+9000}));
entries.push(await signEvent(id,{kind:'poll-choice',space:'demo',
 body:{target:saved.eventIds[2],option:1},time:stamp+10000}));
entries.push(await signEvent(id,{kind:'tag-vote',space:'demo',
 body:{target:saved.eventIds[0],tag:'cats',value:1},time:stamp+11000}));
await writeFile(path.join(dir,'demo-extra-records.jsonl'),entries.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
await writeFile(stateFile,JSON.stringify({version:1,posts:entries.length,groups:2,
 eventIds:entries.map(x=>x.id),author:id.author},null,2)+'\n',{mode:0o600});
console.log('Prepared '+entries.length+' additional signed demo records, '+groups.length+' groups and '+comments.length+' threaded comments');