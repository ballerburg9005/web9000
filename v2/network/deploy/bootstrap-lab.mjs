// Generate fresh DISPOSABLE lab-only signed credentials/config for the
// separately cgroup-capped Docker ingress sandbox. NEVER run against live
// peer data. Creates NEW files only; refuses to overwrite existing secrets.
// Real operator setup must pin independently chosen user/group trust roots.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {generateIdentity,signEvent} from '../../core/events.js';
const dir=process.argv[2];
if(!dir||!path.isAbsolute(dir))throw Error('Need absolute empty sandbox directory');
await mkdir(dir,{recursive:true,mode:0o700});
await mkdir(path.join(dir,'entry-store'),{mode:0o700});
await mkdir(path.join(dir,'protected-store'),{mode:0o700});
async function save(name,obj){
 const file=path.join(dir,name);
 await writeFile(file,JSON.stringify(obj,null,2)+'\n',{flag:'wx',mode:0o600});
}
const operator=await generateIdentity({extractable:true});
const root=await generateIdentity(),invitee=await generateIdentity(),
  outsider=await generateIdentity();
const now=Date.now();
const invitation=await signEvent(root,{kind:'invitation',space:'commons',
 body:{scope:'commons',invitee:invitee.author,expiresAt:now+600000},
 time:now-4000});
const acceptance=await signEvent(invitee,{kind:'accept',space:'commons',
 body:{invitation:invitation.id},time:now-3000});
const entry=await signEvent(outsider,{body:{
 title:'Disposable zero-trust entry example',text:'Signed, unverified metadata'
},time:now-2000});
const protectedPost=await signEvent(invitee,{body:{
 title:'Bilateral signed invitation proof',text:'Verified by independent issuer'
},time:now-1000});
const pkcs8=Buffer.from(await crypto.subtle.exportKey(
 'pkcs8',operator.privateKey)).toString('base64');
await save('issuer.json',{
 issuer:operator.author,pkcs8,
 policy:{roots:[root.author],scope:'commons',minInviteScore:30,
   ttlMs:60000,groupPins:[]}
});
await save('protected-worker.json',{
 mode:'pinned-ingress-capability',issuer:operator.author
});
await save('entry-gateway.json',{
 issuer:operator.author,workers:{
   entry:['http://127.0.0.1:18766']
 }
});
await save('protected-gateway.json',{
 issuer:operator.author,workers:{
   sponsored:['http://127.0.0.1:18766']
 }
});
await save('fixture.json',{
 author:invitee.author,issuer:operator.author,
 proofRequest:{subject:invitee.author,evidence:{
   kind:'bilateral-invitation',events:[invitation,acceptance]
 }},
 entry,protectedPost
});
console.log('SANDBOX_FIXTURE_READY '+JSON.stringify({
 issuer:operator.author,root:root.author,invitee:invitee.author,
 output:dir,files:5,notForProduction:true
}));
