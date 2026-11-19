# WEB9000 / v2 prototype

This folder is the **replacement project**, built independently of the legacy single-file GunDB UI.

## Original-style classic image board, with optional peers

From the repository root:

```bash
python3 -m http.server 4173
# http://localhost:4173/v2/
```

Requires a modern browser with Ed25519 WebCrypto and IndexedDB. The UI works locally and now connects to *user-configured* WebSocket bridges on independently operated OrbitDB/libp2p peers, with signature-checked event synchronization. It has **no mandatory default server**, public bootstrap service or browser-native libp2p transport yet. It signs posts with a local browser key, validates signed incoming records, supports JSON import/export, shows configurable views and lets users flag posts without deleting the originals. The fixture content is fictional and generated locally as properly signed events. Its gallery images reference assets already in the repository.

Run deterministic protocol and policy tests (Node.js 22+):

```bash
cd v2
npm test
```

## Experimental actual P2P peers

The **Node OrbitDB peer** includes an optional loopback WebSocket bridge (default `ws://127.0.0.1:8787`), usable by a browser served from any HTTP origin. Browser clients are transport clients rather than full libp2p nodes:

```bash
cd v2/network
npm install
node node-peer.mjs ./peer-a
# prints INDEX address and PEER multiaddrs
```

Then start a second terminal:

```bash
cd v2/network
node node-peer.mjs ./peer-b 'PASTE_ORBITDB_ADDRESS_FROM_PEER_A' 'PASTE_REACHABLE_PEER_MULTIADDR'
```

To publish, paste a signed WEB9000 envelope JSON on one line into either peer's stdin. The index accepts signatures from any author with any space name. Peers with the same OrbitDB address can synchronize records, assuming compatible network connections. CI verifies both native two-peer OrbitDB synchronization **and** two browser-compatible WebSocket clients connecting through different peers, publishing bidirectionally, rejecting signature tampering, and fetching old records on reconnect. The peer still does not host IPFS media.

The exact OrbitDB index address is a discovery hint, **not** a globally protected namespace. A peer can create another index, and can advertise events independently of any index. The proof-of-concept peer's stdout and local blockstore belong entirely to its operator.

## Next steps, before claiming a distributed app

- Actual browser libp2p transports with independently runnable bootstrap, discovery and relay options, supporting cross-domain embeds
- Persistent peer identity and pinned indexes, anti-entropy and peer-failure recovery
- Replication scopes and explicit local IPFS pin/unpin, preview safety, retention and legal compliance
- Signed group membership/governance policies, including voting/quorums/delegation/appeals
- Verified optional Stake4Karma adapter on testnet (no real funds until independent audit)
- Cross-browser testing, two-peer smoke tests, abusive peer/flood benchmarks, security audit

More detail: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Opt-in media handling

`core/media-policy.js` enforces a local-only preview/pinning decision: by default IPFS bytes do **not** automatically download, and independently trusted reviewer quorum is needed to quarantine by CID or source event. A node operator can choose `autoUnpin` with a local unpin handler; there is no protocol-wide deletion ability. This is policy code only: the UI does not fetch arbitrary IPFS content and a real node pin manager is not yet connected. Consult local legal counsel before operating a public media host.

## Identity portability

New browser keys can be exported **only in encrypted form** using `core/identity-backup.js`: WebCrypto PBKDF2-SHA256 (300,000 iterations) and AES-256-GCM with a random salt and authenticated metadata. The backup is password-protected and can be imported on another domain, preserving the original Ed25519 public identity. Legacy non-exportable prototype keys can only migrate to a new identity with a signed endorsement; they cannot be magically extracted. **The browser must be trusted with the decrypted key while in use.** A hostile hosted copy can forge signatures, irrespective of backup encryption. There is no central password reset or key escrow.

## Practical scope

CI currently tests both the dependency-installed Node P2P sync and core cryptographic/policy unit tests. This is not a production security audit. The v2 browser UI now exchanges signed records through replaceable WebSocket-accessible OrbitDB peers. This is not browser-native direct P2P yet; a browser needs a reachable willing peer. No static site must be appointed a network leader. Any operator may eventually host discovery/relay/pinning nodes, subject to locally chosen replication and applicable law.

## Browser-to-peer transport (development)

In a separate terminal, serve the static board (its HTTP host does not store posts):

```bash
python3 -m http.server 4173
# open http://localhost:4173/v2/
```

In the peer terminal:

```bash
cd v2/network && npm install
WEB9000_WS_HOST=127.0.0.1 WEB9000_WS_PORT=8787 node node-peer.mjs ./peer-a
```

Select **Manage peers** in the browser, enter `ws://127.0.0.1:8787`, then **Connect selected peers**. Posts, governance votes and labels created while offline are queued and sent when peers return. The client verifies all signed records and stores them in IndexedDB. You can configure up to eight independent peer endpoints; no endpoint has global space ownership. A node may still decline to accept or retain a publication. The browser supports separate **replication scopes** and **local display follows**; media CIDs are only metadata until explicitly fetched by a separate, future IPFS media workflow.

For deployment on HTTPS websites, use `wss://` (TLS reverse proxy in front of the node's loopback WebSocket port). Set `WEB9000_WS_ORIGINS` to an optional comma-separated Origin allowlist, or leave it unset to accept embeds from any origin. Do not expose the unaudited development bridge to the public Internet without hardening, abuse controls, and operator-specific retention rules. Each websocket provider sees connecting IPs and the signed records requested. **This transport is not direct browser-to-browser libp2p**; replaceable WebSocket-accessible nodes are currently required for cross-domain networking, and a self-hosted peer can replace a missing one.

## Multiple unrelated indexes and selective mirroring

WEB9000 does **not** require all peers to agree on one OrbitDB address. The browser may connect to several unrelated indexes. When **Mirror trusted records between peers** is explicitly enabled, the local view can relay verified signed posts it trusts to each other chosen peer, subject to independently selected replication scopes and moderation. This is opt-in and off by default. The **Mirror approved records now** button sends currently retained and locally approved posts to configured peers without downloading media. A peer can still decline a record; no index can invalidate a signed record held elsewhere. This is a simple browser-carried bridge between different indexes, not automatic global discovery. It does not claim universal reachability or compliance screening of unseen data.

## Embed the board on an independent website

Copy the static `v2/` folder to any ordinary HTTP(S) host. The code host is not the content database. Set `?space=` to suggest a namespace, `&owner=ed25519:...` to optionally prefer one signing identity's posts, and `&embed=1` for compact embedding. Example (substitute your **own** static host):

```html
<iframe
  src="https://your-site.example/v2/?space=your-local-board&embed=1"
  title="WEB9000 community board"
  style="width:100%;height:800px;border:0"
  sandbox="allow-scripts allow-same-origin allow-downloads">
</iframe>
```

If an `owner=` key is supplied, the embedded board exposes a toggle to **ignore the site's owner-preferred view**. The preference never grants exclusive writes, removes outside authors' signed records or changes another client's policy. The site's host cannot silently pick WebSocket peers by query string; visitors configure their own peer endpoints. In embedded cross-origin iframes, browser storage partitioning and third-party restrictions may affect persistence—self-hosting on the same origin is preferred. No privacy anonymity is promised by this transport.

## Signed group forks and explicit reader choice

Two simultaneously ratified amendments to the same signed charter are **separate branches**, not a database conflict that a privileged node can resolve. The frontend now exposes a branch selector for imported groups with multiple ratified heads, persists which head the reader chooses, and preserves subscriptions while a group temporarily disappears from discovery. The **View my rules** dialog displays the selected charters. In a conflicting state, the safest default is the founding rules until the reader explicitly selects a branch.

## Image-board IPFS references

Posts now accept up to 12 signed `ipfs://` CID references in the composer. The interface displays reference counts and CIDs, but intentionally does not download arbitrary media when opening a feed. Uploading and pinning actual bytes through an independently operated IPFS node is the next media milestone.

## Default and alternate interfaces

The default `/v2/` is now the original WEB9000-style **classic image grid**: compact seven-column tiles, WASD/arrow keyboard navigation, selected-row expansion, signed comments, tag votes, reactions, polls, schedules and image attachments. Native forms are used instead of mandatory JSON fields. The former dashboard is preserved at [dashboard.html](./dashboard.html) as an alternate experimental view. [classic.html](./classic.html) remains an explicit alias of the classic frontend. All three HTML URLs use the same signed event format and browser identity store. Default public view excludes unverified authors pending an independently deployed stake/earned-karma verifier; to see raw test posts explicitly opt in using the classic toolbar.

## Normative product requirements and future handoff

**Important:** [Product requirements](../docs/PRODUCT-REQUIREMENTS.md) and [chat/decision ledger](../docs/CHAT-DECISIONS.md) govern direction, spam economics, namespace freedom, media safety and original UI acceptance criteria. Please read them before implementing changes. Features or design shortcuts in the prototype are not instructions to override the owner's words.

## Classic UI test features and mock score provider

The default board now uses original-style seven-column tiles, meaningful content badges, responsive full-width detail expansion and real-size preview media. The public **demo namespace** now holds 24 ordinary signed sample posts in the raw OrbitDB index, with real content-addressed IPFS raster images, two separate signed group charters and signed comments/votes. They are real signed events, not DOM-only demo tiles, but are **not** stake-qualified and the publisher has no ownership over the namespace. Clicking the selected tile again collapses its detail; arrow keys and WASD navigate.

To test a numeric karma provider without waiting for on-chain development, open **Test karma** from the classic toolbar, enable simulated scoring and assign a score to an ed25519 public identity. Scores of at least 10 affect this browser's local feed only. Nothing is broadcast, staked, checked on-chain or admitted into the separately curated qualified database. Disable mock mode to restore regular default trust behavior.

The current main user-facing URL is https://syburg.my.to/web9000/v2/ and the alternate dashboard remains at /v2/dashboard.html. See the normative requirements and dated chat ledger linked above. UI regression tests now assert media dimensions and same-tile collapse rather than relying only on static element presence.

## Discovering and navigating spaces, groups and search (2026-11-18)

The original-imageboard-first site now includes a horizontal strip of followed spaces, Browse for every space observed in signed posts, and user-local follow choices; namespace names are non-exclusive. First-visit sessions start in **/demo**, which only shows the site's suggested demo signer by default. Connect via **Load test peer** or **Join Network** to sync signed content. Public demo-signature trust never extends to other spaces. Nothing about the demo publisher's first arrival implies space ownership.

The classic **Clans / groups** panel lists discovered signed charters, lets anybody form an independently signed founder charter, follow a voluntary group's reviewer rules locally, submit a signed membership request and (if a voting member) propose admissions and cast ratification votes. The founder alone initially has one charter vote; the group can ratify members according to its quorum. Advanced elected councils, DAO governance, reviewer appeals, etc. remain future work; do not treat local following or membership requests as voting membership.

Clicking the search box opens a compact dropdown: New / Popular / Old / Trash, dynamic tag cloud from currently visible signed posts, search within title/body/tags/author/space/type/location/positions/price, required and excluded tags, type exclusions and an arbitrary custom-field search. Minimum karma is **mock-score only** until independent stake verification is live. Trash means locally suppressed content; it does not erase or invalidate other peers' copies.

### One-time demo seeding (operator only)

The public test data was inserted by a **local operator** into the raw unrestricted index, without disabling external WebSocket rate limits. Scripts live in network/seed-demo.mjs and network/seed-demo-extras.mjs. **Never commit** the server's private demo identity or the signed records manifest from its persistent data directory. The public key is in demo.json, used only as a suggested reader trust root in /demo. A demo file's presence is not an authorization system.

**Important:** the static frontend never needs a blockchain account to create a signed post. The optional test score provider is local mock data and must never enter the qualified index.
### Live demo and its optional own-origin peer

When `demo.json` sets `autoConnectSameOrigin: true`, a fresh reader who opens the `demo` namespace may connect to the *website operator's own host* WebSocket transport automatically, only when the advertised peer hostname matches the page hostname. The reader can click Disconnect and that opt-out is retained in IndexedDB. This is for a convenient hosted demonstration, not a fixed bootstrap requirement: self-hosted domains can leave the flag absent or false. Third-party peers are never dialed automatically by this special demo setting. The demo publisher is only preferentially trusted within `/demo` and holds no namespace monopoly.

The classic reader now presents multiple IPFS CIDs as an explicit gallery with previous/next controls. Unless the signer is individually trusted, images still require manual fetching; merely subscribing to a signed text feed never downloads arbitrary media bytes. Browser CI verifies a real multi-attachment post, comment drafting during remote updates, and the publication of a new democratic group charter.
### Signed threads, audit controls, and structured fields

Discussions are actual signed nested comment trees, with independently collapsible branches. Incoming peer synchronization does not replace an open discussion for unrelated updates or discard the active reply editor. A compact Refresh board link refreshes the feed when the reader chooses.

The Report menu publishes a signed allegation with category and reason, never a universal deletion. Audit shows reporter identity, time, reason, and the chosen local policy status; each signed report can be ignored or restored by one reader without removing its provenance or altering another reader's view. Trash can show locally filtered posts.

The composer supports searchable custom key/value attributes and a normal offer-price entry. Ordinary users are not required to submit raw JSON; supported values display readably in expanded posts.
### Identity portability on the default classic board

Use **Identity** in the classic toolbar to copy your public signing key or save a password-encrypted backup. The password must contain at least twelve characters. The backup file contains encrypted Ed25519 signing material, not public post history or IPFS files. Keep the backup and password separately and only open it on a trusted website. Restore the file into another static WEB9000 deployment using **Identity → Restore from encrypted file**; publication from the restored key carries the same public author identity without centralized login.

The Chromium end-to-end test specifically performs this backup/restore operation between distinct website origins, then checks a valid signed publication on the independently replicated peer. Production adversarial security review remains necessary; a malicious website can modify its own JavaScript.### User-facing classic layout and profiles

Opening and closing posts, keyboard navigation and direct-reply focus use the sticky-header-aware row/comment anchors. Tag chips have score/+/- controls, a 20-tag expansion pill and a separate add-tag action. Blog mode provides full-width reading excerpts; Mixed keeps three-wide text tiles. Type-filter boxes are small native checkboxes.

The first Spaces strip contains reader-selected favorites. The Groups suggest strip is optional and reads signed recommendedSpaces arrays from followed group charters; no group owns a namespace. Group founders can recommend names without reserving them.

My account contains encrypted key export/restore and a signed editable public profile. User/author pages use the same grid filtered to the signing key, with self-authored bio, website and score/stats. The karma field is explicitly TEST-ONLY unless an independent verifier is actually connected.

Site-only /demo video supports muted hover animation and a custom expanded video player; a site-hosted sound example supports a custom audio waveform mini-player. These legacy video/audio bytes are site-hosted, NOT IPFS-pinned: only separately uploaded image CIDs are served by the currently running image-only IPFS peer. The media source allowlist is restricted to the trusted demo signer.
### Optional live site regression

From the network package directory, run npm run test:live-ui with Chromium available at /usr/bin/chromium. This verifies the actual hosted demonstration, including signed imageboard examples, audio and video preview, a voluntarily followed group recommendation charter, a public signing-key profile and mobile overflow. WEB9000_LIVE_URL overrides the target for an equivalent hosted demonstration. This check depends on separately deployed public services, so it is intentionally not part of the isolated core CI. It does not assert any independent Stake4Karma verification.### Media-first detail, shared sound and consentful publishing

Expanded posts show primary image/video/audio first, then title, signed metadata, reaction/report/audit bar, tags, prose/structured content and discussion. The redundant Close button is removed; click the selected tile again or press Escape. No application-induced scrolling occurs on comment composition or voting. Closing preserves scroll while most of the selected row remains visible, and reanchors only when it is clipped.

Mixed view promotes only substantive text-first discussion and idea posts with larger text, extra vertical spacing and a subtle gold accent, not a dark overlay over the entire grid. Media remains compact and visually catchy; ideas can also define open collaborator positions.

The compact thumbnail and expanded sound player use ONE shared audio engine, so playback and seek position persist through open, close and rerender. Signed demo videos use their own video frames and minimal translucent custom controls. Polls have distinct voting-option rows, visible totals and selected state.

The ordinary post composer requires preview and affirmative acknowledgment that independent replicas cannot reliably delete already published data. A primary IMAGE may be selected before signing and is used for post thumbnail and gallery selection. Mixed image/audio/video archives and arbitrary preferred media are future milestones, not yet operational uploads.### Signed post correction and withdrawal (experimental)

From a post you signed, use Correct this post to create a new independently signed version with the same original post ID for comments, ratings and links. Ordinary post preview and permanence consent are mandatory. Editing does NOT rewrite earlier records. Existing attached image CIDs are retained unless you explicitly replace them with new uploaded images. Any previous version's media may continue to be hosted by willing peers.

Request withdrawal creates an author-signed public intent statement. By default the reader's normal feed hides that post, but the signed original is still inspectable in Trash, including its readable immutable history and signed correction/withdrawal actions. Another reader can disable the 'Hide author-withdrawn posts' preference in Advanced search without affecting your view. The author may later sign a Restore request, which does not erase the previous withdrawal.

The independent test peer and ordinary text database DO NOT support universal deletion of published events. These tools cannot promise removal from other sites, peers, backups, or IPFS stores. Signed corrections and withdrawal requests have no global authority.
The isolated Chromium multi-origin test also confirms cross-site propagation of corrections and signed withdrawal/restore events through the real peer. The second website independently updates its local visibility rules; no site is permitted to delete signed records for another website.### Mixed attachment publishing (experimental)

Choose Post and attach up to six JPEG/PNG/WebP, MP3/Ogg/WAV, or MP4/WebM files in any order. The preview shows each attachment and lets you select which one leads the grid; absent a selection, a picture takes priority, then video, then audio. Images are limited to 256 KiB each, audio and video to 10 MiB each. The preview and acknowledgement that independently replicated media cannot reliably be removed remain mandatory.

The signed post contains CID references and an optional ordered mediaTypes array, never the binary media itself. The selected audio/video/image is represented on the grid using the original-style mini-player, muted hover-preview, or picture. In the expanded post, small attachment chips switch among the custom players. Unknown signing keys never cause automatic media fetches. If your chosen peer no longer has a CID, the original signed text and reference remain intact.

Peer operators can enable small raster uploads via WEB9000_MEDIA_UPLOAD=1. Rich-media uploads require a **separate** WEB9000_MEDIA_RICH_UPLOAD=1 switch. The latter defaults OFF in the software but is explicitly ON for the limited public pilot as of 2026-11-18. Audio and video are capped at 10 MiB (10,485,760 bytes) PER FILE; images remain capped at 256 KiB. The public operator sets WEB9000_MEDIA_STORAGE_MIB=256 for a 256 MiB local media budget. The optional Helia UnixFS module supports chunked audio/video content, HTTP 206 byte-range seeking, format-header and digest checks, and operator-local quotas (2 rich uploads and 12 images per client address per UTC day), persisted across restarts. For Nginx behind Docker, WEB9000_MEDIA_TRUST_PROXY must equal the observed bridge gateway IP so the backend accepts Nginx-overwritten X-Real-IP only from that trusted address. Nginx enforces client_max_body_size 10m (binary units) and per-client POST ingress rate-limits; playback GET/range requests are not counted. Neither IP throttling nor MIME-header checks are production anti-bot or legal-content screening. This is not production anti-spam, content scanning, viral IPFS pinning or any global right to delete content. Deploying this on a public node without abuse-handling policies is not recommended.
### Transfer progress (2026-11-18)

The classic post-preview dialog now shows real per-file browser upload progress (binary attachment upload through `XMLHttpRequest.upload.onprogress`), not an inert spinner. The existing Edit/Close actions can interrupt the active transfer; native Escape closure also aborts the current upload rather than silently continuing. Once all files have been accepted, the controls lock briefly while the immutable signed publication is created. Previously completed uploads cannot necessarily be recalled from the independent media peer, even if a later file is cancelled or the publication is never signed. The 10 MiB file cap applies equally to audio and video; uploads may be restricted further by the chosen operator's local quotas.


### Group signing, timed decisions, and proof portability (2026-11-18)

Groups now have ratifiable signed names, descriptions and namespace recommendations, cryptographic member-threshold attestations and **reader-selected governance forks**. An optional versioned `timed-v1` charter (default in the new-group form) supports 7-day ordinary For/Against **advisory** motions with minimum member turnout, 7-day group information changes, and 14-day high-impact membership/quorum/moderator amendments with **absolute** eligible-member signature floors. Older charters keep their previously published quorum policy, unless the members independently ratify an upgrade. Unverified/mock karma does not confer extra voting rights.

From the **Clans** panel, export a portable signed group-branch proof and import/verify it with the local browser verifier. The same JSON can be verified without a browser or any network using `node v2/network/verify-group-proof.mjs <file.json>`. The certificate establishes one ratified chain, **not** that there are no later amendments or competing forks. Signed participant timestamps are not a trustworthy global wall clock, so timeouts and ordinary-motion outcomes do not yet offer trustless finality. A dual democratic + independently validated, capped karma chamber and dormant membership protection remain future work. See [docs/GROUP-GOVERNANCE.md](../docs/GROUP-GOVERNANCE.md).


### Decentralized raw debugging and personal friend/foe labels (2026-11-19)

The classic board now has a compact **Debug** button to inspect real signature-verified local records, actual browser WebSocket protocol frames (including OrbitDB index hello/sync/ack), approved peer/media gateways, outbox replication status, local group policy and friend/foe labels. Filters cover source, event/packet kind, namespace, author, free-text JSON and a bounded result count. Click an entry for its raw JSON; copying or exporting is an explicit console action. The packet ring buffer retains 250 frames, truncating individual frames above 16 Ki characters; full verified signed records remain available in the events source.

**2026-11-19 clarification:** The owner requires **no debug/record-copy controls inline**. The only Debug entry is the **top-right header**, which opens a dedicated pop-up. Inside, select a locally stored post and press **Dump post** or **Dump comments** to inspect full signed history and the nested local reply tree. WebSocket traffic has been buffered since the page connected (before the console opens); the view updates live, can be paused without stopping capture, and up to 125 recent frames × 8 Ki characters survive same-tab reload in sessionStorage. The old inline Copy CID, Inspect signed event and dump controls are removed. The debug console does not contact unapproved peers, download IPFS media, or reveal private signing key material.

**Add friend / Add foe** are local-only, mutually exclusive, reversible personal labels visible in posts and profiles. They do not automatically grant old trusted-media permissions, change governance eligibility, assert independently verified karma or propagate a public relationship graph. Existing legacy trust is kept distinct for compatibility and may be revoked in the social debug view. See [docs/DEBUG-CONSOLE.md](../docs/DEBUG-CONSOLE.md) and [docs/GROUP-GOVERNANCE.md](../docs/GROUP-GOVERNANCE.md).

The owner's new proposal eligibility requirement is *future work*: karma plus a minimum age of approved group membership should primarily gate **proposing** votes, not make high-karma accounts rule elections. Charter-configurable, size/activity-aware thresholds and specialized nested-group moderation delegations remain deliberately unspecified until the independent karma evidence model and abuse tests are ready.


### New-instance handoff and researched protocol risks (2026-11-19)

Start at [docs/STATUS.md](../docs/STATUS.md) for the one-screen status, followed by [docs/OPEN-ISSUES.md](../docs/OPEN-ISSUES.md) for the prioritized unresolved engineering/design work. The corresponding code-based risk and user-vision comparison is [docs/BACKEND-AUDIT.md](../docs/BACKEND-AUDIT.md); Nostr/NIP/Blossom protocol lessons and anti-patterns are in [docs/NOSTR-RESEARCH.md](../docs/NOSTR-RESEARCH.md). Every new development session must also read the repository root [AGENTS.md](../AGENTS.md), owner requirements and dated chat decision ledger; prototype implementation choices do not imply owner approval.

2026-11-19 consent fix: peer suggestions prefill the network/media form **without** activating the suggested media gateway. Only an explicit Connect action can promote a suggestion to an approved gateway for potential media retrieval. **Migration:** old browser-stored gateway URLs without a `classic-media-approved-v1` marker are preserved as **inactive pending-review** URLs and require a new Connect click, even if the reader had approved them in an earlier release; old storage did not distinguish a manual approval from an auto-saved suggestion. Pending URLs survive saves/reloads. Cross-origin Chromium tests cover fresh consent, migration, persistence and explicit reapproval.


### Opt-in signed append validation at the OrbitDB storage boundary (2026-11-19)

The original `openPublicIndex` uses OrbitDB's public IPFS access controller (`write:['*']`). It verifies WEB9000 Ed25519 before its own `publish` method and when importing into the `Replica`, but a malicious OrbitDB writer can call the underlying database's `add()` directly and physically append invalid data. This is **confirmed** by a two-peer adversarial test and is not the same as granting content validity/namespace ownership.

New, independently created peers may explicitly opt into the **versioned signed-event append controller**:

```sh
cd v2/network
WEB9000_RAW_SIGNED_INDEX=1 node node-peer.mjs ./peer-signed web9000-public-signed-v1
npm run test:signed-index
```

The controller type `web9000-signed-v1` uses the ordinary public `write:['*']` writer identities, but additionally checks the **full signed WEB9000 v1 event** in OrbitDB's `canAppend` on both local operations and incoming log merges. Any independently signed author can publish into **any** public namespace. Forged, tampered or oversized direct entries cannot enter compliant signed indexes. The 48 KiB wire-event bound is a fixed part of this v1 index's replica rules (not an operator-specific quorum).

**Compatibility and migration:** this changes the OrbitDB address. A signed-mode peer requires a **fresh data directory**. The `raw-index-selection.mjs` guard stores `.web9000-signed-raw-index-v1.json` with mode/index identity and refuses reusing an existing legacy peer directory, changing the signed index name, or downgrading a previously signed directory. These are deliberate safety errors, not a request to delete data. A new signed peer can restart on its originally selected directory/index normally. Existing raw indexes, including the hosted test peer with its persistent signed events, remain on the legacy format by default; setting `WEB9000_RAW_SIGNED_INDEX=1` against an old OrbitDB address explicitly fails instead of silently mislabeling it as protected. Future migration must deliberately publish each *independently verified* old signed event into a new index, show both addresses to readers until they adopt the new one, and preserve local backups. There is no automatic data copy, forced network join, re-signing by the curator or censorship of alternate legacy indexes. The controller does not eliminate CPU/bandwidth attacks, invalid IPFS block requests or all storage abuses; don't describe it as full DoS protection.


### Safe offline migration of verified legacy raw events (2026-11-19)

`node migrate-raw-index.mjs --source-dir OLD_SNAPSHOT --source-index /orbitdb/OLD_ADDRESS --destination-dir NEW_DIRECTORY --destination-name web9000-public-signed-v1` runs a **dry-run by default**. It verifies local signed records, counts any malformed/duplicated/oversized log entries and prints a SHA-256 source snapshot fingerprint and a sorted accepted-event-set digest. It does not create or modify the destination. Copy requires an **explicit second run** with `--execute --expect-snapshot SHA256_FROM_DRY_RUN`; source changes abort before creating a new directory, and signatures/record IDs are verified again after copying. Interrupted copies can be re-run with `--execute --resume --expect-snapshot CURRENT_SHA256` without duplicating records. Existing source identity/index and all voluntary media stay untouched; no browser or peer preference is silently switched. The new signed index must use a distinct, initially empty data directory. **Stop the source peer first**, preferably running the copy against a consistent offline snapshot. See [docs/RAW-INDEX-MIGRATION.md](../docs/RAW-INDEX-MIGRATION.md). The operator still needs actual multi-peer completeness checks and manual rollout; this CLI alone is NOT proof of network history completeness.


### Outbound libp2p Bitswap media-serving quarantine (2026-11-19)

A media-enabled `node-peer.mjs` installs the independent operator-local `media-bitswap-policy.mjs` broker before Helia starts. Earlier HTTP `/ipfs` quarantine only blocked that gateway; Bitswap directly read the shared Helia blockstore. The new outbound-only broker protects raw image blocks, UnixFS DAG-PB roots **and child chunks**, dynamically consulting the local manifest and revocable quarantine file. Unmanifested raw/DAG-PB (including orphaned rejected-upload bytes) is not volunteered via Bitswap; malformed policy fails closed. Signed OrbitDB metadata still uses its existing blockstore path and is tested to synchronize between independent peers during a media refusal. This is **not global deletion** or guaranteed protection against other transfer protocols, preexisting copies, in-flight reads or physical disk retention; operators remain free to choose what they host. `cd v2/network && npm run test:media-bitswap` runs real two-peer block requests, active UnixFS-child quarantine, orphan refusal, corrupt policy and restoration tests. See [docs/MEDIA-REPLICATION.md](../docs/MEDIA-REPLICATION.md) and [docs/OPEN-ISSUES.md](../docs/OPEN-ISSUES.md).


### Voluntary selective metadata synchronization (2026-11-19)

Under **Join Network**, `Sync namespaces` accepts **one public namespace per line** or `*` for all (the backwards-compatible default). Select `demo` to request only demo records, `groups` to request group governance, or both on separate lines. Scope is independent of which space the UI currently displays, of the owner's suggested view and of which spaces you can publish into. The browser stores the choice locally and filters *signed* incoming records again even when a peer ignores the requested scope; it does **not** retroactively erase older records or pretend a local snapshot contains all network history. Chosen scope names are visible to connected peers. No media is downloaded/pinned automatically as a result. **2026-11-19 bridge improvement:** the server now maintains a sorted ID index for each public namespace and the wildcard scope, updated only after `Replica.ingest` accepts a valid signed event. The bridge no longer clones, filters and sorts the entire replica on every 32-record page. Every new subscription creates a fixed local `snapshotRevision` for history pages, and independent live `event` messages still deliver new records during the walk. A reconnect starts a fresh local snapshot. The revision is **not a cryptographic checkpoint, a guarantee of all peers' events or Negentropy**. Tests: `npm run test:indexed-sync` in `v2/network` in addition to the regular browser and peer suite. Tests: `cd v2/network && npm run test:scopes && npm run test:browser-bridge && npm run test:classic-ui`.


### Restore image previews without unapproved third-party downloads (2026-11-19)

Earlier gateway-consent migration correctly changed unapproved `peers.json` media URLs to pending review, but users then saw **IPFS media · open to choose what to load** across the imageboard and **No independent IPFS media gateway configured** even after pressing manual image load. An unapproved gateway suggestion now exposes a visible **Enable images · HOST** control in the compact toolbar. The reader's one click approves that explicitly displayed media host, saves the same `classic-media-approved-v1` permission marker as the Join Network form, and re-renders the board so trusted/demo signed images can lazy-load as tiles. Clicking an individual **Load image from HOST** button also approves the named suggested media host in that user action and immediately displays the chosen image. Other authors remain opt-in. Raw media IPFS CIDs, public signed records and metadata are unchanged; no unknown host is fetched without a visible action and normal browsing never pins/serves media. The previously implemented site-side same-origin WebSocket auto-connect is separate from media-host approval.


### Hosted demo images work automatically without user activation (owner correction, 2026-11-19)

The user explicitly requested reversing the `Images off · enable media gateway above` behavior. The site's `demo.json` has `autoConnectSameOrigin:true` and declares a `galleryPeer`. If its scheme, hostname **and port** exactly match the currently visited website, `classic.js` can automatically load retained IPFS image previews as ordinary first-party website media, even for unknown signed authors. It does **not** pretend the visitor approved a third-party gateway: the local `classic-media-approved-v1` marker stays false unless manually approved. The same-origin rule does not grant namespace ownership, post censorship, IPFS mirroring, or the right to contact a different origin. A malicious off-site `galleryPeer` in a site config or signed provider claim remains opt-in. Picture cells still use native lazy loading when off-screen; the **hosted imageboard works on first visit** without any buttons. Both the independent-sixth-origin Chromium test and actual live hosted URL test cover this.


### Compact draggable spider editor (2026-11-19)

Click the small **🕸 icon directly after the popularity number** under an opened post. It opens one fixed-position five-axis spider chart (age suitability + controversy, democratic urgency, intellectual importance and spam likelihood). Drag any dot inward/outward, click the labeled axis to read its explanation, or focus a dot and use arrow keys/Home/End. Text updates as values move. Select **Publish signed rating** to publish the personal assessment; no automatic age filtering is enabled just by rating. Independent recognized opinions are shown as a dashed comparison shape; optional source review/trust is nested inside the popup. The previous space-consuming full-width rating dropdown is removed.

The **gray dashed polygon** is the median of the **latest signed ratings from OTHER authors** received by this browser, regardless of current personal trust. The editable pink polygon remains **your own draft**, excluded from gray; its live background updates if new signed peer ratings arrive while editing. The legend distinguishes *other signers observed* from *recognized raters permitted to affect filters*. This background is informative only; neither an untrusted author nor a forged group claim gains power to hide or blur. Future reader-selected extended federations will require independently ratified group memberships and delegation before limiting the background to verified trusted keys. The pure aggregator already supports an explicit \`approved-authors\` scope but automatic federation discovery is **not yet implemented**.

For exceptional democratic-interest news / censorship-pressure alerts choose **⚑ Report → Public-interest / censorship-pressure alert** and describe the evidence. This signs an independent \`label\` event, *not* a new content suitability rating. It does not change the post's age or four chart scores. Existing older content-rating records containing \`publicInterestAlert\` remain compatible. The editable reader-side blur/hide thresholds are still under Search & filters, not in the post body.

### Independent per-post content ratings and group/reviewer accountability (2026-11-19)

Expanded signed posts now contain a **tiny spider icon beside the popularity number** leading to an interactive **five-axis spider popup**, replacing the former large Suitability & importance panel. The age scale distinguishes All/PG/13+/18+/extreme adult/gore and a clearly **unverified potential-legal-concern** warning; the other independent 0–5 ratings are controversy/censorship pressure, democratic urgency, intellectual importance and spam likelihood. Popularity votes remain distinct. The special boolean public-interest alert requires multiple independently recognized sources for even the *text-first* view and never bypasses economic spam admission. Group reviewers are recognized only when independently ratified on a reader-subscribed selected group branch. An asserted `group` value alone has no authority. Browser-local **Search & filters → Content ratings** has versioned, adjustable **disabled-by-default** threshold effects: blur after 2 recognized age-18+ ratings, hide preview after 5, or clear the automatic restriction in response to 2 credible contrary ratings (including the owner-given 10-versus-2 counterexample). Changes affect only the reader's **media preview** and can be revealed locally; signed metadata is never removed. Display-only independent opinions and reviewer trust choices are inspectable.

The Clans/groups panel also permits signed individual **group trust/distrust** opinions and self-nominated reviewer candidacies. Appointment or exclusion remains a ratified group charter vote; the user's own role claims alone confer no authority. Recognized reviewers have readable signed rating/flag activity on their profiles, along with individually signed conduct opinions. These signals are **not** group bans, cross-group judgment contests, proven reviewer accuracy, legal adjudication, involuntary group-member punishment or an automatic reputation economy. Later algorithmic tuning requires versioned, reviewable suggestions, migration paths, opt-in acceptance and careful Sybil defense. See [docs/COMPOSABLE-MODERATION.md](../docs/COMPOSABLE-MODERATION.md).

### Optional independent-peer metadata comparison

The first read-only anti-entropy diagnostic can compare two explicitly selected WebSocket peers' *local* signed-record histories by namespace. From v2/network with Node 22+ and dependencies installed:

    node reconcile-mirrors.mjs ws://HOST1:8787/ ws://HOST2:8787/ --space=demo

It reports missing signed IDs between those two observations; only an **explicit** --repair-to=first|second|both option attempts to copy original verified signed text/metadata envelopes into a willing peer's normal publication path. It never pins or copies IPFS media, and neither peer's inventory is authoritative or proven complete. See [docs/PEER-RECONCILIATION.md](../docs/PEER-RECONCILIATION.md) for the exact wire commands, privacy caveats, budgets and tests.

### Larger text in grid, optional peer Debug comparison

Text-only previews in the Classic seven-column grid use 14 px text and H2-height padding above and below, rather than the prior 12 px compact copy. In Mixed, wide text-first tiles use 16 px text and balanced vertical spacing. Image/video thumbnails stay unchanged. Browser tests inspect both computed styles.

Under header-only Debug, a collapsed comparison panel offers a **read-only** inventory check between two reader-approved WebSocket peers, queried only after an explicit click. Scopes come from the reader's chosen namespace subscription; no media is downloaded, no signed metadata is repaired and the result is only a peer-reported local snapshot. See docs/PEER-RECONCILIATION.md.
