# WEB9000: signed source-data refresh and maximum browser stress

**2026-11-20 — operator/browser opt-in. Hosted peer NOT reconfigured.**

This extends [browser-first source classification](BROWSER-SOURCE-CLASSIFICATION-2026-11-20.md) and [multipart source intelligence](MULTIPART-SOURCE-INTELLIGENCE-2026-11-20.md). The selected limit of **20 active physical OrbitDB databases** is unchanged; source-intelligence chunks are metadata over a user-selected WebSocket peer, not extra OrbitDB databases or an Nginx dependency.

## Staged, operator-reviewed refreshing

A new operator-only utility, **v2/network/source-feed-refresh.mjs**, takes a private local 0600 refresh plan and stages snapshots from exactly operator-selected HTTPS URLs inside a 0700 private staging directory. It never alters an existing signed feed, private signing key, running peer, or published record. It refuses redirects, HTTP sources, oversized files, invalid responses, and empty downloads. Limits: 8 source files, 128 MiB per file, 256 MiB total, 30-second request timeouts.

Each staged snapshot is SHA-256 hashed as it streams to disk. A private sources.json records the full operator-reviewed URL, claimed license, source category, exact file length, retrieval timestamp, hash, and local staging file path. Failed staging runs remove only their own newly created staging directory. **No automatic publication or signing occurs.** The operator must inspect source content, attribution and impact, then run the existing importer and signer.

Example private refresh plan:

~~~json
{
  "transform": "web9000-source-feed-import/v1;countries=DE;baseline=unknown",
  "sources": [{
    "category": "iptoasn",
    "uri": "https://iptoasn.com/data/ip2asn-v4.tsv.gz",
    "license": "PDDL-1.0"
  }]
}
~~~

Example workflow, on an operator-owned machine. Replace the staging placeholder with the exact directory printed by the staging command:

~~~bash
cd /srv/web9000/source/v2/network
chmod 600 /private/source-plan.json
mkdir -m 700 /private/source-staging
node source-feed-refresh.mjs stage \
  /private/source-plan.json /private/source-staging

# Operator review and deliberate import:
node source-feed-import.mjs \
  --iptoasn /private/source-staging/source-refresh-XXXXXX/source-0.tsv.gz \
  --countries DE --output /private/source-rules.json

# Only after review: use init for a brand-new observer identity,
# or update for the existing operator-owned observer identity.
node source-feed-operator.mjs update \
  /private/observer.json /private/source-rules.json \
  --sources /private/source-staging/source-refresh-XXXXXX/sources.json

# For a separately opted-in observation peer only:
kill -HUP <observer-peer-pid>
~~~

The private operator config stores the feed and provenance in one atomic update. A previously provenance-enabled operator cannot silently drop its provenance on later revisions. Even after a seven-day feed expires, an operator can verify its historical Ed25519 signature at the original issue time and renew with the same key and a chained previous-feed digest; expiry does not permanently lock the operator out. The signer verifies every declared source file against its exact length and SHA-256 using local file descriptors before signing, and checks the preceding signed feed and provenance before proceeding.

## Independently verified operator-provenance claims

**source-provenance.js** creates a domain-separated Ed25519 signature binding an exact classification feed revision and digest to the SHA-256 of the original CIDR rules, the number of rules, creation and expiry dates, an explicit transformation identifier and the preceding feed digest. Up to eight input-source claims include reviewed HTTPS URL, exact byte hash/length, category, claimed license and retrieval timestamp. Local private filesystem paths are excluded from public receipts.

The optional accepting peer validates this provenance against its own pinned operator identity and complete signed CIDR dataset, then forwards the signed record as separate metadata alongside the source-feed document or multipart manifest. BrowserPeerMesh independently checks the operator's signature, the exact currently verified feed and rule digest, expiry and, when the immediately previous local feed revision is available, the previous-digest chain. A forged or mismatched provenance is not accepted. Browsers without observer pins ignore these claims; legacy independent peers without provenance still function.

Both the Classic board and dashboard now offer a compact **Inspect signed source-data provenance** expander containing the complete original signed document, including signature, URLs, licenses and hashes, for manual verification or export.

**Crucial distinction:** independently verifying an operator's signed statement does not prove the underlying geographic or VPN classifications are correct. To reproduce an operator's source transformation, an independent auditor must also obtain the original input bytes matching each advertised SHA-256 and re-run the specified importer and options. The operator's license field is an attribution claim, not automatic legal clearance. Mutable upstream URLs can prevent historical reproduction unless the original snapshots are lawfully archived.

## Real external-data refresh trial

An isolated test downloaded the actual IPtoASN IPv4 TSV.gz from its explicitly specified HTTPS source, staged its bytes, imported only the German country code, signed the resulting feed with a newly generated temporary operator key and attached matching signed provenance.

| Measurement | Result |
| --- | ---: |
| Downloaded source bytes | 8,697,031 |
| SHA-256 source snapshot | b881d19d4918552e5dca17ec0ee327d4b3873d629799063b575efb002c6dcd90 |
| Source rows matching DE | 11,710 |
| Generated accurate aligned CIDRs | 14,733 |
| Ed25519 feed chunks | 8 |
| Signed source provenance | Verified, one source |
| Raw private snapshot paths in public provenance | None |

The entire disposable download, signed test feed, new private key and staging folder were removed. **Nothing was installed on the hosted WEB9000 peer.** This is a reproducibility check against one provider, not validation of the truth of each country/ASN mapping.

## Maximum real Chromium browser stress

The multipart byte limit was increased to match the existing signed v1 body's 160 KiB cap, permitting **exactly 131,072 compact IPv4 /24 rules in 64 chunks** rather than merely advertising that theoretical limit. Larger individual CIDR records may reach the byte limit sooner.

The script **benchmark-source-feed-browser.mjs** generates 131,072 unique synthetic CIDRs with a disposable Ed25519 signer, serves the signed feed over the actual browser-bridge WebSocket, and runs a real headless Chromium page which independently verifies each chunk. A second run adds a signed synthetic provenance record, which is checked against all 131,072 rules.

Both runs used a disposable Linux container limited to **0.5 CPU, 512 MiB RAM and swap, 256 PIDs**, with no external network access for the browser phase, and a separately capped build container for fixture generation.

| Measurement | Signed source feed | Feed plus signed provenance |
| --- | ---: | ---: |
| Verified CIDRs | 131,072 | 131,072 |
| Chunks | 64 | 64 |
| Feed wire size | 9.29 MiB | 9.29 MiB, plus provenance |
| Browser transfer and verification | 4.91 s | 5.37 s |
| Browser page JS heap | 20.82 MiB | 32.81 MiB |
| Peak entire test container memory | 325.55 MiB | **436.38 MiB** |
| Browser errors | 0 | 0 |

These are **headless desktop Chromium results**, not validated mobile performance. The 436 MiB peak has limited headroom below 512 MiB; lower-memory browsers and slow real-world networks still need testing. All temporary synthetic signing keys and test files were deleted.

## Remaining limits

1. No upstream country/ASN/VPN source is a globally authoritative truth. A malicious observer or source can misclassify its traffic; another peer may choose different inputs and capacity budgets. A relay's observed IP is not the original author's location.
2. Source retrieval uses ordinary TLS to exact operator-selected URLs, not a provider-signed dataset or pinned SPKI. A compromised endpoint or DNS may supply inaccurate bytes; the operator records which bytes it signed. This implementation does not fetch any source automatically inside browser clients.
3. Importer transformations are recorded, not rerun automatically on every browser. Reproducing history requires original archived source bytes; WEB9000 does not yet replicate such archives through browser-native libp2p/IPFS.
4. Feed history continuity is verifiable for locally pinned adjacent revisions, not arbitrary missing past revisions.
5. 131,072 entries are an upper bound, not a production throughput recommendation. More memory-efficient lookup data structures and real mobile testing are needed.

The original author-signed records, voluntary group authority, ordinary web clients, and 20-physical-DB cap remain independent of these optional classification-data tools.
