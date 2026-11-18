import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSiteContext} from '../network/site-context.js';
test('host-supplied space and owner only form an optional local view',()=>{
 const author='ed25519:'+'A'.repeat(43);
 const view=readSiteContext('https://a.example/v2/?space=another-sites-space&owner='+author+'&embed=1');
 assert.deepEqual(view,{space:'another-sites-space',preferredAuthor:author,embedded:true});
 assert.equal(readSiteContext('/v2/?owner='+author).preferredAuthor,null);
 assert.equal(readSiteContext('/v2/?space=x&owner=not-a-key').preferredAuthor,null);
});
test('invalid or oversized site hints cannot inject control characters or privileged state',()=>{
 const x=readSiteContext('/v2/?space='+encodeURIComponent('x\nabc')+'&embed=1');
 assert.equal(x.space,null);assert.equal(x.preferredAuthor,null);
 assert.equal(readSiteContext('/v2/?space='+'x'.repeat(181)).space,null);
 assert.equal(readSiteContext('/v2/').space,null);
});
