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

**This only restricts the gateway's own serving behavior.** It does not delete the signed CID reference, remotely command other IPFS peers, globally revoke anything, or automatically erase physical blocks. IPFS blockstore cleanup/garbage collection, evidence handling, legally required processes and appealable moderation are separate unsolved tasks. The tool is not a content scanner and is not safe to rely on as the sole moderation/abuse response.

## Tests

The isolated Helia tests cover source upload, independent mirroring with unchanged CID, target serving without source dependency, target-only quarantine with source still reachable, reversal, restart persistence, and 10 MiB limits:

```sh
cd v2/network
node --test media-node.test.mjs
```

This is a bounded prototype for operator-reviewed mirroring, not a ready-made automatic volunteer-media network. A future browser opt-in must expose explicit scope, data budget, safety policy, persistent storage and upload bandwidth controls before it is enabled.
