import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaLanes} from './media-lanes.mjs';

test('saturated heavy-video transports never consume reserved tiny and small image lanes',async()=>{
 const lanes=createMediaLanes(),hold=await lanes.acquire('heavy',12);
 let completed=false;
 await lanes.run('tiny',0,async()=>{completed=true;});
 assert.equal(completed,true);
 const tiny=lanes.stats();
 assert.equal(tiny.heavy.running,1);
 assert.equal(tiny.tiny.running,0);
 let ranLow=false,ranHigh=false;
 const low=lanes.run('heavy',12,async()=>{ranLow=true;return 'low';});
 const high=lanes.run('heavy',7,async()=>{ranHigh=true;return 'high';});
 assert.equal(lanes.stats().heavy.queued,2);
 await assert.rejects(lanes.run('heavy',11,async()=>{}),{status:429});
 hold();
 assert.equal(await high,'high','higher priority gets first released heavy slot');
 assert.equal(await low,'low');
 assert.equal(ranLow&&ranHigh,true);
 assert.equal(lanes.stats().heavy.running,0);
 assert.equal(lanes.stats().heavy.queued,0);
});

test('heavy outbound bytes are paced independently of tiny image delivery',async()=>{
 const lanes=createMediaLanes(),started=performance.now();
 await lanes.takeBytes('heavy',128*1024);
 const tinyStarted=performance.now();
 await lanes.takeBytes('tiny',50*1024);
 assert.ok(performance.now()-tinyStarted<100,
  'tiny image egress has no added media-lane delay');
 await lanes.takeBytes('heavy',512);
 assert.ok(performance.now()-started>=200,
  'heavy video egress is paced at approximately 512 KiB/s');
});
