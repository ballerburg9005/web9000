// WEB9000/2 media-provider discovery. Only caller-verified signed events
// should reach claimsFromVerifiedEvents. Claims are hints, NOT proof of
// availability, authorization to contact a host, or instructions to pin.
const CID=/^ipfs:\/\/[A-Za-z0-9]{20,120}$/;
const DAY=86400000;
export function normalizeMediaGateway(raw,{securePage=false}={}){
 if(typeof raw!=='string'||!raw.trim()||raw.length>512)throw Error('Invalid media gateway');
 let u;
 try{u=new URL(raw.trim());}catch{throw Error('Invalid media gateway URL');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||
    u.search||u.hash||!u.hostname)throw Error('Media gateway needs an HTTP(S) URL without credentials or query');
 if(securePage&&u.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))
   throw Error('HTTPS is required for a public media mirror');
 return u.href.replace(/\/$/,'');
}
export function parseMediaGateways(input,{securePage=false,limit=7}={}){
 const urls=String(input||'').split(/[\s,]+/).filter(Boolean);
 if(urls.length>limit)throw Error('Maximum '+limit+' backup media peers');
 return [...new Set(urls.map(x=>normalizeMediaGateway(x,{securePage})))];
}
// Deliberately no external network requests. Index already signature-checks
// these signed records at ingestion. Invalid or superseded claims are ignored.
export function claimsFromVerifiedEvents(events,{cid=null,now=Date.now()}={}){
 if(cid!==null&&!CID.test(cid))return [];
 const byKey=new Map();
 for(const event of events||[]){
  const p=event?.payload,b=p?.body;
  if(p?.kind!=='media-provider'||!b||!Array.isArray(b.cids)||
     !['offer','withdraw'].includes(b.action)||!Number.isSafeInteger(b.expiresAt)||
     !Number.isSafeInteger(p.time)||p.time>now+300000||
     b.expiresAt>p.time+7*DAY||!CID.test(b.cids[0])||
     b.cids.length>32||b.cids.length<1||
     b.cids.some(ref=>!CID.test(ref)))continue;
  let gateway;
  try{gateway=normalizeMediaGateway(b.gateway);}catch{continue;}
  for(const ref of b.cids){
   if(cid!==null&&cid!==ref)continue;
   const k=p.author+'|'+gateway+'|'+ref;
   const prior=byKey.get(k);
   if(!prior||p.time>prior.time||(p.time===prior.time&&event.id>prior.id))
     byKey.set(k,{cid:ref,gateway,author:p.author,time:p.time,
       expiresAt:b.expiresAt,action:b.action,id:event.id});
  }
 }
 return [...byKey.values()].filter(x=>x.action==='offer'&&x.expiresAt>now)
  .sort((a,b)=>b.time-a.time||a.gateway.localeCompare(b.gateway));
}
// Explicitly approved gateway addresses are the ONLY candidates the browser
// may contact. A trusted signer can reorder them to avoid known-missing CIDs;
// even that never authorizes a previously unknown host or a binary download.
export function chooseMediaGateways({cid,preferred,approved=[],claims=[],trustedAuthors=[],
  securePage=false,now=Date.now()}={}){
 if(!CID.test(cid))throw Error('Invalid CID for media source');
 const manuallyApproved=[preferred,...approved].filter(Boolean)
  .map(x=>normalizeMediaGateway(x,{securePage}));
 const unique=[...new Set(manuallyApproved)].slice(0,8);
 const trust=new Set(trustedAuthors);
 const hinted=new Set(claims.filter(x=>x.cid===cid&&x.expiresAt>now&&
   trust.has(x.author)&&unique.includes(x.gateway)).map(x=>x.gateway));
 // Primary selected by reader remains first. Fallback hints only rank backups.
 return [unique[0],...unique.slice(1).sort((a,b)=>
    Number(hinted.has(b))-Number(hinted.has(a)))].filter(Boolean);
}
