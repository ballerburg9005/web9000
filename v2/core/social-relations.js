// Personal, reversible relationship labels. No public social graph is sent,
// and these labels NEVER grant network, media, governance or moderation rights.
export const AUTHOR=/^ed25519:[A-Za-z0-9_-]{43}$/;
export const RELATIONS=new Set(['friend','foe']);
export function normalizeRelations(value,ownAuthor=null,{limit=2000}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const results=Object.create(null);
 for(const [author,relation] of Object.entries(value)){
  if(Object.keys(results).length>=limit)break;
  if(AUTHOR.test(author)&&author!==ownAuthor&&RELATIONS.has(relation))
    results[author]=relation;
 }
 return results;
}
export function setRelation(current,ownAuthor,author,relation,{limit=2000}={}){
 if(!AUTHOR.test(author)||author===ownAuthor)throw Error('Cannot label your own key or an invalid signing identity');
 if(relation!==null&&!RELATIONS.has(relation))throw Error('Relationship must be friend, foe or unset');
 const result=normalizeRelations(current,ownAuthor,{limit});
 if(relation===null)delete result[author];
 else{
  if(!(author in result)&&Object.keys(result).length>=limit)
    throw Error('Personal friend/foe list is full');
  result[author]=relation;
 }
 return result;
}
export const relationFor=(relations,author)=>relations?.[author]||null;
