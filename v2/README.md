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

Choose Post and attach up to six JPEG/PNG/WebP, MP3/Ogg/WAV, or MP4/WebM files in any order. The preview shows each attachment and lets you select which one leads the grid; absent a selection, a picture takes priority, then video, then audio. Images are limited to 256 KiB each, audio to 8 MiB each and video to 12 MiB each. The preview and acknowledgement that independently replicated media cannot reliably be removed remain mandatory.

The signed post contains CID references and an optional ordered mediaTypes array, never the binary media itself. The selected audio/video/image is represented on the grid using the original-style mini-player, muted hover-preview, or picture. In the expanded post, small attachment chips switch among the custom players. Unknown signing keys never cause automatic media fetches. If your chosen peer no longer has a CID, the original signed text and reference remain intact.

Peer operators can enable small raster uploads via WEB9000_MEDIA_UPLOAD=1. Rich-media uploads require a **separate** WEB9000_MEDIA_RICH_UPLOAD=1 switch. The latter stays OFF by default, including on the public demonstration until an operator decides the legal/safety exposure is acceptable. The optional Helia UnixFS module supports chunked audio/video content, 206 byte-range seeking, file magic and digest checks and finite test quotas (2 rich uploads per peer-visible address per UTC day, 12 images, 64 MiB local media budget). This is not production anti-spam, content scanning, viral IPFS pinning or any global right to delete content. Deploying this on a public node without abuse-handling policies is not recommended.