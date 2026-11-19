// Operator-signed, append-only manifest of ALL historical physical OrbitDB
// shard addresses created by the experimental adaptive router.
// A signed directory is an independently verifiable DISCOVERY CLAIM, not a
// global namespace authority, proof of complete history, or a DB writer ACL.
// No network announcement/auto-follow is performed by this module.
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {canonical} from '../core/events.js';
import {openLocalAdaptiveShard} from './adaptive-tier-router.mjs';

export const DIRECTORY_DOMAIN='WEB9000/shard-directory/v1';
const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
const NAME=/^w9-adaptive-[a-z0-9-]{1,120}$/;
const ADDRESS=/^\/orbitdb\/[a-zA-Z0-9]{16,220}$/;
const MAX_BYTES=2*1024*1024;
const MAX_REV=256,MAX_SHARDS=128;
const utf8=new TextEncoder();

function digest(body){
  return createHash('sha256').update(canonical(body),'utf8').digest('hex');
}
function validateEntries(entries){
  if(!Array.isArray(entries)||entries.length>MAX_SHARDS)
    throw Error('Shard directory exceeds bounded entry count');
  const byName=new Set(),byAddress=new Set();
  for(const item of entries){
    if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).sort().join(',')!=='address,name'||
       !NAME.test(item.name)||!ADDRESS.test(item.address)||
       byName.has(item.name)||byAddress.has(item.address))
      throw Error('Invalid, repeated or aliasing shard directory entry');
    byName.add(item.name);byAddress.add(item.address);
  }
  if(entries.some((e,i)=>i>0&&entries[i-1].name>=e.name))
    throw Error('Shard directory entries must be sorted and unique');
}
function validateBody(body,expectedRevision,previousDigest,expectedAuthor){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='changedAt,operator,previous,revision,shards,version'||
    body.version!==1||body.revision!==expectedRevision||
    !AUTHOR.test(body.operator)||body.operator!==expectedAuthor||
    body.previous!==previousDigest||!Number.isSafeInteger(body.changedAt)||
    body.changedAt<0)
    throw Error('Invalid or inconsistent signed shard-directory revision');
  validateEntries(body.shards);
}
function validateAppendOnly(before,after){
  const next=new Map(after.map(item=>[item.name,item.address]));
  for(const item of before){
    if(next.get(item.name)!==item.address)
      throw Error('Shard directory cannot remove or rewrite previous addresses');
  }
}
// A reader MUST pin the chosen operator identity (e.g. from an approved
// peer connection). A signature alone is no guarantee that this operator
// is trustworthy or that the list contains every database in existence.
export async function verifySignedShardDirectory(document,{
  expectedAuthor,minimumRevision=0,expectedDigest=null
}={}){
  if(!AUTHOR.test(expectedAuthor||''))throw Error('Pinned directory signer required');
  if(!document||document.format!==DIRECTORY_DOMAIN||
     !Array.isArray(document.revisions)||
     document.revisions.length<1||document.revisions.length>MAX_REV)
    throw Error('Invalid shard directory format or size');
  if(!Number.isSafeInteger(minimumRevision)||minimumRevision<0||
    minimumRevision>MAX_REV)throw Error('Invalid pinned revision');
  const publicKey=await crypto.subtle.importKey('raw',
    Buffer.from(expectedAuthor.slice(8),'base64url'),'Ed25519',false,['verify']);
  let previous=null,lastEntries=[],lastAt=0;
  for(const [i,item] of document.revisions.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).sort().join(',')!=='body,signature')
      throw Error('Invalid signed directory record');
    const body=item.body;
    validateBody(body,i+1,previous,expectedAuthor);
    if(body.changedAt<lastAt)throw Error('Directory time moved backwards');
    lastAt=body.changedAt;
    validateAppendOnly(lastEntries,body.shards);
    const hash=digest(body);
    let signature;
    try{
      if(typeof item.signature!=='string'||
        !/^[A-Za-z0-9_-]{86}$/.test(item.signature))
        throw Error('Bad base64 signature');
      signature=Buffer.from(item.signature,'base64url');
    }catch{throw Error('Invalid shard-directory signature');}
    const verified=await crypto.subtle.verify('Ed25519',publicKey,signature,
      utf8.encode(DIRECTORY_DOMAIN+'\n'+hash));
    if(!verified)throw Error('Shard-directory signature mismatch');
    previous=hash;lastEntries=body.shards;
  }
  const revision=document.revisions.length;
  if(revision<minimumRevision)throw Error('Stale directory snapshot');
  if(expectedDigest!==null&&expectedDigest!==previous)
    throw Error('Pinned shard directory digest mismatch');
  return {revision,digest:previous,entries:lastEntries.map(e=>({...e})),
    operator:expectedAuthor};
}

export class SignedShardDirectory {
  #file;#signer;#clock;#revisions=[];#latest=new Map();#queue=Promise.resolve();
  constructor({filePath,signer,now=()=>Date.now()}={}){
    if(typeof filePath!=='string'||!path.isAbsolute(filePath)||
       !signer?.privateKey||!AUTHOR.test(signer.author)||typeof now!=='function')
      throw Error('Directory needs absolute local path and independent signing key');
    this.#file=filePath;this.#signer=signer;this.#clock=now;
  }
  async initialize({minimumRevision=0,expectedDigest=null}={}){
    let source;
    try{source=await readFile(this.#file);}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(source){
      if(source.length>MAX_BYTES)throw Error('Shard directory too large');
      const doc=JSON.parse(source.toString('utf8'));
      const valid=await verifySignedShardDirectory(doc,{
        expectedAuthor:this.#signer.author,minimumRevision,expectedDigest
      });
      this.#revisions=doc.revisions;
      this.#latest=new Map(valid.entries.map(e=>[e.name,e.address]));
    }else if(minimumRevision>0||expectedDigest!==null){
      throw Error('Pinned directory missing; refusing to reset');
    }
    return this.status;
  }
  resolve(name){return this.#latest.get(name)||null;}
  get status(){
    const doc=this.exportDocument();
    const last=this.#revisions.at(-1)?.body;
    return {revision:this.#revisions.length,
      digest:last?digest(last):null,operator:this.#signer.author,
      addresses:[...this.#latest].map(([name,address])=>({name,address}))};
  }
  exportDocument(){
    return {format:DIRECTORY_DOMAIN,revisions:JSON.parse(
      JSON.stringify(this.#revisions))};
  }
  async register(name,address){
    // Serialize all updates. There is ONE local operator writer; supporting
    // multiple filesystem writers requires additional locks or consensus.
    const operation=this.#queue.then(async()=>{
      validateEntries([{name,address}]);
      if(this.#latest.has(name)){
        if(this.#latest.get(name)!==address)
          throw Error('Refusing changed address for existing physical shard');
        return this.status;
      }
      if(this.#latest.size>=MAX_SHARDS||this.#revisions.length>=MAX_REV)
        throw Error('Signed shard directory capacity reached');
      const shards=[...this.#latest].map(([n,a])=>({name:n,address:a}));
      shards.push({name,address});
      shards.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
      validateEntries(shards);
      const now=this.#clock();
      const previous=this.#revisions.at(-1)?.body||null;
      if(!Number.isSafeInteger(now)||now<0||now<(previous?.changedAt||0))
        throw Error('Invalid directory observation time');
      const body={version:1,revision:this.#revisions.length+1,
        operator:this.#signer.author,previous:previous?digest(previous):null,
        changedAt:now,shards};
      const hash=digest(body);
      const signature=Buffer.from(await crypto.subtle.sign('Ed25519',
        this.#signer.privateKey,utf8.encode(DIRECTORY_DOMAIN+'\n'+hash)))
        .toString('base64url');
      const doc={format:DIRECTORY_DOMAIN,
        revisions:[...this.#revisions,{body,signature}]};
      const bytes=Buffer.from(JSON.stringify(doc));
      if(bytes.length>MAX_BYTES)throw Error('Signed directory byte budget reached');
      await mkdir(path.dirname(this.#file),{recursive:true});
      const temp=this.#file+'.tmp-'+randomBytes(8).toString('hex');
      try{
        await writeFile(temp,bytes,{flag:'wx',mode:0o600});
        const f=await open(temp,'r');
        try{await f.sync();}finally{await f.close();}
        await rename(temp,this.#file);
        const dir=await open(path.dirname(this.#file),'r');
        try{await dir.sync();}finally{await dir.close();}
      }catch(error){
        // Orphan temporary files can be explicitly cleaned by the operator.
        // No manifest revision is advertised until durable write completes.
        throw error;
      }
      this.#revisions=doc.revisions;
      this.#latest.set(name,address);
      return this.status;
    });
    this.#queue=operation.catch(()=>{});
    return operation;
  }
}

// Helper plugs into AdaptiveTierRouter({openShard}) at explicit operator
// opt-in. On restart, use the directory's original OrbitDB ADDRESS, never
// blindly reopen an old name into a different, empty database.
export function directoryBackedShardOpener({orbitdb,directory}={}){
  if(!orbitdb||!directory?.resolve||!directory?.register)
    throw Error('Directory-backed shard opener requires verified manifest');
  return async name=>{
    const address=directory.resolve(name);
    const shard=await openLocalAdaptiveShard(orbitdb,name,{address});
    try{
      await directory.register(name,shard.address);
    }catch(error){
      await shard.close();
      throw error;
    }
    return shard;
  };
}
