import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
test('every DOM ID queried by the browser entry module is present in HTML',()=>{
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const app=readFileSync(path.join(dir,'..','app.js'),'utf8');
  const html=readFileSync(path.join(dir,'..','index.html'),'utf8');
  const ids=[...app.matchAll(/\$\(['"]#([a-zA-Z0-9_-]+)['"]\)/g)].map(m=>m[1]);
  assert.ok(ids.length>20);
  const missing=[...new Set(ids)].filter(id=>!html.includes('id="'+id+'"'));
  assert.deepEqual(missing,[]);
});

test('classic board has working controls rather than generic debug-only detail modal',()=>{
 const dir=path.dirname(fileURLToPath(import.meta.url));
 const app=readFileSync(path.join(dir,'..','classic.js'),'utf8');
 const html=readFileSync(path.join(dir,'..','classic.html'),'utf8');
 const ids=[...app.matchAll(/\$\(['"]([a-zA-Z0-9_-]+)['"]\)/g)].map(m=>m[1]);
 assert.ok(ids.length>25);
 assert.deepEqual([...new Set(ids)].filter(x=>!html.includes('id="'+x+'"')),[]);
 for(const name of ['imageGrid','poll','schedule','postDialog','postForm','joinNetwork','showUnverified'])
   assert.ok(html.includes(name),name);
 assert.ok(app.includes('keydown'),'keyboard navigation must not regress');
});
