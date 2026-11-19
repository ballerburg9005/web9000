# WEB9000: offline legacy raw-index → signed-append-index migration

**Prototype operator runbook · 2026-11-19 · active branch `main`**

This migrates only the **signature-verified, locally present WEB9000 v1 events** from an independently owned legacy raw OrbitDB index into an independently initialized `web9000-signed-v1` raw index. **It does not delete, re-sign, suppress, replace, or automatically redirect anyone's records or feeds.**

**Do not run on a live production peer or its active data directory.** Stop the source peer cleanly, then run against a protected offline copy of its data directory (containing `peer-private-key.pb`, `orbitdb/`, `blocks/`) with compatible file permissions. The source is opened by OrbitDB and may update its own local cache/metadata; use a copy to preserve a forensic original. The new index must use a **different, initially nonexistent data directory**. No external gateway or bootstrap server is needed for an offline copy. No private key, signature secret or binary IPFS media file is exported in the JSON report.

## Procedure

1. Ensure the legacy node is **stopped** or work from a complete, consistent stopped-node directory snapshot. Never copy a live LevelDB store and assume it is crash-consistent. Verify the original peer identity/index address and that you have independent backups.
2. Start in the installed `v2/network` Node 22 environment and **plan**. This opens the locally retained source OrbitDB history, without opening/creating the proposed destination:

```sh
cd v2/network
node migrate-raw-index.mjs \
  --source-dir /path/to/offline-legacy-copy \
  --source-index /orbitdb/EXACT_EXISTING_INDEX_ADDRESS \
  --destination-dir /path/to/NEW-signed-peer \
  --destination-name web9000-public-signed-v1
```

The JSON report includes the source index, SHA-256 local physical log snapshot fingerprint `snapshot`, digest of accepted event IDs `eventSet`, number of physical entries examined, valid/duplicate/invalid/oversized records, destination name, and an explicit statement that there is **no** proof of network-wide completeness. A source containing oversized records requires manual review; the migrator **refuses** to silently omit any that cannot fit signed-v1 append rules. Invalid signatures never become valid merely because the source peer stored them.

3. Review that report and *only then* explicitly execute against that exact frozen snapshot (use the 64-character SHA-256 printed in the prior output, not the placeholder):

```sh
node migrate-raw-index.mjs \
  --source-dir /path/to/offline-legacy-copy \
  --source-index /orbitdb/EXACT_EXISTING_INDEX_ADDRESS \
  --destination-dir /path/to/NEW-signed-peer \
  --destination-name web9000-public-signed-v1 \
  --execute --expect-snapshot 64_CHARACTER_SHA256_FROM_DRY_RUN
```

If any source log entry changed since the dry run, the command **refuses before creating the destination**. The target directory is bound permanently to the selected signed-index name/address, requires its own persisted peer identity, and rejects ordinary legacy mode on restart. For each already signed event it calls the verified OrbitDB append method. It then independently rereads the destination signed index, verifies the exact event-ID set and signatures, and checks the source snapshot **again**.

4. If interrupted after the destination was created, **do not delete it**. Re-run the dry run to confirm the current source fingerprint, inspect its output, and use `--execute --resume --expect-snapshot CURRENT_SHA256`. Resume verifies all preexisting destination signed events are a subset of the source plan and only appends missing IDs. It refuses a mixed/contaminated target that already contains unrelated signed events.
5. Keep both index addresses and their independent nodes. Manually verify availability and a second, independent copy before *voluntarily* offering the new signed index to interested readers. **No CLI action changes the old peer's published index, website peer suggestions, DNS, qualified index, media gateway, or browser preferences.** Reannounce the new index as a *choice*, not a central canonical namespace. This tool does not implement continuous dual-write or anti-entropy between the two indexes.

## Operator and user safety invariants

- Source public log is never overwritten by the migrator. Invalid signatures are counted but not copied. All existing, independently verified signed records retain their **exact IDs, author signatures, event timestamps and content**. An importer must not sign copies as themselves.
- The copied set is the source peer's **locally observed** history at a specific point. If a malicious source omitted valid votes, comments, competing governance branches or posts, matching hashes do not detect that omission. Real claims of completeness require independent peer comparisons and time/checkpoint proofs not yet implemented.
- The signed index accepts **any** genuine WEB9000 v1 Ed25519 author in **any** public namespace, with no founder/name ownership. Index storage remains voluntary by operator. The old raw index remains independently usable by willing peers.
- This is **not a general media migration**. The signed record contains IPFS CIDs; existing binary media must be retained/mirrored separately by voluntary IPFS nodes. Migration does not auto-download media, pin content in browser clients, or transfer a media operator's storage obligations.
- The new index validates signed events **at append** and fixes a demonstrated legacy log pollution vector. This does **not** guarantee a peer cannot be overwhelmed by forged gossip, block requests, network bandwidth, CPU, I/O, or an unlimited number of genuinely signed posts. Maintain per-peer resource policies and investigate block-layer rejection.
- A source process that remains online can receive new valid signed records **after** the snapshot. The migration can then become stale; use a new snapshot, explicit catch-up/anti-entropy, or remain with two independent indexes. **No automatic reader cutover is claimed.**
- Never share private `peer-private-key.pb` files or copies of key stores in a debug export or Git repository. The source and destination directories need restrictive permissions. Encrypted backups are separate.

## Testing

```sh
cd v2/network
npm run test:migration
npm run test:signed-index
```

Tests include two real Helia/OrbitDB index instances, invalid direct writes, two independent Ed25519 authors, a duplicated source log entry, signed ID/signature preservation, source changes between dry-run and execute, simulated interruption/resume, deterministic audit digests, source retention, unrelated destination rejection, and command-line refusal for aliased/nested directories. Migration is still experimental until operator review, independent network completeness checks, and a staged side-by-side deployment.
