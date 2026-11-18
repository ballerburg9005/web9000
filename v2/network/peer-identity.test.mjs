import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadOrCreatePeerKey} from './peer-identity.mjs';
test('peer identity persists across restart, without any authority over signed content',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-peerid-'));
 try{
  const a=await loadOrCreatePeerKey(dir),b=await loadOrCreatePeerKey(dir);
  assert.deepEqual(Buffer.from(a.publicKey.raw),Buffer.from(b.publicKey.raw));
  const info=await stat(path.join(dir,'peer-private-key.pb'));
  assert.equal(info.mode&0o077,0,'peer private key must not be group/world readable');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent initializations never silently replace the persisted private key',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-peer-race-'));
 try{
  const [a,b]=await Promise.all([loadOrCreatePeerKey(dir),loadOrCreatePeerKey(dir)]);
  assert.deepEqual(Buffer.from(a.publicKey.raw),Buffer.from(b.publicKey.raw));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('corrupt private key stops the peer instead of creating a new identity',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-peer-corrupt-'));
 const filename=path.join(dir,'peer-private-key.pb');
 try{
  await writeFile(filename,Buffer.alloc(48,0xff),{mode:0o600});
  const before=await readFile(filename);
  await assert.rejects(loadOrCreatePeerKey(dir),/Corrupt existing peer identity/);
  const after=await readFile(filename);
  assert.deepEqual(after,before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
