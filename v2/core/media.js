// Pure, browser-and-Node portable representation of ordered mixed attachments.
// IPFS CIDs live in body.media; mediaTypes is parallel signed field metadata.
// Older posts without MIME metadata remain readable as raster-image records.
export const SUPPORTED_MEDIA_TYPES=Object.freeze([
  'image/jpeg','image/png','image/webp','audio/mpeg','audio/ogg','audio/wav',
  'video/mp4','video/webm'
]);
export const MEDIA_FILE_LIMITS=Object.freeze({
  'image/jpeg':262144,'image/png':262144,'image/webp':262144,
  'audio/mpeg':10485760,'audio/ogg':10485760,'audio/wav':10485760,
  'video/mp4':10485760,'video/webm':10485760
});
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
export function validateLocalUploads(files,{existingCount=0}={}){
  if(files.length>6)throw Error('Maximum six mixed-media attachments per post');
  if(!files.length&&!existingCount)return;
  for(const file of files){
    if(!Object.hasOwn(MEDIA_FILE_LIMITS,file.type))
      throw Error('Only JPEG/PNG/WebP, MP3/Ogg/WAV, MP4/WebM are accepted');
    if(!Number.isFinite(file.size)||file.size<1||file.size>MEDIA_FILE_LIMITS[file.type])
      throw Error(file.name+' exceeds the '+(file.type.startsWith('image/')?'256 KiB':'10 MiB')+' size limit');
  }
}