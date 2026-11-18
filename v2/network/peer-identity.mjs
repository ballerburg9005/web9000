// Persistent libp2p transport identity. Distinct from the browser's
// WEB9000 author identity, any space claim and optional stake wallet.
import {readFile,writeFile,link,unlink,mkdir,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {keys} from '@libp2p/crypto';

export async function loadOrCreatePeerKey(directory) {
  if(typeof directory!=='string'||!directory)throw Error('Peer data directory required');
  await mkdir(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'peer-private-key.pb');
  const load=async()=>{
    const data=await readFile(filename);
    if(data.length<32||data.length>16384)throw Error('Invalid peer key length');
    try{return keys.privateKeyFromProtobuf(data);}
    catch{throw Error('Corrupt existing peer identity; restore its backup rather than silently replacing it');}
  };
  try{return await load();}
  catch(err){if(err.code!=='ENOENT')throw err;}
  const key=await keys.generateKeyPair('Ed25519');
  const tmp=filename+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,keys.privateKeyToProtobuf(key),{flag:'wx',mode:0o600});
  try{
    // Linking an already-written temp file is atomic; two simultaneous
    // invocations will never overwrite each other's peer identity.
    try{await link(tmp,filename);}
    catch(err){if(err.code!=='EEXIST')throw err;}
  }finally{await unlink(tmp);}
  await chmod(filename,0o600);
  return load();
}
