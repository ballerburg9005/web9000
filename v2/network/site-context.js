// URL parameters are only a host's SUGGESTED view of a globally writable
// namespace. They never grant a signer or website any write permissions.
const authorRe=/^ed25519:[A-Za-z0-9_-]{43}$/;
const validSpace=space=>typeof space==='string'&&space.length>0&&space.length<=180&&!/[\x00-\x1f]/.test(space);
export function readSiteContext(value){
  let url;
  try{url=new URL(value,'https://local.invalid/');}catch{return {space:null,preferredAuthor:null,embedded:false};}
  const params=url.searchParams,space=params.get('space');
  const owner=params.get('owner');
  return {
    space:validSpace(space)?space:null,
    preferredAuthor:validSpace(space)&&authorRe.test(owner||'')?owner:null,
    embedded:params.get('embed')==='1'
  };
}
