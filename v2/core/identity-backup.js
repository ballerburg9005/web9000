// Portable, password-encrypted WEB9000 Ed25519 identity backup.
// Never export unencrypted keys to a file, network or renderer.
const enc=new TextEncoder();
const DEC=new TextDecoder();
const b64=a=>typeof Buffer!=='undefined'?Buffer.from(a).toString('base64url'):btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>{
  if(typeof s!=='string'||! /^[A-Za-z0-9_-]+$/.test(s))throw Error('Invalid backup encoding');
  if(typeof Buffer!=='undefined')return Uint8Array.from(Buffer.from(s,'base64url'));
  return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
};
const MAGIC='WEB9000/identity-backup/v1';
const ITERATIONS=300000;
async function getKey(password,salt,iterations) {
  if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Backup password must be 12–1024 characters');
  const secret=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},secret,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const validAuthor=author=>typeof author==='string' && /^ed25519:[A-Za-z0-9_-]{43}$/.test(author);
export async function exportIdentityBackup(identity,password) {
  if(!identity || !validAuthor(identity.author)||!identity.privateKey)throw Error('Missing identity');
  if(!identity.privateKey.extractable)throw Error('This legacy identity uses a non-exportable key. Keep the original browser profile or migrate to a new identity.');
  const salt=new Uint8Array(16),iv=new Uint8Array(12);
  crypto.getRandomValues(salt);crypto.getRandomValues(iv);
  const key=await getKey(password,salt,ITERATIONS);
  const plain=new Uint8Array(await crypto.subtle.exportKey('pkcs8',identity.privateKey));
  let secret;
  try {
    secret=new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:enc.encode(MAGIC+'\n'+identity.author)
    },key,plain));
  }finally{plain.fill(0);}
  return {format:MAGIC,author:identity.author,kdf:{name:'PBKDF2-SHA256',iterations:ITERATIONS,salt:b64(salt)},
    cipher:{name:'AES-256-GCM',iv:b64(iv),data:b64(secret)}};
}
export async function importIdentityBackup(backup,password) {
  if(!backup||typeof backup!=='object'||Array.isArray(backup)||backup.format!==MAGIC ||
    !validAuthor(backup.author)||backup.kdf?.name!=='PBKDF2-SHA256'||
    !Number.isSafeInteger(backup.kdf.iterations)||backup.kdf.iterations<300000||
    backup.kdf.iterations>1000000||backup.cipher?.name!=='AES-256-GCM')throw Error('Unsupported identity backup');
  const salt=unb64(backup.kdf.salt),iv=unb64(backup.cipher.iv),data=unb64(backup.cipher.data);
  if(salt.length!==16||iv.length!==12||data.length<32||data.length>8192)throw Error('Invalid backup dimensions');
  const key=await getKey(password,salt,backup.kdf.iterations);
  let plain;
  try{
    plain=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv,additionalData:enc.encode(MAGIC+'\n'+backup.author)
    },key,data));
  }catch{throw Error('Incorrect password or tampered backup');}
  try{
    const privateKey=await crypto.subtle.importKey('pkcs8',plain,{name:'Ed25519'},true,['sign']);
    const jwk=await crypto.subtle.exportKey('jwk',privateKey);
    if(!jwk.x||('ed25519:'+jwk.x)!==backup.author)throw Error('Backup key does not match its public identity');
    const publicKey=await crypto.subtle.importKey('raw',unb64(jwk.x),{name:'Ed25519'},true,['verify']);
    return {author:backup.author,privateKey,publicKey};
  }finally{plain.fill(0);}
}
