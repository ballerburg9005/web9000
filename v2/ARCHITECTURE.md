# WEB9000/2 — open publication and voluntary federation

Status: **architectural prototype, not yet a deployable P2P social network**.

## Non-negotiable invariants

1. **No universal write authority.** Any cryptographically valid identity may author a post, reply, or moderation assertion addressed to *any* string namespace. A website can claim a space, but cannot stop conflicting publications from existing.
2. **No protocol-wide deletion.** Retractions, blocks, removals and takedowns are signed **claims or local actions**. Nobody holds the key to erase a record held by other peers.
3. **No compelled storage.** Every peer chooses which payloads, indexes and media to replicate. This does not alter the validity of a publication stored by someone else.
4. **No compulsory moderation authority.** Local users subscribe to any combination of moderation rules and group relationships. Different views of the same signed events may disagree.
5. **No compulsory staking.** Publishing does not require a wallet, cryptocurrency, site owner approval or invitation. Stake, invitations and reputation influence view/ranking and permitted *service consumption* only.
6. **No implicit media downloads.** A text record may reference IPFS CIDs. Media transfer is a separate opt-in decision after policies and local blocks have been applied.

Guarantee boundary: the protocol cannot promise availability if nobody retains a record, nor guarantee delivery through peers who refuse to forward it. Anyone can **publish or retain independently**, and there is no remotely enforceable erasure primitive.

## Architecture

```
anonymous browser / embedded widget / always-on peer
        | create signed append-only JSON event
        | arbitrary namespace, replies refer to event hashes
        v
    independent gossip / discovery indexes <----> alternate index peers
        |                        (OrbitDB over Helia/libp2p)
        | advertise event IDs and CIDs; not a mandatory global DB
        v
  willing client-selected mirrors / blockstores
        |
        +--> local signatures/schema verification
        +--> voluntarily adopted clan/guild/federation policies
        +--> optional reputation / Stake4Karma evidence
        +--> local index/search and safety-conscious renderers
        +--> user chooses which media CID to fetch or pin
```

**Critical distinction:** OrbitDB is a shared append-only event-log/index _implementation_, not the authority for valid WEB9000 records. Opening one OrbitDB with `write:['*']` does not magically make it a world-readable world-writable database: its address must be discovered; peers must connect; some may refuse replication. If one index operator disappears, someone else can mirror it or advertise another. Signed event identity and namespace are independent of the OrbitDB address.

## Records and extensions

`{id, payload, signature}` where `id = sha256(canonical(payload))`; domain-separated Ed25519 signature covers the ID. `payload` contains `version, kind, space, author, time, nonce, body`. Post body contains arbitrary `fields` JSON alongside `title`, `text` and an optional array of IPFS CID references. There are **no exclusive post types**. A listing can simultaneously be an event, job, marketplace item, funding appeal and discussion.

Event kinds include `post`, `reply`, `label`, `endorse`, `group`, `proposal`, `vote`, `invitation`, `accept`, `policy`, `membership`, and `retraction`. Signed `group` charters, `proposal`/`vote` ratification, mutually signed `invitation`/`accept` sponsorship, and content/CID labels have local interpreter modules. Generic `policy`, `membership`, and `retraction` events remain **protocol-valid but without finalized common semantics**; their existence grants no global database authority. All records are immutable. Edits create new signed assertions referring to previous IDs. A retraction is not deletion.

Signed labels contain `target`, arbitrary `tag`, `reason` and a reviewer identity. A label by itself proves only that the reviewer asserted it. It is not a global verdict. A local view can choose to trust an organization, a factional specialist, a commercial review agency, an artist guild, or nobody. Group subscriptions can inherit other group review weights, without imposing a single hierarchy; recursive cycles are bounded and duplicate reviewers use max weights instead of summation.

## What WEB9000 must **not** conflate

| Layer | What it governs | What it cannot govern |
| --- | --- | --- |
| Signatures | Who authored these bytes | Truth, legality, trust, whether a user is human |
| Publication | Independently referenceable event record | Universal deliverability |
| Discovery | Which peers learn an event exists | Whether an event is valid |
| Replication | Which peers retain and transmit it | What unwilling peers must store |
| Space/group policy | Local visibility, rankings and voluntary acceptance | World-wide namespace writes or third-party erasure |
| Stake4Karma | Economic friction against mass identity creation | Human verification, a universal anti-bot solution |
| IPFS | Addressing and retrieving content from willing holders | Permanent persistence or automatic legal compliance |

## Safety and legal obligations

Node operators and website operators are responsible for their own lawful behavior and compliance obligations. Their clients must be able to disable media auto-fetch, decline pinning, remove locally stored blocks, suppress previews, and subscribe to independently vetted urgent child-sexual-abuse-material/malware hash lists. Flag evidence should be minimized and should not redistribute abusive media. Labels should require multiple independent reviewers where suitable, allow appeals and disagreements, and be provenance-visible to prevent arbitrary claims silencing opponents. **A report never deletes media from other nodes.** Coordination means multiple nodes *choose* the same safety policy, not a universal takedown authority. Pre-fetch screening cannot be perfect, because unknown content may not yet have hashes or labels.

Do not automatically cache arbitrary IPFS content in the browser. Gateways are optional user-configurable retrieval transports; gateway providers and bootstrap/relay operators may apply their own policies. Prevent active HTML/scripts, tracker pixels, location exposure and dangerous file MIME rendering; proxy or sandbox remote previews. Untrusted Markdown must never be interpolated into HTML.

## Stake4Karma integration

`ballerburg9005/stake4karma` is an **unaudited Base Sepolia testnet prototype** without a known shared deployment. Keep signing identity separate from optional on-chain credential evidence. Score only a *fresh independently verified* contract state on the correct chain, with contract bytecode/network pinned; do not trust a pasted wallet address, stale proof, claimed fiat value, or caller-selected RPC. Viewers may weight stake, account age, endorsements, posting pace, invitation lineage and prior abuse reports. Even a $100 refundable stake is not a $100 fee; capital lock, opportunity cost, gas, address pooling and bot profits matter. No empirical basis for a 99.99% prevention claim exists yet.

Reputational sponsorship must track **explicit signed invitations** with depth, rate and maximum exposure limits. Apply penalties according to subscribed governance policies; never globally slash coins or fabricate consensus. Sybil rings, bought accounts, malicious reviewers, compromised keys, coordinated false reports, group capture and invite bombing require threat-model tests.

## Migration plan

1. Preserve the legacy UI as a reference and build `v2/` without destroying it.
2. Test portable signed immutable event protocol, local conflict-free mirror, two contradictory policy views, and embedded UI.
3. Extend existing browser IndexedDB key storage and encrypted portable backups with blockstore persistence, multi-relay browser connectivity and *discovery* (Node-to-Node OrbitDB two-peer smoke tests now pass).
4. Expand implemented signed membership proposals, member quorum and fork-aware group governance with richer democratic voting, nested delegations, dispute resolution and browser selection of explicit forks.
5. Add optional Stake4Karma adapter after contract verification and testnet E2E tests; evaluate bot economics.
6. Integrate implemented local CID/media label and unpin policies with actual IPFS pin managers, legal review, browser isolation and abuse testing.
7. Publish a multi-website embed test: two independent sites can publish to the same space, and a third peer can retain posts even when both sites disappear.

## Versions and references

Use current `@orbitdb/core` 4.x, Helia 6.x and libp2p 3.x families, but **test their interoperability before pinning production dependencies**. The prior GunDB code is not part of v2.

- https://github.com/orbitdb/orbitdb/blob/main/docs/GETTING_STARTED.md
- https://libp2p.io/docs/browser-connectivity/
- https://github.com/ballerburg9005/stake4karma

Media-specific moderation may target a **signed post/event ID** or an **IPFS CID**, so known harmful bytes can be declined regardless of the number of posts referring to them. `core/media-policy.js` demonstrates locally chosen evidence thresholds, no implicit fetch and opt-in automatic **local** unpinning. It does not perform a remote takedown, magic detection of never-seen harmful media, or override another operator's storage decisions.

## Current demonstrable milestones (November 2026)

- **Cryptographic data integrity:** signature-verified content-addressed Ed25519 publication into any string namespace. No signer can claim an exclusive database address.
- **Independent group interpretation:** signed founder charter, signed member proposals and yes/no votes, quorum against a parent snapshot, no imposed canonical winner for ratified forks. Rejections cannot retroactively invalidate already approved changes. Local subscription activates selected reviewer appointments.
  A versioned `timed-v1` charter mode has 7-day **advisory** For/Against motions
  with minimum participant turnout, 7-day authenticated group-information changes,
  and 14-day constitutional approvals requiring high absolute member thresholds.
  Portable JSON group-state proofs let others check eligible Ed25519 ballots and
  ratification without trusting the website. Browser readers independently choose
  a valid fork. Legacy charters retain their original threshold rules.
  **Signed timestamps are not independently witnessed time**, and mock karma has
  no governance voting weight. The future dual democratic + capped independently
  proven credibility tally is a design requirement, not an available verifier.
  See [docs/GROUP-GOVERNANCE.md](../docs/GROUP-GOVERNANCE.md).
- **Sponsorship anti-Sybil evidence:** signer-issued invitation + separately signed acceptance, bounded promotion, dampened multi-hop inherited trust, and viewer-chosen reviewer sanctions with local sponsor liability. This is not a blockchain stake verification and confers no publication gate.
- **Media safety evidence:** label event or CID, distinct weighted reviewers, default no automatic byte fetch, optional local automatic unpin. Nothing unpins another operator's blocks.
- **Portable identity:** password-encrypted backup and import using PBKDF2-SHA256/AES-256-GCM; extractable key must be protected from malicious hosting scripts.
- **Working network experiment:** GitHub Actions independently launches two Node libp2p/Helia/OrbitDB peers and verifies two-way exchange of signed events. Full browser-to-browser networking and independent global discovery remain unfinished.

### Threat-model reminders

Every direct connection can reveal a browser's network address, and the current network experiment is **not anonymous**. Membership records, public invitations, governance votes, signed content and stake wallets can create linkable social graphs. For political organizing, use compartmentalized identities and treat private-group encryption, metadata minimization and privacy-preserving routing as future work—not as present guarantees. Local policies must guard against coordinated false labels, reporting abuse, Sybil coalitions, and malicious host scripts. Neither blockchain staking nor group voting can prove real-world identity or honest intent.

## Browser transport and cross-index replication (2026-11-18)

The v2 browser now accepts up to eight voluntarily chosen `ws://` or `wss://` peer endpoints. Those are independently operated WebSocket entry points attached to Helia/libp2p/OrbitDB peers; the browser **does not** require any special DNS or static-site authority. Its outgoing signed publications are queued in IndexedDB while disconnected and resent to chosen peers. Incoming events are verified before entering the browser replica. Users separately choose which namespace metadata to replicate and which spaces to show. IPFS media bytes are never implicitly fetched.

A browser can also subscribe to several **different OrbitDB indexes** and, when explicitly enabled, carry positively trusted, locally approved signed posts between those indexes. It cannot force any peer to accept a record; it can seek another willing peer or host one itself. The integration suite tests unrelated indexes connected only by such a browser, with untrusted content not automatically forwarded. This is not a universal global index or reliable global dissemination algorithm, and default discovery remains manual.

Browser embedding is supported as a self-hosted static folder or iframe. `?space=...` selects a voluntary default space; `?owner=ed25519:...` adds a user-overridable owner-preferred view, **not** an exclusive writer or signed proof of site ownership. `?embed=1` provides a compact layout. Transport peer keys persist between Node restarts, separately from WEB9000 post-signing identities and on-chain wallets. No anonymity, confidentiality, browser-native libp2p or automatic IPFS upload is claimed.


### Experimental signed-event storage boundary

Legacy public raw OrbitDB indexes use `IPFSAccessController({write:['*']})` and depend on application-side verification. An adversarial direct `db.add` can store invalid WEB9000 envelopes in the legacy physical log; local replicas reject them on ingest, but disk/replication resources can still be wasted. A **new optional** `web9000-signed-v1` controller at `v2/network/signed-access-controller.js` checks the OrbitDB writer identity AND the enclosed WEB9000 Ed25519 event/length inside `canAppend`. It retains permissionless writes to every namespace by every valid signer and keeps the versioned check identical across peers. `WEB9000_RAW_SIGNED_INDEX=1` selects a distinct address for new operator instances; `raw-index-selection.mjs` binds signed mode and selected name/address persistently to a fresh peer directory and refuses old-directory auto-upgrades or downgrades; the persistent legacy test peer remains unchanged until an explicitly planned, consent-respecting migration. Tested with two live Helia/OrbitDB peers including direct forgery and legitimate arbitrary-author publication. No claim of complete DoS immunity: malicious peers can still consume network/CPU outside the append boundary.


### Explicit legacy migration / snapshot semantics

`migrate-verified-events.mjs` scans the underlying legacy OrbitDB iterator with a maximum of 50,000 locally available log entries, retaining original signed events by ID and counting invalid/duplicate/oversized physical records. A source snapshot SHA-256 commits to the local log entry hashes and a second digest commits to the sorted set of accepted WEB9000 signed event IDs. These fingerprints **cannot attest** to events other peers have withheld. `migrate-raw-index.mjs` offers an offline dry-run then an explicitly hash-authorized append into a **fresh, separate** signature-validated index; it checks source stability before and after copying, exact destination event membership and signatures, and supports interrupted resumptions. No re-signing, automatic peer switch, legacy content deletion, media pinning or global namespace admission is performed. See `docs/RAW-INDEX-MIGRATION.md`. The live experimental index remains legacy; this capability must be evaluated in a side-by-side test before any manual operator cutover.


### Reader-selected per-namespace transport subscriptions (2026-11-19)

The compact **Join Network** dialog now exposes a **Sync namespaces** field, one valid public namespace per line, or `*` to retain the original all-namespace behavior (default for existing readers). On Connect, the browser subscribes to these namespaces on each voluntarily chosen independent WebSocket bridge. The server sends filtered signed batches and live updates. The browser verifies signatures **and independently checks namespace scope** before ingesting events; it ignores otherwise valid out-of-scope messages even if a malicious bridge violates its own subscription. The chosen scope is persisted in the reader's origin-local IndexedDB and survives reconnection/reload. Switching from `demo` to `groups` does **not** delete old signed records, suppress a locally authored event, or deny anyone the ability to publish to another namespace. Readable display follows, signed governance group subscriptions, browser transport scopes and operator moderation are separate choices. See `v2/network/scoped-sync.test.mjs` and four-origin Chromium checkpoint 22.

**Limits:** selected namespace names are disclosed to each WebSocket peer, not private subscriptions; the browser cannot stop a malicious bridge transmitting bytes, only refuse local ingestion. No strong completeness guarantee exists for any locally retained set. The current server still scans/sorts all local records for each 32-event page; a scoped query reduces transfer volume but not necessarily database CPU. Server and peer indexing, omission detection/anti-entropy, per-author outbox discovery and private-group transport remain open. Never make a namespace subscription a membership rule or a publication ACL.
