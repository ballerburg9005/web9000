// Verify a WEB9000 signed group-branch proof without contacting any website,
// group operator, federation index, or centralized identity authority.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {verifyGroupProof} from '../core/group-proof.js';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2];
 if(!file){
  console.error('Usage: node verify-group-proof.mjs <downloaded-group-proof.json>');
  process.exitCode=2;
 }else{
  try{
   const bytes=await readFile(file);
   if(bytes.length>2*1024*1024)throw Error('Proof file exceeds 2 MiB');
   const data=JSON.parse(bytes.toString('utf8'));
   const report=await verifyGroupProof(data);
   console.log(JSON.stringify(report,null,2));
   if(!report.valid)process.exitCode=1;
  }catch(error){
   console.error('Group proof verification failed:',error.message);
   process.exitCode=1;
  }
 }
}
