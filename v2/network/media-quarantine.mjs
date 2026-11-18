// Operator-local, revocable CID serving quarantine. A voluntary media host
// refuses its own HTTP delivery; no signed record or independent IPFS mirror
// is modified. This is NOT an abuse scanner or a network-wide takedown.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CID} from 'multiformats/cid';

export function normalizeQuarantineCID(value){
  if(typeof value!=='string')throw Error('CID must be a string');
  const raw=value.startsWith('ipfs://')?value.slice(7):value;
  if(raw.length>120||raw.length<20)throw Error('Invalid CID length');
  return CID.parse(raw).toString();
}
export async function readOperatorQuarantine(file){
  let content;
  try{content=await readFile(file,'utf8');}
  catch(error){if(error.code==='ENOENT')return new Map();throw error;}
  if(content.length>512*1024)throw Error('Quarantine file too large');
  const data=JSON.parse(content);
  if(!data||data.version!==1||!Array.isArray(data.blocked)||data.blocked.length>10000)
    throw Error('Invalid operator quarantine format');
  const blocked=new Map();
  for(const item of data.blocked){
    if(!item||typeof item.reason!=='string'||item.reason.length<1||item.reason.length>500)
      throw Error('Invalid operator quarantine entry');
    const cid=normalizeQuarantineCID(item.cid);
    blocked.set(cid,{
      cid,reason:item.reason,
      recordedAt:typeof item.recordedAt==='string'?item.recordedAt:null
    });
  }
  return blocked;
}
async function writeOperatorQuarantine(file,blocked){
  await mkdir(path.dirname(file),{recursive:true});
  const payload=JSON.stringify({version:1,blocked:[...blocked.values()]},null,2)+'\n';
  const tmp=file+'.tmp-'+process.pid;
  await writeFile(tmp,payload,{mode:0o600});
  await rename(tmp,file);
}
export async function changeOperatorQuarantine({file,action,cid,reason}){
  if(!['add','remove'].includes(action))throw Error('Choose add or remove');
  const id=normalizeQuarantineCID(cid);
  const blocked=await readOperatorQuarantine(file);
  if(action==='add'){
    if(typeof reason!=='string'||!reason.trim()||reason.length>500)
      throw Error('A reason is required (maximum 500 characters)');
    blocked.set(id,{cid:id,reason:reason.trim(),recordedAt:new Date().toISOString()});
  }else blocked.delete(id);
  await writeOperatorQuarantine(file,blocked);
  return {cid:id,blocked:blocked.has(id),count:blocked.size};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [action,file,cid,...words]=process.argv.slice(2);
  if(action==='list'&&file){
    const items=await readOperatorQuarantine(file);
    console.log(JSON.stringify([...items.values()],null,2));
  }else if(['add','remove'].includes(action)&&file&&cid){
    console.log(JSON.stringify(await changeOperatorQuarantine({
      action,file,cid,reason:words.join(' ')
    })));
  }else{
    console.error('Usage: node media-quarantine.mjs add <quarantine-file> <CID> "<operator reason>"');
    console.error('       node media-quarantine.mjs remove <quarantine-file> <CID>');
    console.error('       node media-quarantine.mjs list <quarantine-file>');
    process.exitCode=2;
  }
}
