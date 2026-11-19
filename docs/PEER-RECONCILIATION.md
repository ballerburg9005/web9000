# Independent peer metadata reconciliation (experimental)

**2026-11-19. This is an operator-controlled local peer comparison, not global consensus or proof of complete history.**

Independent OrbitDB/WebSocket peers may hold different sets of signed records. A reader cannot infer worldwide completeness from a peer's history batch or local snapshot revision.

The optional WebSocket extension uses the *current explicitly subscribed namespace scopes* and the same frozen local-observation snapshot as history paging:

| Request type | Response type | Limit and behavior |
|---|---|---|
| inventory, with hexadecimal prefix (empty for all) | inventory | Count and SHA-256 of sorted signed record IDs, local revision |
| inventory-ids, with prefix and optional cursor | inventory-ids | Up to 32 sorted in-scope IDs and next cursor |
| inventory-get, with explicit signed IDs | inventory-records | At most 8 original signed envelopes from the subscription snapshot |

Prefixes accept 0–8 lowercase hexadecimal characters. The server advertises the optional capability read-only-reconciliation-v1, without changing existing client protocol behavior, publishing rights, or the default feed. No automatic binary/IPFS mirroring is introduced.

## Operator tool

With Node 22+ and network dependencies installed, run from v2/network:

    node reconcile-mirrors.mjs ws://127.0.0.1:8787/ ws://127.0.0.1:8788/ --space=demo

Without --space the tool compares all public namespaces visible to the peers. Repeat --space=NAME for additional namespaces. Comparison is **read-only** and reports missingFromFirst and missingFromSecond. It recursively compares prefix digests and enumerates only differing ranges, bounded to 1024 missing IDs per run.

An operator may **explicitly** request copying verified original signed metadata using one of:

    --repair-to=first
    --repair-to=second
    --repair-to=both

The destination independently decides whether to accept the normal publish request. The client validates original signed event envelopes before copying; it does not replace signatures, overwrite history, delete records, confer group authority, or fetch IPFS bytes. It is not a hidden background repair feature.

The command throttles requests for the experimental bridge's 90-command/minute per-socket limit. Full-scale reconciliation of large divergent archives remains unimplemented.

## Threat model and limits

- Each snapshot is *local*, unsigned and taken at a different observation moment. A fresh subscription is needed to see new live arrivals in a new comparison.
- The returned digest is not witnessed or signed by another party. The CLI checks reported IDs against prefix counts/digests in mismatched leaves, verifies each fetched Ed25519 signed envelope, and rejects malformed ranges. A malicious peer can still **consistently omit** events, or claim a plausible incomplete subset. Agreement does not prove global completeness; disagreement does not prove intent.
- The chosen namespace scopes and queried IDs are visible to both endpoints; this is not a protocol for private groups.
- The CLI uses explicit peer URLs, no obligatory discovery service, no trust elevation, and no automatic storage or download changes. Any peer may refuse publication. All namespaces remain permissionlessly writable by any signer at the protocol layer.
- This is a first small/medium-scale diagnostic, not NIP-77 Negentropy, globally witnessed checkpoints, anti-eclipse evidence, or complete scalable anti-entropy. Those require more engineering: independent discovery, per-author indexes, signed checkpoints, bounded automatic repairs, broader adversarial testing and peer diversity.

## Tests

From v2/network:

    npm run test:reconciliation
    npm run test:indexed-sync

Real WebSocket integration tests run two distinct bridge instances and verify scoped inventory disagreement, denial of out-of-scope event fetch, malformed-range rejection, opt-in one-way repair, preservation of original signed records, and frozen-snapshot behavior. GitHub CI must pass on the pushed head before treating the change as delivered.
