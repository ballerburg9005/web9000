// Pure, browser-and-Node portable representation of ordered mixed attachments.
// IPFS CIDs live in body.media; mediaTypes is parallel signed field metadata.
// Older posts without MIME metadata remain readable as raster-image records.
export const SUPPORTED_MEDIA_TYPES=Object.freeze([
  'image/jpeg','image/png','image/webp','audio/mpeg','audio/ogg','audio/wav',
  'video/mp4','video/webm'
]);
import {MEDIA_BASE_LIMITS,MEDIA_PHYSICAL_LIMITS,mediaLimitText,
 mediaPriority} from './media-resource-policy.js';
export const MEDIA_FILE_LIMITS=MEDIA_BASE_LIMITS;

export const categoryForType=type=>
  type?.startsWith('audio/')?'audio':type?.startsWith('video/')?'video':'image';
export function choosePrimaryMediaIndex(types,selection=undefined){
  if(!Array.isArray(types)||!types.length)return -1;
  if(Number.isInteger(selection)&&selection>=0&&selection<types.length)return selection;
  // Image-first until the author overrides it: grid remains legible and
  // sounds have no visual thumbnail, but the full gallery is unrestricted.
  const image=types.findIndex(type=>categoryForType(type)==='image');
  if(image>=0)return image;
  const video=types.findIndex(type=>categoryForType(type)==='video');
  return video>=0?video:0;
}
export function mediaItems(body){
  const ids=Array.isArray(body?.media)?body.media:[];
  const types=body?.fields?.mediaTypes||[];
  return ids.map((cid,index)=>({
    cid,type:SUPPORTED_MEDIA_TYPES.includes(types[index])?types[index]:'image/jpeg',
    kind:categoryForType(types[index]||'image/jpeg')
  }));
}
export function primaryMedia(body){
  const items=mediaItems(body);
  const index=choosePrimaryMediaIndex(items.map(item=>item.type),
    body?.fields?.primaryMediaIndex);
  return index<0?null:{...items[index],index};
}
export function validateLocalUploads(files,{existingCount=0,stakeGrantPresent=false}={}){
  if(files.length>6)throw Error('Maximum six mixed-media attachments per post');
  if(!files.length&&!existingCount)return;
  for(const file of files){
    if(!Object.hasOwn(MEDIA_FILE_LIMITS,file.type))
      throw Error('Only JPEG/PNG/WebP, MP3/Ogg/WAV, MP4/WebM are accepted');
    const max=stakeGrantPresent?MEDIA_PHYSICAL_LIMITS[file.type]:
      MEDIA_FILE_LIMITS[file.type];
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>max)
      throw Error(file.name+' exceeds the '+mediaLimitText(file.type,max)+' size limit');
    // A pasted grant is only a claim until the accepting peer independently
    // validates its operator signature, scope, expiry and exact file digest.
    if(file.size>MEDIA_FILE_LIMITS[file.type]&&!stakeGrantPresent)
      throw Error(file.name+' requires a verified operator media entitlement');
    if(!mediaPriority(file.type,file.size))
      throw Error('Unsupported media priority category');
  }
}