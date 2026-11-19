// Persistently bind a node's data directory to its signed-index mode.
// This prevents environment edits from appearing to erase persistent signed
// history by accidentally selecting a different OrbitDB index address.
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';

export const RAW_INDEX_BINDING='.web9000-signed-raw-index-v1.json';
const bindingVersion=1;
const mustExist=async(file)=>{
  try{await stat(file);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
};

export async function verifyRawIndexSelection({dir,nameOrAddress,signed}={}){
  if(typeof dir!=='string'||!dir||typeof nameOrAddress!=='string'||
     !nameOrAddress||typeof signed!=='boolean')
    throw Error('Raw index selection requires data directory, index name/address, and mode');
  const marker=path.join(dir,RAW_INDEX_BINDING);
  let recorded;
  try{recorded=JSON.parse(await readFile(marker,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw Error(
    'Refusing to use corrupt or unreadable signed index binding: '+error.message);}
  if(recorded!==undefined){
    if(!recorded||typeof recorded!=='object'||recorded.version!==bindingVersion||recorded.mode!=='signed'||
       recorded.nameOrAddress!==nameOrAddress)
      throw Error('Signed index selection differs from this peer data directory binding. Choose the recorded index or a NEW data directory.');
    if(!signed)
      throw Error('Refusing to downgrade a signed-index peer to a legacy raw index. Use a separate data directory.');
    return {mode:'signed',recorded:true,marker};
  }
  if(!signed)return {mode:'legacy',recorded:false,marker};
  // An old data directory often already has a long-lived libp2p key but no
  // new binding marker. It MUST NOT be reinterpreted as a fresh signed
  // database, otherwise the operator can accidentally abandon history.
  if(await mustExist(path.join(dir,'peer-private-key.pb'))||
     await mustExist(path.join(dir,'orbitdb')))
    throw Error('Existing legacy peer data detected. Signed raw indexes require a NEW data directory, or an explicit future migration procedure.');
  const next={version:bindingVersion,mode:'signed',nameOrAddress};
  await writeFile(marker,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});
  return {mode:'signed',recorded:false,marker};
}
