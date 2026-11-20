import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {signSourceFeed,verifySourceFeed,classifyObservedIp} from './source-feed.js';
import {generateIdentity} from '../core/events.js';

const program=new URL('./source-feed-import.mjs',import.meta.url).pathname;
const run=options=>{
 const args=[program];
 for(const [k,v] of Object.entries(options))args.push('--'+k,String(v));
 return spawnSync(process.execPath,args,{encoding:'utf8',timeout:12000});
};
test('offline imported country/ASN ranges coexist with broader VPN classification without widening small prefixes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-import-intel-'));
 try{
  const asn=path.join(dir,'source.tsv.gz'),
   vpn=path.join(dir,'vpn.txt'),tor=path.join(dir,'tor.txt'),
   output=path.join(dir,'rules.json');
  const original=[
   '198.51.100.0\t198.51.101.255\t64500\tDE\tOperator label',
   '198.51.102.0\t198.51.102.31\t64501\tDE\tToo small for /24',
   '203.0.113.0\t203.0.113.255\t64502\tUS\tUnrelated country',
   '2001:db8::\t2001:db8:0:ffff:ffff:ffff:ffff:ffff\t64503\tDE\tIPv6 wider'
  ].join('\n')+'\n';
  await writeFile(asn,gzipSync(original));
  await writeFile(vpn,'198.51.0.0/16\n198.51.102.1/32\n');
  await writeFile(tor,'2001:db8::/32\n');
  const result=run({iptoasn:asn,vpn,tor,countries:'DE',output});
  assert.equal(result.status,0,result.stderr);
  const stats=JSON.parse(result.stdout);
  assert.ok(stats.skippedSpecific>=1);
  assert.equal(stats.skippedCountry,1);
  const rules=JSON.parse(await readFile(output,'utf8'));
  assert.ok(rules.some(x=>x.cidr==='198.51.100.0/23'&&
    x.country==='DE'&&x.asn==='AS64500'));
  assert.ok(!rules.some(x=>x.cidr==='198.51.102.0/24'),
    'the 198.51.102.0/27 sample must NOT be broadened to /24');
  const signer=await generateIdentity();
  const time=Date.now();
  const document=await signSourceFeed(signer,{
    version:1,revision:1,issuedAt:time-1000,expiresAt:time+86400000,rules
  });
  const verified=await verifySourceFeed(document,{
    expectedIssuer:signer.author,now:time
  });
  assert.equal(verified.valid,true,verified.reason);
  assert.deepEqual(classifyObservedIp('198.51.100.1',verified),{
   networkKind:'vpn',country:'DE',asn:'AS64500',
   matched:true,reason:'verified-operator-source-feed'
  });
  assert.equal(classifyObservedIp('198.51.102.10',verified).networkKind,'vpn');
  assert.equal(classifyObservedIp('198.51.102.10',verified).asn,'AS0',
   'do not claim the skipped narrow network belongs to a known ASN');
  assert.equal(classifyObservedIp('203.0.113.42',verified).networkKind,'unknown',
   'country filter intentionally excludes US baseline');
  assert.equal(classifyObservedIp('2001:db8::1',verified).networkKind,'tor');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offline importer refuses missing output, unsafe files and zero accurately representable CIDRs',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'w9-import-invalid-'));
 try{
  const vpn=path.join(dir,'narrow.txt'),out=path.join(dir,'out.json');
  await writeFile(vpn,'192.0.2.1/32\n');
  const result=run({vpn,output:out});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/No accurately represented source networks/);
  const invalid=run({vpn:'/does/not/exist',output:out});
  assert.notEqual(invalid.status,0);
  const noSource=run({output:out});
  assert.notEqual(noSource.status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
