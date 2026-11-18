/**
 * One-time operator seed into the DEMO namespace. Never run this for real
 * namespaces, and never generate fake public content in arbitrary spaces.
 *
 * Workflow: node seed-demo.mjs prepare /data
 *   - exports demo author's Ed25519 signing key only to private /data
 *   - uploads up to 10 image bytes to the separately chosen IPFS image peer
 *   - writes /data/demo-records.jsonl (signed, ready for the peer's stdin)
 *   - writes ./v2/demo.json (public author key, not a moderation authority)
 *
 * Then stop the same operator peer, feed JSONL to the existing node-peer.mjs
 * through its *local operator stdin*, and restart the daemon. This route
 * does NOT bypass global write ACLs; operators may always write to their
 * own unrestricted indexes. The public WebSocket bridge's anti-abuse
 * caps remain intact for remote users.
 */
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateIdentity,signEvent} from '../core/events.js';
import {DEMO_CATALOG} from '../demo-catalog.js';
const data=path.resolve(process.argv[3]||'./.demo-test-data');
const mode=process.argv[2]||'prepare';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const demoConfigFile=path.join(data,'demo-config.json');
const identityFile=path.join(data,'demo-identity.private.json');
const ledgerFile=path.join(data,'demo-records.jsonl');
const stateFile=path.join(data,'demo-state.json');
const maybe=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}};
const b64=bytes=>Buffer.from(bytes).toString('base64url');
if(mode==='prepare'){
  const earlier=await maybe(stateFile);
  if(earlier?.version===1&&earlier?.posts===DEMO_CATALOG.length){
    console.log('Already prepared '+earlier.posts+' signed demo events, author '+earlier.author);
    process.exit(0);
  }
  let privateIdentity=await maybe(identityFile),identity;
  if(!privateIdentity){
    identity=await generateIdentity({extractable:true});
    privateIdentity={
      author:identity.author,
      privateKey:b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',identity.privateKey)))
    };
    await writeFile(identityFile,JSON.stringify(privateIdentity)+'\n',{mode:0o600});
  }else{
    identity={author:privateIdentity.author,
      privateKey:await crypto.subtle.importKey('pkcs8',Buffer.from(privateIdentity.privateKey,'base64url'),
        'Ed25519',false,['sign'])};
  }
  const source=path.resolve(dirname,'../..');
  const mediaEndpoint=process.env.WEB9000_DEMO_MEDIA_URL||'http://127.0.0.1:8788';
  const mediaCids=[];
  let imageIndex=0,uploads=0;
  for(const spec of DEMO_CATALOG){
    if(!spec.imageFile)continue;
    // Limit public test peer write volume; remaining examples reuse real
    // independently stored CIDs rather than inventing inaccessible media.
    if(uploads>=10)break;
    const file=path.join(source,spec.imageFile);
    const contents=await readFile(file);
    if(contents.byteLength>262144)throw Error('Demo thumbnail too large '+file);
    const response=await fetch(mediaEndpoint+'/upload',{
      method:'POST',headers:{'content-type':'image/jpeg'},body:contents
    });
    if(!response.ok)throw Error('Image peer refused demo asset '+file+' status '+response.status+': '+await response.text());
    const {cid}=await response.json();
    if(!/^ipfs:\/\/[A-Za-z0-9]{20,120}$/.test(cid))throw Error('Bad image CID '+cid);
    mediaCids.push(cid);
    uploads++;
  }
  if(!mediaCids.length)throw Error('No IPFS image media uploaded; refusing empty preview');
  const records=[];
  for(const [i,spec] of DEMO_CATALOG.entries()){
    const fields={
      presentation:spec.type,tags:spec.tags,
      demo:true,demoVersion:1,
      ...(spec.schedule?{schedule:spec.schedule}:{}),
      ...(spec.poll?{poll:spec.poll}:{}),
      ...(spec.positions?{positions:spec.positions}:{}),
      ...(spec.price?{price:spec.price}:{}),
      ...(spec.video?{demoVideo:spec.video}:{})
    };
    const media=spec.imageFile?[mediaCids[imageIndex++%mediaCids.length]]:[];
    const body={title:spec.title,text:spec.text,fields,media};
    const event=await signEvent(identity,{
      kind:'post',space:'demo',body,
      time:Date.UTC(2026,10,17,12,0)-i*600000
    });
    records.push(event);
  }
  await writeFile(ledgerFile,records.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
  const manifest={version:1,posts:records.length,author:identity.author,
    eventIds:records.map(e=>e.id),imageCids:mediaCids};
  await writeFile(stateFile,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  await writeFile(demoConfigFile,JSON.stringify({
    version:1,space:'demo',author:identity.author,expected:records.length,
    description:'Operator-signed demonstration posts in the raw decentralized test index. This author is locally suggested for the demo space only; it has no namespace ownership or global moderation rights.',
    galleryPeer:'https://syburg.my.to/web9000/media/'
  },null,2)+'\n');
  console.log('PREPARED '+records.length+' independently signed demo posts with '+mediaCids.length+' real IPFS CID images');
  console.log('DEMO PUBLISHER '+identity.author);
  console.log('PRIVATE FILE '+identityFile+' (never commit or expose)');
  console.log('SIGNED RECORDS '+ledgerFile);
}else if(mode==='verify'){
  const saved=await maybe(stateFile);
  if(!saved)throw Error('Demo state not prepared');
  const {WebSocket}=await import('ws');
  const url=process.env.WEB9000_DEMO_WS_URL||'ws://127.0.0.1:8787/';
  const ws=new WebSocket(url);
  const observed=new Set();
  let cursor=null,batches=0,ok=false;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Demo readback timed out')),25000);
    function cleanup(err){clearTimeout(timer);ws.close();err?reject(err):resolve();}
    ws.on('error',cleanup);
    ws.on('open',()=>ws.send(JSON.stringify({type:'subscribe',spaces:['demo']})));
    ws.on('message',buf=>{
      const msg=JSON.parse(String(buf));
      if(msg.type==='subscribed')ws.send(JSON.stringify({type:'sync',cursor:null,limit:32}));
      if(msg.type==='batch'){
        for(const e of msg.events||[])observed.add(e.id);
        batches++;
        if(msg.next && batches<100)ws.send(JSON.stringify({type:'sync',cursor:msg.next,limit:32}));
        else{ok=true;cleanup();}
      }
    });
  });
  const missing=saved.eventIds.filter(x=>!observed.has(x));
  console.log(JSON.stringify({expected:saved.posts,found:saved.posts-missing.length,missing:missing.length,batches},null,2));
  if(missing.length||!ok)process.exitCode=2;
}else throw Error('Expected prepare or verify');