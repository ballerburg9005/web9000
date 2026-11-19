// Local, opt-in network source compartments for the adaptive WEB9000 prototype.
// A compartment is a QUOTA/FAILURE DOMAIN, never a verdict on a person.
// Only code at the network transport's trusted server boundary may call this
// with operator-observed inputs. User-controlled headers/posts cannot certify
// geolocation, ASN, VPN or hosting classification.
//
// Results include only locally keyed opaque bucket IDs, not raw IP/country.
// The same cohort can be routed differently on independently operated peers.
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

const kinds=new Set(['residential','mobile','vpn','proxy','tor','datacenter',
  'hosting','relay','unknown']);
const countryCode=/^[A-Z]{2}$/;
const asnRe=/^AS([1-9][0-9]{0,9})$/;
const ipv4Cidr=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(1[0-9]|2[0-9]|3[0-2]|[0-9])$/;
const ipv6Cidr=/^[0-9a-fA-F:]+\/(\d{1,3})$/;

export function classifyNetworkObservation(observation,{secret}={}){
  if(!Buffer.isBuffer(secret)||secret.length<16)
    throw Error('Local compartment secret required');
  // Fail to a non-specific box without creating potentially malicious
  // per-attacker keys from arbitrary input.
  if(!observation || observation.provenance!=='operator-observed'){
    return Object.freeze({bucket:'general',class:'unknown',
      observationAccepted:false,reason:'unverified-network-origin'});
  }
  const kind=kinds.has(observation.networkKind)?
    observation.networkKind:'unknown';
  // The hosting type is the broadest and most useful resource class,
  // and is independently useful even when IP geolocation is unavailable.
  const country=typeof observation.country==='string'&&
    countryCode.test(observation.country)?observation.country:'ZZ';
  let asn='AS0';
  if(typeof observation.asn==='string'){
    const match=asnRe.exec(observation.asn);
    if(match&&Number(match[1])<=4294967295)asn=observation.asn;
  }
  // Only coarse source network ranges. They must be derived by a trusted
  // ingress observer; no raw individual IP addresses are retained here.
  let range='none';
  if(typeof observation.networkPrefix==='string'){
    const v4=ipv4Cidr.exec(observation.networkPrefix);
    if(v4&&v4.slice(1,5).every(x=>Number(x)<=255)&&Number(v4[5])<=24){
      const prefix=Number(v4[5]);
      const source=v4.slice(1,5).reduce((acc,part)=>((acc<<8)>>>0)+Number(part),0)>>>0;
      const mask=prefix===0?0:(0xffffffff<<(32-prefix))>>>0;
      const network=source&mask;
      // Only accept a correctly normalized network, not arbitrary host
      // addresses that manufacture multiple keys for the same /24.
      if((source>>>0)===(network>>>0))range=observation.networkPrefix;
    }else{
      const v6=ipv6Cidr.exec(observation.networkPrefix);
      if(v6&&Number(v6[1])<=48&&isIP(observation.networkPrefix.split('/')[0])===6)
        range=observation.networkPrefix.toLowerCase();
    }
  }
  // Important: hash from the peer's persistent local random key so
  // physical partition identity can survive a restart. Never publish
  // the secret, the raw IP prefix or its country-tagged source tuple.
  const family=['datacenter','hosting','vpn','proxy','tor','relay'].includes(kind)?
    'concentrated':'general';
  const classification=[kind,country,asn,range].join('|');
  const bucket=createHash('sha256')
    .update('WEB9000/network-compartment/v1\0')
    .update(secret).update('\0').update(classification)
    .digest('hex').slice(0,20);
  return Object.freeze({
    bucket:'c'+bucket,
    class:family,
    observationAccepted:true,
    // No publicly readable country/ASN/IP in returned object.
    reason:'operator-observed-segmentation'
  });
}
