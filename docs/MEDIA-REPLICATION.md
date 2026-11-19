# WEB9000 media replication — experimental operator guide

## Two separate replication paths

**Ordinary browser (default):** signed records, text, votes, moderation/group events and IPFS CID metadata only. The current browser can fetch binary media for viewing from a selected HTTP gateway; it does **not** offer browser-side IPFS pinning or a "mirror everything" switch. Normal HTTP cache may still retain temporary browser media data. Loading/viewing and volunteering to host must remain separate.

**Opt-in specialized media peers:** a node operator may retain and serve selected media blocks in a local Helia/IPFS datastore. The originating uploader is one optional provider, not a global owner. Signed text remains valid even if a CID is not presently retrievable.

## Explicit operator-to-operator mirror (test implementation)

With both chosen operator gateways reachable and the target operator explicitly enabling media uploads, the admin can import one CID:

```sh
cd v2/network
node mirror-media.mjs ipfs://<CID> https://source.example/media https://mine.example/media
```

This downloads the CID from the operator-chosen source endpoint, enforces the same per-file limits (256 KiB images; 10 MiB audio/video), and submits the bytes to the *operator-chosen* destination. It verifies the **CID returned by the destination is identical** before reporting success. The destination independently retains a local IPFS block/DAG and can subsequently serve that CID if the source goes offline.

The destination's existing uploads-on switch, capacity limit, per-address daily quota and MIME checks still apply. The operation uses HTTP as a bootstrap transport; it is **not** automatic IPFS DHT-based discovery, peer-to-peer block exchange, background pinning, a scheduled replication service, or an authenticated private transfer API. Do not assume an independent source is trustworthy merely because it supplies a given CID; locally verify and screen content as required before making it available.

Neither browsing a text feed nor connecting to a WebSocket index invokes this importer.

## Operator-local CID serving quarantine

The HTTP media gateway reads an optional file next to its manifest, normally:

```
/data/media-manifest.json.quarantine.json
```

From the node's own trusted administration shell, run the tool **as the same OS user that runs the media peer**. For the current Docker test container (UID 10001), for example:

```sh
docker exec -u 10001 web9000-test-peer node /app/v2/network/media-quarantine.mjs add /data/media-manifest.json.quarantine.json ipfs://<CID> "Local operator review"
docker exec -u 10001 web9000-test-peer node /app/v2/network/media-quarantine.mjs list /data/media-manifest.json.quarantine.json
docker exec -u 10001 web9000-test-peer node /app/v2/network/media-quarantine.mjs remove /data/media-manifest.json.quarantine.json ipfs://<CID>
```

The file is written with owner-only permissions. Writing it as an unrelated root user and leaving it unreadable to the service user causes the gateway to fail closed.

A quarantined CID returns HTTP 403 for both GET and HEAD from **that one operator**. The list is consulted per request, so quarantine and restoration do not need a server restart. Corrupt policy configuration fails closed (503), not open. Its file records a reason and timestamp for operator review. Do not put this private file behind a public web route.

**2026-11-19 update — the outbound Helia Bitswap path is also protected.** The media-enabled `node-peer.mjs` now installs `media-bitswap-policy.mjs` before Helia starts. It wraps the outgoing Bitswap broker's blockstore read, leaving the local blockstore, HTTP gateway and signed OrbitDB logic independent. It builds a map of locally retained manifest roots and the child blocks of their UnixFS DAGs. Each requested raw/DAG-PB block is returned only when it belongs to at least one *manifest-retained* media root and **none** of its roots are quarantined. Unmanifested raw image blocks and orphaned UnixFS nodes are refused by default. A corrupt, unreadable or oversized policy fails closed for media blocks. Other OrbitDB codecs continue to synchronize; real two-peer integration tests confirm independent signed metadata survives active media quarantine. The P2P policy is local and dynamically re-reads the operator files: changes take effect on subsequent requests without peer restart. Test with `npm run test:media-bitswap` in `v2/network`.

**Scope:** This guard covers **Helia Bitswap outbound block reads only**. It does not erase retained blocks, invalidate any signed post, retract previously advertised provider records, prevent a disconnected mirror from serving an independent copy, control transfers on alternate future protocols or revoke bytes already in flight/cached elsewhere. Review physical orphan disposal and safe blockstore GC, independent provider opt-in and full abuse review separately. Operators choose their own policy; it is NOT a global moderation authority.

**Previously:** the gateway HTTP-only implementation could not prove libp2p refusal. The statement below applies to local HTTP response semantics only.

**This only restricts the gateway's own serving behavior.** It does not delete the signed CID reference, remotely command other IPFS peers, globally revoke anything, or automatically erase physical blocks. IPFS blockstore cleanup/garbage collection, evidence handling, legally required processes and appealable moderation are separate unsolved tasks. The tool is not a content scanner and is not safe to rely on as the sole moderation/abuse response.

## Tests

The isolated Helia tests cover source upload, independent mirroring with unchanged CID, target serving without source dependency, target-only quarantine with source still reachable, reversal, restart persistence, and 10 MiB limits:

```sh
cd v2/network
node --test media-node.test.mjs
```

This is a bounded prototype for operator-reviewed mirroring, not a ready-made automatic volunteer-media network. A future browser opt-in must expose explicit scope, data budget, safety policy, persistent storage and upload bandwidth controls before it is enabled.

## Signed provider discovery and reader-approved backup gateways (2026-11-18)

WEB9000 now supports a **signed `media-provider` event** whose body contains an HTTPS/HTTP gateway base URL, 1–32 explicit `ipfs://CID` references, an `offer` or `withdraw` action, and an expiry no more than 7 days after the signed timestamp. Suggested namespace: `media-providers`. Each event is an ordinary cryptographically signed, immutable record carried by willing raw OrbitDB indexes. It does not prove that a peer actually retains the bytes, create an authoritative provider registry, grant ownership of a space, or authorize automatic replication. The latest signed claim per signer/gateway/CID supersedes older ones while active.

**Browser choices are decisive.** The classic board's **Choose independent peers** dialog now has a primary media gateway, an optional list of up to seven additional explicitly approved backup gateways, and a list of received signed provider claims. Clicking *Add to backup list* only fills the address form; the user must click Connect to approve it. A signed announcement from even a trusted key cannot silently add a host to the allowed list. Unknown authors' binary attachments still require the reader's manual load action. Approved backups are attempted on image/video/audio load errors; the global audio engine remains shared across tile and expanded view.

The optional media gateway provides `GET /have/<CID>`: HTTP 200 with a small JSON availability hint for a locally retained, unquarantined CID, or 404 if absent/locally quarantined. It does not download media bytes or authenticate an independently hosted peer's claim. It is *not* a list of all stored media.

### Operator-controlled signed announcements

An operator can create a separate, local, owner-only signing key for public provider announcements:

```sh
cd v2/network
node announce-media.mjs init /path/to/media-provider.private.json
node announce-media.mjs offer /path/to/media-provider.private.json https://your-node.example/media ipfs://<CID> > claim.json
node announce-media.mjs publish wss://your-bridge.example/ws/ claim.json https://your-website.example
```

The `origin` parameter is optional and is meaningful only for an operator who is authorized by their own bridge's Origin filter; it is **not authentication**. Use `withdraw` instead of `offer` to publish a signed superseding withdrawal. By default these claims expire after 48 hours; repeat a claim explicitly if the peer still intends to serve the file. The key file contains a plaintext JWK private key stored with permission 0600; keep it in a private, backed-up operator-only location. **Never place it under a web-served directory or commit it.** The peer still freely decides whether to carry this signed record.

This is transport-agnostic and indexes do not become discovery authorities; a reader can learn the same signed claim from any willing replica. Distribution of claims still requires an independently accessible peer or another portable-record exchange mechanism. There is no global DHT-based media provider search yet.

### Verification, security boundaries and unfinished work

The Chromium test makes the preferred gateway fail intentionally, then confirms retrieval from a user-approved secondary media node and tests the signed claim's presentation. Unit tests validate claims, bounded CID sets, expiry/withdrawal, signature tampering resistance, and zero automatic contact with unapproved claimed hosts. A separate Node test covers operator signing, publishing and acknowledgment through an independent WebSocket bridge.

**Known limitation:** Browser `<img>`/`<video>`/`<audio>` playback via an HTTPS gateway currently does not cryptographically recompute/verify UnixFS CIDs from served bytes. Gateway trust is therefore still relevant. The operator-to-operator importer checks the destination's returned CID, but a malicious gateway could misrepresent data to an ordinary browser; stronger content verification remains necessary. Provider announcements are not proof of holdings. Opt-in background media pinning, multi-peer native IPFS block discovery/Bitswap, disk/bandwidth budgets and automatic expiry refresh have not been implemented; do not describe this as a finished decentralized media network.


## 2026-11-19 isolated IPFS media segmentation benchmark (not deployed)

100 distinct physical LevelDB storage partitions successfully held and re-read 100 CID media objects (50 synthetic images, 50 synthetic 2 MiB UnixFS video files; 104.69 MiB total). A separate test ran 100 individually identified Helia/libp2p media nodes, each with a separate blockstore, and a reader that established 100 explicit connections and transferred/verified 101 CID media roots including a 2 MiB video over real Bitswap. Per-source manifest-aware media policy and isolated video quarantine were checked. Measured ~282 MiB Node-process RSS and 43.71 s sequential transfer for the 100 source Bitswap trial under a disposable 0.6-CPU container. Full data and repeat commands: [IPFS-TIER-BENCHMARK-2026-11-19.md](IPFS-TIER-BENCHMARK-2026-11-19.md).

**Crucial limitation:** A shared Helia node cannot currently discover/serve blocks in the independently opened test partitions through its default Bitswap broker; a verified tier-aware CID and UnixFS child-block routing adapter is needed, plus per-tier read/upload bandwidth quotas, durable storage cleanup and hard ingress limits. Simply making 100 disk folders is NOT proof of 100 isolated IPFS serving streams. The existing demo host and ordinary browser media opt-in behavior are unchanged.
