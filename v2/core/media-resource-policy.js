// Portable media size and delivery policy. Binary units, with different
// budgets for small images, ordinary video and independently verified bonds.
// Sizes determine *local resource priority*, never global content legitimacy.
export const KiB=1024,MiB=1024*KiB;
export const MEDIA_MAX_STORAGE=100*MiB;
export const MEDIA_BASE_LIMITS=Object.freeze({
 'image/jpeg':512*KiB,'image/png':512*KiB,'image/webp':512*KiB,
 'audio/mpeg':10*MiB,'audio/ogg':10*MiB,'audio/wav':10*MiB,
 'video/mp4':4*MiB,'video/webm':4*MiB
});
export const MEDIA_PHYSICAL_LIMITS=Object.freeze({
 ...MEDIA_BASE_LIMITS,
 'image/jpeg':MiB,'image/png':MiB,'image/webp':MiB,
 'video/mp4':100*MiB,'video/webm':100*MiB
});
export const VIDEO_STAKE_TIERS=Object.freeze([
 Object.freeze({minUsdCents:0,maxBytes:4*MiB}),
 Object.freeze({minUsdCents:10000,maxBytes:20*MiB}),
 Object.freeze({minUsdCents:100000,maxBytes:100*MiB})
]);
// Lower numbers are offered before higher numbers by the local scheduler.
// Every size category uses its own physical transfer lane, so large files
// cannot fill the reserved small-image delivery capacity.
export function mediaPriority(type,bytes){
 if(!Object.hasOwn(MEDIA_PHYSICAL_LIMITS,type)||
    !Number.isSafeInteger(bytes)||bytes<1||
    bytes>MEDIA_PHYSICAL_LIMITS[type])return null;
 if(type.startsWith('image/')){
  if(bytes<=50*KiB)return Object.freeze({name:'image-50k',rank:0,lane:'tiny'});
  if(bytes<=100*KiB)return Object.freeze({name:'image-100k',rank:1,lane:'small'});
  if(bytes<=256*KiB)return Object.freeze({name:'image-256k',rank:2,lane:'standard'});
  if(bytes<=512*KiB)return Object.freeze({name:'image-512k',rank:4,lane:'standard'});
  return Object.freeze({name:'image-1m',rank:10,lane:'heavy'});
 }
 if(type.startsWith('audio/')){
  if(bytes<=MiB)return Object.freeze({name:'audio-1m',rank:3,lane:'standard'});
  if(bytes<=4*MiB)return Object.freeze({name:'audio-4m',rank:6,lane:'heavy'});
  return Object.freeze({name:'audio-10m',rank:9,lane:'heavy'});
 }
 if(bytes<=MiB)return Object.freeze({name:'video-1m',rank:5,lane:'standard'});
 if(bytes<=3*MiB)return Object.freeze({name:'video-3m',rank:7,lane:'heavy'});
 if(bytes<=4*MiB)return Object.freeze({name:'video-4m',rank:8,lane:'heavy'});
 if(bytes<=5*MiB)return Object.freeze({name:'video-5m',rank:9,lane:'heavy'});
 if(bytes<=10*MiB)return Object.freeze({name:'video-10m',rank:10,lane:'heavy'});
 if(bytes<=20*MiB)return Object.freeze({name:'video-20m',rank:11,lane:'heavy'});
 return Object.freeze({name:'video-100m',rank:12,lane:'heavy'});
}
export function mediaMaxForStake(type,usdCents=0){
 if(!Object.hasOwn(MEDIA_BASE_LIMITS,type))return 0;
 if(!Number.isSafeInteger(usdCents)||usdCents<0)throw Error('Invalid verified stake valuation');
 if(type.startsWith('image/'))return usdCents>=10000?MiB:512*KiB;
 if(!type.startsWith('video/'))return MEDIA_BASE_LIMITS[type];
 return usdCents>=100000?100*MiB:usdCents>=10000?20*MiB:4*MiB;
}
export function mediaLimitText(type,maxBytes=MEDIA_BASE_LIMITS[type]){
 if(!maxBytes)return 'unsupported';
 return maxBytes%MiB===0?(maxBytes/MiB)+' MiB':(maxBytes/KiB)+' KiB';
}
