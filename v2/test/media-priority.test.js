import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MEDIA_BASE_LIMITS,MEDIA_PHYSICAL_LIMITS,mediaPriority,
 mediaMaxForStake,KiB,MiB} from '../core/media-resource-policy.js';
import {validateLocalUploads} from '../core/media.js';
test('small images have reserved first and second priority classes and ordinary 512 KiB cap',()=>{
 const sample=(size,type='image/png')=>({name:'content.png',type,size});
 const expected=[
  [1,'image-50k','tiny',0],
  [50*KiB,'image-50k','tiny',0],
  [50*KiB+1,'image-100k','small',1],
  [100*KiB,'image-100k','small',1],
  [100*KiB+1,'image-256k','standard',2],
  [256*KiB,'image-256k','standard',2],
  [256*KiB+1,'image-512k','standard',4],
  [512*KiB,'image-512k','standard',4],
  [512*KiB+1,'image-1m','heavy',10],
  [MiB,'image-1m','heavy',10]
 ];
 for(const [bytes,name,lane,rank] of expected){
  assert.deepEqual(mediaPriority('image/png',bytes),{name,lane,rank});
  if(bytes<=512*KiB)assert.doesNotThrow(()=>validateLocalUploads([sample(bytes)]));
  else assert.throws(()=>validateLocalUploads([sample(bytes)]),/size limit/);
 }
 assert.equal(mediaPriority('image/png',MiB+1),null);
 assert.equal(MEDIA_BASE_LIMITS['image/png'],512*KiB);
 assert.equal(MEDIA_PHYSICAL_LIMITS['image/png'],MiB);
 assert.doesNotThrow(()=>validateLocalUploads([sample(MiB)],
  {stakeGrantPresent:true}));
});
test('ordinary 4 MiB video, optional 20/100 MiB staked tiers, 3/5/10 MiB priorities',()=>{
 const expectTiers=[
  [MiB,'video-1m','standard',5],
  [3*MiB,'video-3m','heavy',7],
  [4*MiB,'video-4m','heavy',8],
  [5*MiB,'video-5m','heavy',9],
  [10*MiB,'video-10m','heavy',10],
  [20*MiB,'video-20m','heavy',11],
  [100*MiB,'video-100m','heavy',12]
 ];
 for(const [size,name,lane,rank] of expectTiers)
  assert.deepEqual(mediaPriority('video/mp4',size),{name,lane,rank});
 assert.equal(mediaPriority('video/mp4',100*MiB+1),null);
 assert.equal(mediaMaxForStake('video/mp4',0),4*MiB);
 assert.equal(mediaMaxForStake('video/mp4',9999),4*MiB);
 assert.equal(mediaMaxForStake('video/mp4',10000),20*MiB);
 assert.equal(mediaMaxForStake('video/mp4',99999),20*MiB);
 assert.equal(mediaMaxForStake('video/mp4',100000),100*MiB);
 assert.equal(mediaMaxForStake('image/jpeg',10000),MiB);
 assert.equal(mediaMaxForStake('image/jpeg',0),512*KiB);
 assert.equal(mediaMaxForStake('audio/mpeg',100000),10*MiB,
  'unrequested audio expansion must not be inferred from a video bond');
 for(const type of ['video/mp4','video/webm']){
  const four={name:'file',type,size:4*MiB};
  assert.doesNotThrow(()=>validateLocalUploads([four]));
  assert.throws(()=>validateLocalUploads([{...four,size:4*MiB+1}]),/size limit/);
  assert.doesNotThrow(()=>validateLocalUploads([{...four,size:100*MiB}],
   {stakeGrantPresent:true}));
 }
});
