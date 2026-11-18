import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent,verifyEvent} from '../core/events.js';
import {exportIdentityBackup,importIdentityBackup} from '../core/identity-backup.js';
test('portable identity can be encrypted, imported and sign independent records',async()=>{
  const a=await generateIdentity({extractable:true});
  const saved=await exportIdentityBackup(a,'a-test-password-that-is-long');
  const string=JSON.stringify(saved);
  assert.ok(!string.includes('PRIVATE KEY'));
  assert.ok(!string.includes('"d"'));
  const b=await importIdentityBackup(JSON.parse(string),'a-test-password-that-is-long');
  assert.equal(b.author,a.author);
  const event=await signEvent(b,{space:'other-persons-site',body:{title:'portable',text:'works'}});
  assert.equal(await verifyEvent(event),true);
});
test('incorrect password and tampered backup cannot recover identity',async()=>{
  const a=await generateIdentity({extractable:true});
  const backup=await exportIdentityBackup(a,'long-enough-safe-password');
  await assert.rejects(importIdentityBackup(backup,'wrong-but-long-enough'),/password or tampered/);
  await assert.rejects(importIdentityBackup({...backup,author:'ed25519:'+'A'.repeat(43)},'long-enough-safe-password'));
});
test('legacy non-extractable browser key is never silently disclosed',async()=>{
  const a=await generateIdentity({extractable:false});
  await assert.rejects(exportIdentityBackup(a,'a-very-long-password'),/non-exportable/);
});
test('backup import rejects computationally abusive KDF parameters',async()=>{
  const a=await generateIdentity({extractable:true});
  const backup=await exportIdentityBackup(a,'password-larger-than-twelve');
  await assert.rejects(importIdentityBackup({...backup,kdf:{...backup.kdf,iterations:1e12}},'password-larger-than-twelve'),/Unsupported/);
});
