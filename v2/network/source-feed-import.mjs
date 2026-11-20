// Offline bounded importer: optional operator-supplied IPtoASN TSV/TSV.gz
// and CIDR-only VPN / datacenter / Tor lists. NO outbound HTTP requests.
// It never rounds a more-specific source net UP to a coarse prefix, as
// doing that would label unrelated neighboring IPs falsely.
//
// Typical use:
//   node source-feed-import.mjs --iptoasn /data/ip2asn-v4.tsv.gz \
//      --vpn /data/vpn-ipv4.txt --datacenter /data/datacenter-ipv4.txt \
//      --countries DE,FR --output /private/source-rules.json
//
// The output remains an UNTRUSTED local draft. Sign it separately with
// source-feed-operator.mjs after reviewing data sources and licenses.
import {createReadStream} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {randomBytes} from 'node:crypto';
import {isAbsolute,dirname} from 'node:path';
import {parseNetworkIp,normalizeNetworkCidr} from './source-feed.js';
import {MAX_FEED_RULES} from './source-feed-bundle.js';

const allowed=['--iptoasn','--vpn','--datacenter','--tor','--proxy',
 '--countries','--output','--baseline-kind'];
const provided={};
for(let i=2;i<process.argv.length;i+=2){
 const k=process.argv[i],v=process.argv[i+1];
 if(!allowed.includes(k)||provided[k]!==undefined||
    typeof v!=='string'||v.startsWith('--'))
  throw Error('Unknown/duplicate argument or missing value: '+k);
 provided[k]=v;
}
const output=provided['--output'];
const sources=['--iptoasn','--vpn','--datacenter','--tor','--proxy'];
if(!output||!isAbsolute(output)||!sources.some(k=>provided[k]))
 throw Error('Need --output /absolute/file.json and at least one local dataset');
for(const k of sources)
 if(provided[k]&&!isAbsolute(provided[k]))
  throw Error('Dataset path must be absolute: '+k);
const countries=provided['--countries']?
 new Set(provided['--countries'].split(',').map(x=>x.trim().toUpperCase())):null;
if(countries&&[...countries].some(c=>!/^[A-Z]{2}$/.test(c)))
 throw Error('Invalid country filter');
const baseline=provided['--baseline-kind']??'unknown';
if(!['unknown','residential'].includes(baseline))
 throw Error('Baseline must be unknown or explicitly presumed residential');

const toBig=ip=>ip.bytes.reduce((num,b)=>num*256n+BigInt(b),0n);
const fromBig=(num,version)=>{
 const n=version===4?4:16,bytes=new Array(n);
 for(let i=n-1;i>=0;i--){bytes[i]=Number(num&255n);num>>=8n;}
 if(version===4)return bytes.join('.');
 const groups=[];
 for(let i=0;i<16;i+=2)
  groups.push(((bytes[i]<<8)|bytes[i+1]).toString(16));
 return groups.join(':');
};
function* CIDRsOfRange(startIp,endIp){
 const start=parseNetworkIp(startIp),end=parseNetworkIp(endIp);
 if(!start||!end||start.version!==end.version)
  throw Error('Invalid input IP range endpoints');
 const width=start.version===4?32:128,minimum=start.version===4?24:48;
 const left=toBig(start),right=toBig(end);
 if(left>right)throw Error('Descending IP range');
 let current=left;
 while(current<=right){
  let host=0;
  while(host<width){
   const next=1n<<BigInt(host+1);
   if(current%next!==0n||current+next-1n>right)break;
   host++;
  }
  const prefix=width-host;
  // Do not transform a /25 into /24 or an IPv6 /64 into /48:
  // the resulting classification would include innocent neighbors.
  if(prefix<=minimum)
   yield fromBig(current,start.version)+'/'+prefix;
  current+=1n<<BigInt(host);
 }
}
async function* lines(file){
 const stream=createReadStream(file);
 const data=file.endsWith('.gz')?stream.pipe(createGunzip()):stream;
 let count=0;
 try{
  for await(const raw of createInterface({input:data,crlfDelay:Infinity})){
   if(++count>1500000)throw Error('Source line budget exceeded');
   if(raw.length>8192)throw Error('Oversized source row');
   const line=raw.trim();
   if(!line||line.startsWith('#'))continue;
   yield line;
  }
 }finally{stream.destroy();data.destroy();}
}
const rules=new Map(),sourceStats={};
let skippedSpecific=0,skippedCountry=0;
function add(cidr,props,{overlay=false}={}){
 const key=normalizeNetworkCidr(cidr);
 if(!key){skippedSpecific++;return;}
 const parsed=parseNetworkIp(cidr.slice(0,cidr.lastIndexOf('/')));
 const limit=parsed.version===4?24:48;
 const bits=Number(cidr.slice(cidr.lastIndexOf('/')+1));
 if(bits>limit){skippedSpecific++;return;}
 const old=rules.get(key);
 if(old&&overlay){
  rules.set(key,{...old,networkKind:props.networkKind});
 }else if(old){
  if(old.country!==props.country||old.asn!==props.asn)
   throw Error('Conflicting IPtoASN metadata for identical network prefix '+cidr);
 }else{
  if(rules.size>=MAX_FEED_RULES)
   throw Error('More than '+MAX_FEED_RULES+' distinct CIDRs. Filter countries, split operator feeds, or choose a smaller dataset. Never truncate silently.');
  rules.set(key,{cidr,networkKind:props.networkKind,
   country:props.country,asn:props.asn});
 }
}
if(provided['--iptoasn']){
 let linesRead=0,generated=0;
 for await(const line of lines(provided['--iptoasn'])){
  const cols=line.split('\t');
  if(cols.length<4)throw Error('Expected IPtoASN TSV: range_start, range_end, ASN, country, description');
  const [start,end,asnRaw,countryRaw]=cols;
  const country=/^[A-Z]{2}$/.test(countryRaw)?countryRaw:'ZZ';
  if(countries&&!countries.has(country)){skippedCountry++;continue;}
  const asnValue=String(asnRaw).replace(/^AS/i,'');
  const asn=/^(?:0|[1-9][0-9]{0,9})$/.test(asnValue)&&
    Number(asnValue)<=4294967295?'AS'+asnValue:'AS0';
  for(const cidr of CIDRsOfRange(start,end)){
   add(cidr,{networkKind:baseline,country,asn});generated++;
  }
  linesRead++;
 }
 sourceStats.iptoasn={rows:linesRead,generated};
}
for(const [argument,kind] of [
 ['--vpn','vpn'],['--datacenter','datacenter'],
 ['--tor','tor'],['--proxy','proxy']
]){
 if(!provided[argument])continue;
 let read=0,applied=0;
 for await(const line of lines(provided[argument])){
  const cidr=line.split(/\s+#/)[0].trim();
  const ipcidr=cidr.includes('/')?cidr:null;
  if(!ipcidr)throw Error('Expected CIDR per line in '+argument);
  const net=normalizeNetworkCidr(ipcidr);
  if(!net){skippedSpecific++;continue;}
  const p=parseNetworkIp(ipcidr.slice(0,ipcidr.lastIndexOf('/')));
  const limit=p.version===4?24:48;
  const bits=Number(ipcidr.slice(ipcidr.lastIndexOf('/')+1));
  if(bits>limit){skippedSpecific++;continue;}
  add(ipcidr,{networkKind:kind,country:'ZZ',asn:'AS0'},{overlay:true});
  applied++;read++;
 }
 sourceStats[kind]={rows:read,applied};
}
if(rules.size===0)throw Error('No accurately represented source networks');
const assembled=[...rules.values()];
const wire=JSON.stringify(assembled);
if(Buffer.byteLength(wire)>12*1024*1024)
 throw Error('Rules exceed the signed operator input file size cap');
const temp=output+'.'+randomBytes(6).toString('hex')+'.tmp';
try{
 const h=await open(temp,'wx',0o600);
 try{await h.writeFile(wire+'\n');await h.sync();}finally{await h.close();}
 await rename(temp,output);
 const parent=await open(dirname(output),'r');
 try{await parent.sync();}finally{await parent.close();}
}catch(e){await unlink(temp).catch(()=>{});throw e;}
console.log(JSON.stringify({
 ok:true,output,rules:rules.size,skippedSpecific,skippedCountry,
 sources:sourceStats,baselineKind:baseline,
 notice:'Unsigned operator draft; review source licenses and sign with source-feed-operator.mjs'
}));
