# WEB9000 — multipart signed source intelligence (2026-11-20)

**Status: tested opt-in prototype. Hosted peer not changed.** This extends [Browser source classification](BROWSER-SOURCE-CLASSIFICATION-2026-11-20.md) without adding OrbitDB databases or introducing Nginx as a browser dependency. The owner-selected cap remains 20 new physical databases.

## Signed feed v2 and browser replication

The original single-feed format remains supported (2,048 CIDRs / 160 KiB). The new source-feed-bundle.js permits a signed manifest with up to **64 independently signed chunks and 131,072 CIDR entries**. Each chunk contains at most 2,048 CIDRs, 160 KiB of canonical JSON, and a manifest-committed SHA-256 digest. The manifest contains the operator Ed25519 identity, revision, issued/expiration dates, rule counts and chunk digests.

Browsers pin the accepting node's observer identity independently. They verify the signed manifest, request individual bounded chunks over the *same voluntarily selected peer WebSocket*, verify every chunk, and only then commit the new digest and revision. Missing, changed, replayed, outdated, and cross-chunk duplicate CIDRs cause rejection. No new OrbitDB database is opened, and the original signed posts are unmodified.

The browser defers its initial historical synchronization until source-feed verification completes, avoiding collisions with the peer's bounded WebSocket request budget. Legacy peers that cannot serve an observer feed fall back to the unknown category after a short delay. Unknown classifications do not invalidate signed posts. A relay's observed IP is never assumed to be the author's original location.

The accepting peer now compiles IP prefix indexes once per verified revision rather than scanning thousands of network rules for every new socket. Each IPv4 classification requires at most 25 prefix probes, and IPv6 at most 49. A more-specific country/ASN entry can coexist with a broader VPN/datacenter resource-class entry. The most-specific non-unknown network type and separately most-specific available country/ASN are selected.

## Import actual datasets (optional, operator-selected)

The offline tool, source-feed-import.mjs, converts operator-supplied IPtoASN TSV/TSV.gz and one-CIDR-per-line VPN, datacenter, Tor, and proxy lists into locally reviewed JSON rules. It performs **no HTTP downloads**, and does not install any central country or VPN authority into clients.

Examples of candidate sources, with distinct rights requirements:

- [IPtoASN](https://iptoasn.com/) — IP-range-to-ASN/country TSV, available under PDDL 1.0. Registry country/ASN hints are not proof of a user's physical location or residential status.
- [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn) — maintained VPN/datacenter CIDRs. Project scripts and curated lists are MIT, while some generated datasets depend on IPLocate input under CC BY-SA 4.0. Observe the upstream terms and attribution for the precise dataset used.

Example operator workflow, using independently obtained local files:

~~~bash
cd /srv/web9000/source/v2/network
node source-feed-import.mjs \
  --iptoasn /private/data/ip2asn-v4.tsv.gz \
  --vpn /private/data/vpn-ipv4.txt \
  --datacenter /private/data/datacenter-ipv4.txt \
  --countries DE,FR \
  --output /private/source-rules.json

node source-feed-operator.mjs init /private/observer.json /private/source-rules.json

# Later, after obtaining and reviewing updated files:
node source-feed-import.mjs --iptoasn /private/data/new-ip2asn-v4.tsv.gz \
  --vpn /private/data/new-vpn-ipv4.txt \
  --countries DE,FR --output /private/source-rules.json
node source-feed-operator.mjs update /private/observer.json /private/source-rules.json
# If this OPTIONAL observer peer is already running:
kill -HUP <node-peer-pid>
~~~

The operator tool automatically uses a single signed v1 feed if it fits and switches to multipart v2 if needed. Existing private 0600 signing keys remain unchanged and signing is atomic. The importer fails if the complete result exceeds the signed-feed cap; **it never silently truncates worldwide coverage**.

**Precision matters:** IPv4 ranges smaller than /24 and IPv6 ranges smaller than /48 are skipped rather than widened to include unrelated IP addresses. These skipped fragments are counted. When importing country/ASN-only data, the network type defaults to unknown: ASN ownership is not proof of residential access. The optional baseline-kind residential argument is an explicit operator heuristic, not a verified fact. VPN/CIDR overlaps combine the network type with the most specific available country/ASN labels.

## Real-source disposable importer check

On 2026-11-20 a **temporary** download of the public IPtoASN IPv4 TSV.gz (8,697,031 bytes) was validated and imported offline with the explicit country filter DE. The importer processed 11,710 matching ASN/country rows into **14,733 accurately represented CIDRs**; 528,581 non-DE rows were excluded by the requested filter. The operator CLI then created a signed v2 feed with **10 chunks**, and the operator-private loader verified all 14,733 CIDRs. No real classification feed was shipped, no live peer was changed, and the temporary download, private test signing key, and generated rules were removed. This checks actual upstream TSV compatibility, **not** VPN accuracy, global-country coverage, or public production reliability.

## Verification and limits

Run npm run test:source-observation inside v2/network. Tests exercise real separate WebSocket peers and clients, cryptographic manifest and chunk tampering, rollback, live atomic upgrades, repeated operator CLI updates, gzipped IPtoASN import, more-specific network fragment handling, and source-type classification.

**Still not complete:** a fully populated, regularly fetched and rights-reviewed worldwide data source; mobile performance measurements at the 131K CIDR maximum; transport-origin attribution through relays; and browser-native libp2p. The current implementation transfers source intelligence via selected WebSocket-capable peers while actual record storage and backend replication remain independently signed OrbitDB/IPFS. Optional Nginx and cgroup defenses remain server-only bonuses.
