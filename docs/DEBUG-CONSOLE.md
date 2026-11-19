# WEB9000 debug console and local friend/foe labels

The classic seven-column image board includes a compact **Debug** button. Debugging is a *reader-controlled* tool; it never authorizes a peer to moderate public namespaces, collect stored binary IPFS media, or access someone else's signing keys.

## Debug console

The dialog is deliberately a **raw-data inspector**, not a new dashboard. Open **Debug** from the **top-right header next to Join Network**. The ordinary post interface has **zero raw inspection actions** (no inline Dump post, Dump comments, Inspect signed event, Copy signed record, Copy CID or copied label ID). Choose the signed post **inside the pop-up console** and use the dedicated **Dump post / Dump comments** buttons there. The console opens with recent traffic by default, including traffic recorded **before** the pop-up opened.

Sources:

- **Signed events:** every signature-verified event currently in this browser's replica, including posts, nested replies, votes, labels, group charters and amendments, group membership requests, withdrawals, profiles, and signed IPFS provider advertisements. Each selected entry shows its actual immutable `{id,payload,signature}` envelope.
- **Network packets:** a bounded, live-updated session trace of actual browser WebSocket frames. The transport exposes `hello` messages with the peer's announced OrbitDB index, subscribe/sync frames, raw batches, publications, acknowledgments, local connection-state changes and rejections. Traces are locally recorded even when the inspector is closed, but are never uploaded merely because debugging is enabled. The in-memory ring buffer retains at most 250 entries, up to 16 Ki characters per frame; a larger frame is explicitly marked truncated. A **shorter recent trace of up to 125 entries × 8 Ki characters** is retained in browser **sessionStorage** across reloads of that tab, and the **Clear network trace** button clears both copies. The **Live view** checkbox pauses *redrawing only*, not the ongoing capture; **Refresh** displays everything received during the pause. Inspect signed records separately for their full untruncated JSON.
- **Post / comment dump:** inside the Debug pop-up, select a locally stored post from the post selector. The **Dump post** button opens the full signed original, corrections, withdrawal/restoration history and directly associated reactions, tag votes, labels and poll choices. The comments button dumps the complete **locally available nested reply tree**, including reactions/labels targeting replies. The word 'complete' applies to the browser's known signed records only; disconnected peers may have additional records.
- **Friends / foes:** inspect the browser's private, reversible relationship labels. Previously granted author trust remains a **distinct, legacy** local setting; it is shown separately and can be explicitly revoked. The friend/foe action does not grant the old trust permission.
- **Peers, IPFS, replica & policy:** a snapshot of locally selected WebSocket peers, session subscriptions, outbox acknowledgments, locally selected IPFS gateways (no automatic pinning), observed voluntary group branches, signed-event counts and presentation policy.

Filters: source, record/packet kind, namespace, author key and free-text raw JSON search, plus a selectable result cap. Entries can be viewed individually and exported as JSON or copied. *Copy selected JSON* and *Download filtered JSON* are available only inside the pop-up. Post details, revision history, and inline reactions do **not** expose raw dump/copy/inspect controls. Non-debug human-readable audit summaries and moderation actions remain part of the normal reading interface.

**Security:** debug view uses `textContent` for untrusted values and does not interpret any event body as HTML. It only exposes public signed data already replicated locally, public signing identities, selected peer/gateway URLs, outbox public IDs, and personal local relationship labels. It must not serialize private signing keys, wallet credentials or encrypted backup passwords into debug logs. Sending an exported debug file to other people may disclose your peer choices, relationships and local reading preferences; exports are explicit only. The console does not query other servers, issue a download, or pin content just because the window is opened.

The early WebSocket bridge has no globally authoritative completeness guarantee; a local debug record set is not the entirety of the decentralized network.

## Add friend / Add foe

The former **Trust author** button is gone. Each other author's post and profile may show **Add friend**, **Add foe**, **Remove friend** or **Remove foe**. Personal friend/foe labels are mutually exclusive, immediately reversible and persisted in this website origin's IndexedDB alongside the user's existing preferences. They are **local-only**, not signed or broadcast, until public relationship publication and privacy controls are designed.

Friendship **does not** automatically make a stranger's media safe to auto-fetch, authorize mirror replication, guarantee default-feed admission, confer membership, give proposal/voting eligibility or assign independently verified credibility. Foe labeling **does not** globally blacklist a person, reduce their real-world reputation, auto-moderate them or remove their posts. In the current compact grid, a 2px marker can indicate a locally chosen friend/foe; its only semantic meaning is personal classification. A later, independently verified and appealable reputation policy may decide how to interpret friend/foe signals, ideally with controls for privacy and sybil-resistant graph weighting.

Existing stored `classic-trust` choices remain separate for backward compatibility; they can be removed under **Debug → Friends / foes**. Setting a formerly trusted key to Foe explicitly revokes its old local trusted-author permission as a safety precaution.

## Test commands

```sh
cd v2 && node --test test/debug-social.test.js
cd v2/network && npm run test:classic-ui
```

Chromium verifies raw dump controls exist **only inside the header Debug pop-up**, friendship and foe actions remain separate from public relationship publication, post and comment dumps use the in-console selector, live packets are buffered before opening Debug, recent traffic survives a reload, and a paused view does not stop capture. Both HTML entry points and local workflow are covered by the normal core tests.

Future work: independent/aggregated karma accounting, public social graph controls, cross-domain friend sync with separately signed claims, durable opt-in network diagnostic archives beyond a browser tab, media verification against IPFS CIDs and P2P block-level debug inspection.


## Automatic first-party imageboard media

A later owner clarification requires that the page **never show "Images off · enable media gateway above" in the hosted first-party WEB9000 demo**. The active demo config explicitly declares `galleryPeer` as `https://syburg.my.to/web9000/media/`, which shares the page's exact origin. This site's own media can automatically render public signed imageboard previews, including posts by unknown authors. It is not an instruction for browsers to pin/serve those bytes or to visit any external host: cross-origin candidates and unrelated IPFS providers still require reader approval. Automatic site hosting is separate from `classic-media-approved-v1` and must not write a forged consent flag.
