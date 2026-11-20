# WEB9000 browser-first network-source classification — 2026-11-20

**Status: opt-in tested prototype. Existing public peer and OrbitDB data unchanged.**

## Purpose and authority

The peer that DIRECTLY accepts a WEB9000 upload can observe the actual socket IP, consult its own signed country/ASN/VPN/proxy/datacenter rules, and allocate that incoming upload to a separate resource budget. A browser client can then verify the accepting peer's short-lived signed observation, if that reader has chosen to pin that observer's public key.

This is **resource isolation, not a judgment against an author**. The node only observes the uploader's network hop. A forwarded event describes the relay, not necessarily the original author. Original signed event IDs/signatures remain portable and valid on other independently chosen peers regardless of classifications.

## Browser-compatible signing and updates

The shared source-feed.js module validates versioned Ed25519-signed source lists in both ordinary browsers and Node. Each bounded list has a publisher, revision, creation/expiry time (at most seven days), and up to 2,048 rules with CIDR, country (or ZZ), ASN (or AS0), and kind: residential, mobile, VPN, proxy, Tor, datacenter, hosting, relay, unknown. Only IPv4 /24 or broader and IPv6 /48 or broader are allowed, avoiding per-person exact-IP entries. Longest-prefix match wins. All fields, signatures and size bounds are validated locally.

The node's source-feed-operator.mjs tool generates a private 0600 signing identity and an initial signed feed from an operator-supplied rules.json. Later updates are versioned and atomically signed with the SAME identity. The optional node-peer runtime reloads on SIGHUP, rejecting a signing-key change, and broadcasts the newly verified list to connected browser readers.

No worldwide VPN/country database is bundled. The rule list and its accuracy belong to the independent operator. Browsers never auto-download unknown external classifier URLs.

## Classifying an actual accepting socket

The optional sourceObserver on browser-bridge.mjs uses request.socket.remoteAddress, never author-submitted JSON, headers or X-Forwarded-For. X-Real-IP is accepted ONLY if the socket itself belongs to one exact proxy IP explicitly pinned by the operator; untrusted or missing observations classify as unknown.

Before Ed25519 verification or OrbitDB append, local network-group counters limit attempts per minute, with prototype figures:

| Observer source class | Attempts per coarse source network / minute |
| --- | ---: |
| Residential | 120 |
| Mobile | 80 |
| VPN | 12 |
| Proxy or Tor | 8 |
| Datacenter, hosting or relay | 12 |
| Unknown | 16 |

Counters use coarse /24 or /48 network cohorts and country/ASN/type, with bounded in-memory groups and overflow pools. They reset each minute; they never constitute permanent IP or country bans. One exhausted source group does not consume another group's quota. These SMALL lab thresholds require realistic legitimate-traffic calibration before public use.

An accepted original signed record can get a separate source-receipt.js Ed25519 observation: original event ID, observer key, coarse country/ASN/type, hop source, matching signed-list digest, short expiration (up to 10 min). **No raw IP or CIDR is included.** These observations are transient WebSocket metadata, NOT immutable OrbitDB events, and never attest that the author resides in the observed country.

## All browser readers can verify it

The browser-mesh.js transport accepts signed source-feed updates and signed source receipts for a pinned, voluntarily chosen peer. The Classic board's **Choose independent peers** dialog now includes an optional **Signed source-network classifications** area. Enter an exact WebSocket URL and the observer's public ed25519 identity on one line. The reader can choose or decline each observer independently.

The browser verifies feed publisher signature, expiry, locally saved revision/digest, and any event receipt's issuer, event ID, expiry and exact current feed digest. An unpinned, unsigned, mismatched or absent receipt remains **unknown**, regardless of any claimed nation or karma in the post body. Verified country/ASN/category allows browser-local failure domains, with provisional budgets:

| Browser classification | Locally accepted records / minute / compartment |
| --- | ---: |
| General (residential/mobile) | 360 |
| Concentrated (VPN/proxy/Tor/hosting/datacenter/relay) | 48 |
| Unknown from a pinned source | 96 |
| Older unpinned independent peer | Up to 480 per connection |

Each peer also has an absolute 480 signature checks/min cap and 16-frame / 2 MiB outstanding receive queue. When an attested VPN historical page exhausts its category, the browser **defers** its remaining bounded history until the next time window, rather than closing the connection. Other independent categories can still deliver live content. Old signed posts are not deleted and each browser chooses its own local policies.

Signed-list revisions and digests are persisted in local IndexedDB so clients reject stale or equivocating updates across reloads. Observer metadata is short-lived and stored only in a limited in-memory map, not copied into the user's permanent signed post data.

## Operator setup: separate test or new voluntary peer only

Provide operator-owned source rules, e.g. the following **fictional reserved test prefixes** (NOT real geo intelligence):

~~~json
[
  {"cidr":"198.51.100.0/24","country":"DE","asn":"AS64500","networkKind":"vpn"},
  {"cidr":"203.0.113.0/24","country":"US","asn":"AS64501","networkKind":"residential"}
]
~~~

Run on a trusted workstation/node, keeping the private config outside any web root:

~~~sh
cd /srv/web9000/source/v2/network
node source-feed-operator.mjs init /private/observer.json /private/source-rules.json

WEB9000_SOURCE_OBSERVER_FILE=/private/observer.json \
  node node-peer.mjs /private/new-peer-data new-unique-index-name

# Update after operator-vetted source rules change:
node source-feed-operator.mjs update /private/observer.json /private/source-rules.json
kill -HUP <node-peer-process-id>
~~~

The private 0600 JSON includes an Ed25519 signing key; NEVER serve it publicly. Readers need only the operator's public identity, and receive the signed list over the chosen WebSocket connection. If behind a reverse proxy, the operator can explicitly add trustedProxyAddress equal to the one expected proxy socket address; never enable arbitrary forwarded headers.

## Evidence and limitations

Run: npm run test:source-observation. Tests cover real browser WebSocket clients, signed list push/update, forged issuer and headers, expired/tampered receipts, IPv4/IPv6 prefix matching, private key permissions, reader-selected observer pins, source-class saturation with independent category continuity, and initial pre-signature 12-attempt VPN budget while residential traffic still succeeds.

This does NOT supply actual third-party worldwide IP geolocation intelligence, direct browser-native libp2p (the current browser transport uses independently selected WebSocket-accessible peers), IP visibility through third-party relays, strong public-TLS proxy-chain authentication, physical IPFS garbage collection, or network-wide guaranteed retention. A malicious observer may misclassify its own traffic, which is why its opinions only affect willing readers.

The prior Nginx/Docker infrastructure remains an **optional server-peer bonus feature**, never a prerequisite for signed publication, browser content verification or voluntary replication.
