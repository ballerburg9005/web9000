// Browser-local test storage. This is NOT a distributed replica or server.
const DB='web9000-v2-offline',VERSION=1;
export function openLocal() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,VERSION);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('items'))d.createObjectStore('items');};
    req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);
  });
}
function action(db,mode,method,key,value) {
  return new Promise((resolve,reject)=>{
    const t=db.transaction('items',mode),s=t.objectStore('items');
    const r=method==='put'?s.put(value,key):s[method](key);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export const getItem=(db,key)=>action(db,'readonly','get',key);
export const setItem=(db,key,value)=>action(db,'readwrite','put',key,value);
