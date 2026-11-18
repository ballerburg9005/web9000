import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,signEvent} from '../core/events.js';
import {DEFAULT_POLICY} from '../core/policy.js';
import {mirrorDecision} from '../network/mirror-policy.js';
test('cross-index replication is voluntary and scoped, never a global permission gate',async()=>{
 const author=await generateIdentity();
 const event=await signEvent(author,{space:'another-website-namespace',body:{title:'Visible',text:'Body'}});
 const policy={...DEFAULT_POLICY,followedSpaces:['another-website-namespace'],trustedAuthors:[author.author]};
 assert.equal(mirrorDecision(event,[event],policy,null,{enabled:false,spaces:['*']}).mirror,false);
 assert.equal(mirrorDecision(event,[event],policy,null,{enabled:true,spaces:['other-space']}).mirror,false);
 assert.equal(mirrorDecision(event,[event],policy,null,{enabled:true,spaces:['another-website-namespace']}).mirror,true);
});
test('untrusted, blacklisted, labeled, and unrelated metadata are not automatically mirrored',async()=>{
 const author=await generateIdentity(),reviewer=await generateIdentity();
 const post=await signEvent(author,{body:{title:'Text',text:'Hello'}});
 const flag=await signEvent(reviewer,{kind:'label',body:{target:post.id,tag:'spam',reason:'Spam'}});
 const base={...DEFAULT_POLICY,followedSpaces:['commons']};
 const selected={enabled:true,spaces:['commons']};
 assert.equal(mirrorDecision(post,[post],base,null,selected).mirror,false);
 assert.equal(mirrorDecision(post,[post],{...base,trustedAuthors:[author.author]},null,selected).mirror,true);
 assert.equal(mirrorDecision(post,[post,flag],{...base,trustedAuthors:[author.author],reviewerWeights:{[reviewer.author]:1}},null,selected).mirror,false);
 assert.equal(mirrorDecision(post,[post],{...base,blockedAuthors:[author.author],trustedAuthors:[author.author]},null,selected).mirror,false);
 assert.equal(mirrorDecision(flag,[post,flag],base,null,selected).mirror,false);
});
