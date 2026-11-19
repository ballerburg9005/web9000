import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyRawIndexSelection,RAW_INDEX_BINDING} from './raw-index-selection.mjs';

test('a fresh signed raw index directory retains its mode and address across restarts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'web9000-signed-mode-'));
 try{
  const opts={dir,nameOrAddress:'web9000-signed-public',signed:true};
  const first=await verifyRawIndexSelection(opts);
  assert.equal(first.mode,'signed');
  assert.equal(first.recorded,false);
  assert.equal((await stat(first.marker)).mode&0o777,0o600);
  const second=await verifyRawIndexSelection(opts);
  assert.equal(second.recorded,true);
  await assert.rejects(verifyRawIndexSelection({...opts,signed:false}),/downgrade/);
  await assert.rejects(verifyRawIndexSelection({...opts,nameOrAddress:'different-signed-index'}),/differs/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('old peer data remains legacy unless an operator performs an explicit migration',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'web9000-legacy-mode-'));
 try{
  const opts={dir,nameOrAddress:'old-raw',signed:false};
  assert.equal((await verifyRawIndexSelection(opts)).mode,'legacy');
  await writeFile(path.join(dir,'peer-private-key.pb'),'existing-secret-key');
  await assert.rejects(verifyRawIndexSelection({...opts,signed:true}),/Existing legacy peer/);
  await rm(path.join(dir,'peer-private-key.pb'));
  await mkdir(path.join(dir,'orbitdb'));
  await assert.rejects(verifyRawIndexSelection({...opts,signed:true}),/Existing legacy peer/);
  // Cannot erase the binding security check by replacing with a corrupt value.
  await writeFile(path.join(dir,RAW_INDEX_BINDING),'{}');
  await assert.rejects(verifyRawIndexSelection(opts),/differs|corrupt|binding/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
