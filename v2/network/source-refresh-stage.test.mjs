import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {stageSourceRefresh,validateRefreshPlan} from './source-refresh-stage.mjs';
import {readVerifiedSourceSnapshots} from './source-provenance-files.mjs';

const iptoasn='198.51.100.0\t198.51.100.255\t64500\tDE\tExample provider\n';
const vpn='198.51.0.0/16\n';
const plan={transform:'web9000-source-feed-import/v1;countries=DE;baseline=unknown',
 sources:[
  {category:'iptoasn',uri:'https://source.example/iptoasn.tsv.gz',
   license:'PDDL-1.0'},
  {category:'vpn',uri:'https://vpn.example/vpn4.txt',license:'MIT'}
 ]};
const hash=data=>createHash('sha256').update(data).digest('hex');
test('staging fetches exact reviewed HTTPS inputs with SHA256, never signs or publishes',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'w9-refresh-staging-'));
 try{
  const seen=[];
  const expected={
   'https://source.example/iptoasn.tsv.gz':iptoasn,
   'https://vpn.example/vpn4.txt':vpn
  };
  const fetched=async (uri,options)=>{
   seen.push({uri,...options});
   assert.equal(options.redirect,'error');
   assert.equal(options.method,'GET');
   assert.equal(options.headers['accept-encoding'],'identity');
   return new Response(expected[uri],{
    status:200,headers:{'content-length':String(Buffer.byteLength(expected[uri]))}
   });
  };
  const {directory,sourcesFile,manifest}=await stageSourceRefresh(
   plan,base,{fetchImpl:fetched,now:()=>1730000000000});
  assert.equal(seen.length,2);
  assert.equal((await stat(directory)).mode&0o077,0);
  assert.equal(manifest.sources.length,2);
  assert.ok(manifest.sources[0].file.endsWith('.gz'));
  assert.equal(manifest.sources[0].sha256,hash(iptoasn));
  assert.equal(manifest.sources[1].sha256,hash(vpn));
  assert.equal((await readFile(manifest.sources[1].file,'utf8')),vpn);
  const checked=await readVerifiedSourceSnapshots(sourcesFile,{
   now:1730000000000});
  assert.equal(checked.sources.length,2);
  assert.ok(!JSON.stringify(checked).includes(directory));
 }finally{await rm(base,{recursive:true,force:true});}
});
test('staging rejects redirects, local source URLs, too-large content and leaves no partial draft',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'w9-refresh-refuse-'));
 try{
  assert.throws(()=>validateRefreshPlan({
   ...plan,sources:[{category:'vpn',uri:'http://insecure.example/1.txt',
    license:'MIT'}]
  }),/HTTPS/);
  assert.throws(()=>validateRefreshPlan({
   ...plan,sources:[plan.sources[0],plan.sources[0]]
  }),/Duplicated/);
  for(const impl of [
   async()=>new Response(null,{status:302,headers:{location:'https://redirect.invalid/other'}}),
   async()=>new Response('small',{status:200,
    headers:{'content-length':String(200*1024*1024)}}),
   async()=>new Response('',{status:200})
  ]){
   await assert.rejects(stageSourceRefresh({
    transform:'test-manual-plan',sources:[plan.sources[0]]
   },base,{fetchImpl:impl}));
   assert.equal((await readdir(base)).length,0,
    'failure must not leave a staged snapshot accepted as safe to sign');
  }
 }finally{await rm(base,{recursive:true,force:true});}
});
