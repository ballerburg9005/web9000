# WEB9000 — operator-optional IPFS source snapshots and compact CIDR lookup

**2026-11-20. Prototype only. GitHub repository / isolated tests; hosted WEB9000 peer unchanged.**

This extends [source-feed refresh and signed provenance](SOURCE-REFRESH-PROVENANCE-2026-11-20.md). The architecture is browser-first for signed posts, with *optional independent libp2p/Helia archive nodes for raw data-source snapshots*. No Nginx dependency, no central archive registry, no automatic snapshot publication and **no additional OrbitDB database**. The user-selected operator cap remains **20 newly created physical OrbitDB databases**. The default subscription loader also keeps at most 20 active; historical signed directory addresses remain separately reopenable.

## Independently retrievable original data

The previous audit trail signed upstream HTTPS URLs and SHA-256 hashes, but those upstream URLs may expire or change. A signed SHA-256 alone does not let a future observer recover historical source bytes. Two new Node-only CLI utilities provide an explicit, optional content-addressed alternative:

- **source-snapshot-archive.mjs prepare** verifies every operator-selected source file against the existing SHA-256-pinned private staging manifest, then stores its unchanged bytes as a UnixFS DAG in a *new* private LevelDB/Helia blockstore. The generated CID is deterministic for identical input and valid even when the original HTTP source disappears. It writes a **new** private source manifest where each source also has an optional archiveCid, and a private allowlist of roots and their UnixFS children. It **never overwrites** an existing archive blockstore, private key, running peer or source manifest. It binds no new source opinions or permissions to a universal server.
- **source-snapshot-archive.mjs serve** separately starts an explicitly authorized IPFS Bitswap provider from that archive store. The safe default binds only to 127.0.0.1; an operator can deliberately specify another literal IPv4 bind address, after reviewing upstream licensing and the public exposure. The provider uses WEB9000's existing outbound quarantine/manifest policy to refuse unrelated raw/DAG-PB blocks; no hidden OrbitDB subscription is created. An operator must separately share its libp2p peer multiaddress with interested readers or mirrors. No DHT/provider discovery or public IPFS gateway is invented.
- **source-snapshot-fetch.mjs fetch** independently verifies the original signed source-data provenance against an explicitly pinned Ed25519 observer identity, then connects to the operator-selected libp2p Bitswap provider and retrieves only the CID declared for that source. The reader verifies both the UnixFS DAG/CID and the *entire original source-file SHA-256 and byte count* from the signed provenance. It materializes the requested file **only after** all checks and never overwrites an existing local file. It does not contact the original HTTP URL. A second volunteer provider can carry the exact same CID after the first provider stops.

## Example operator flow

Choose source copyright and redistribution rules before publishing any original data, especially databases built from third-party provider inputs. These tools cannot establish redistribution rights.

The following paths are examples outside the public WEB9000 website root. The operator previously staged a reviewed sources.json and generated rules.json:

~~~bash
cd /srv/web9000/source/v2/network

# Create a NEW private UnixFS archive store and an amended private source
# manifest. Original sources.json, provider files, and signing key untouched.
node source-snapshot-archive.mjs prepare \
  /private/source-staging/source-refresh-XXXXXX/sources.json \
  /private/source-archive-20261120 \
  /private/sources-with-cids.json

# Only if the operator deliberately chooses to publish these source bytes:
# By default the provider listens on LOOPBACK and cannot be reached from
# another computer without operator-configured connectivity.
node source-snapshot-archive.mjs serve \
  /private/source-archive-20261120 14001 127.0.0.1

# A public provider must EXPLICITLY choose a public bind address, firewall
# rules and an independently reachable advertised libp2p multiaddress.
# This is optional and subject to redistribution rights.

# The source data CID is now included in the operator-signed provenance,
# not in any authoritative moderation command:
node source-feed-operator.mjs update \
  /private/observer.json /private/rules.json \
  --sources /private/sources-with-cids.json
~~~

Readers obtain the **original signed source-data provenance JSON** from the expandable source-provenance inspector in Classic or the dashboard, or from a trusted archive of that signed document. The reader must separately pin the exact operator identity and choose an actual serving libp2p peer. The signed archiveCid itself is only a hash commitment; it is **not an assertion of permanent network availability**.

Example retrieval, without contacting the original data publisher:

~~~bash
node source-snapshot-fetch.mjs fetch \
  /private/signed-public-provenance.json \
  ed25519:PINNED_OPERATOR_PUBLIC_KEY \
  0 \
  /ip4/127.0.0.1/tcp/14001/p2p/PROVIDER_PEER_ID \
  /private/recovered-original-source.tsv.gz
~~~

This uses the first source record (index 0) from the signed provenance; other source indices are valid up to 7. Remote IP addresses require a reachable direct libp2p TCP connection; the illustrative loopback multiaddress works only on the same machine. There is no HTTPS gateway fallback and no silent browser media fetching.

To mirror: a second operator may deliberately retrieve verified original bytes, build its own archive from the same bytes, and serve the **same CID** under its own libp2p peer identity. The original signed record stays valid even if a particular serving peer is offline. Clients can select another provider independently. The existing media quarantine policy allows a provider to stop offering specific archive roots without revoking anyone else's copies.

## Security boundaries and tests

- Private snapshot bytes are validated against the operator's declared SHA-256 and byte count **before** inclusion. UnixFS is read back and rehashed before a root is offered. A mismatching snapshot fails without leaving a partly published archive store.
- source-provenance.js accepts a new **optional archiveCid** in a signed source record. Old source provenance records with no archiveCid remain valid. The public statement contains no private filesystem paths. A forged or altered archive CID invalidates the operator's original signature.
- The archive store is dedicated to this data, under the operator's explicit choice. The Bitswap provider serves only listed UnixFS roots and their raw/DAG-PB child blocks; unrelated test blocks are refused, and WEB9000's existing local quarantine remains available. This is an optional separate provider, not a global archive censor.
- Reader fetches are opt-in, capped at the signed source length / 128 MiB, checked against a pinned public operator identity and original source SHA-256, then published to a new destination by atomic exclusive materialization. Bad signatures and collisions are rejected. Remote providers cannot make the reader overwrite an unrelated local file.
- A real local two-peer test produced matching CIDs on two **independent source-archive blockstores**, fetched the original ~1 MiB test file via Helia/libp2p Bitswap, verified bytes + SHA-256 against the signed record, stopped the first provider, and repeated the fetch from the second provider with the identical CID. No shared OrbitDB authority or existing hosted peer was needed.

This is not yet a browser-native libp2p client. Browsers may inspect the signed CID using existing UI but the raw source snapshots are **not automatically downloaded** on page load or sync. Browser clients can use IPFS-aware software and a voluntary archive provider, while original WEB9000 signed publications remain usable even without archive availability.

## More compact accepting-peer prefix index

The IPv4/IPv6 network-source classifier in source-feed.js now indexes prefixes by **numeric keys and prefix length** rather than formatting a fresh 30–60-character string for every CIDR prefix and every connection.

The operator's IPv4 /0–/24 networks fit into exact numeric 32-bit prefixes; its IPv6 /0–/48 networks fit exactly into 48-bit safe JavaScript integers. Longest-match network type, ASN, and country semantics are unchanged; equivalent textual IPv6 prefixes cannot evade duplicate detection. An incoming IPv4 source needs at most 25 numeric probes, IPv6 at most 49.

In the same disposable 131,072-entry synthetic run, accepting-peer index compilation took approximately **0.51 s**, versus **1.075 s** with the earlier string keys. Node's reported heap after prefix-indexing was about **28.94 MiB**, versus **37.19 MiB** previously. Both signed feed and signed provenance were independently validated by real headless Chromium at 0.5 CPU and 512 MiB container limit. However, browser **peak container memory was 443.44 MiB in the newer run**, versus 436.38 MiB previously: this is not an established browser-memory improvement. Further optimization and real mobile-browser testing are still needed.

## What remains open

- Genuine permissionless browser-native libp2p retrieval and discovery instead of explicit provider multiaddresses.
- Independently mirrored archival data must actually be retained and served by willing peers. CID commitments alone do not guarantee replication or durability.
- Original upstream source license and attribution review before rehosting raw IP datasets; no worldwide feed or automatic redistribution is installed.
- 512-MiB container tests are not mobile-browser field benchmarks; memory spikes and network delays need further work.
- Country/ASN/VPN labels remain fallible operator opinions about the **observed ingress hop**, not proof of the author's location, humanity, character or right to publish.

No source archive was installed on the hosted peer and no production data, keys or existing test-artifacts were removed.
