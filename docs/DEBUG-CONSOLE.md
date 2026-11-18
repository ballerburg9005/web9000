# WEB9000 debug console and local friend/foe labels

The classic seven-column image board includes a compact **Debug** button. Debugging is a *reader-controlled* tool; it never authorizes a peer to moderate public namespaces, collect stored binary IPFS media, or access someone else's signing keys.

## Debug console

The dialog is deliberately a **raw-data inspector**, not a new dashboard. Open Debug from the classic toolbar, or choose **Dump post** / **Dump comments** inside an expanded signed post.

Sources:

- **Signed events:** every signature-verified event currently in this browser's replica, including posts, nested replies, votes, labels, group charters and amendments, group membership requests, withdrawals, profiles, and signed IPFS provider advertisements. Each selected entry shows its actual immutable `{id,payload,signature}` envelope.
- **Network packets:** a bounded session trace of actual browser WebSocket frames. The transport exposes `hello` messages with the peer's announced OrbitDB index, subscribe/sync frames, raw batches, publications, acknowledgments, local connection-state changes and rejections. Traces are locally recorded even when the inspector is closed, but are never uploaded merely because debugging is enabled. The ring buffer retains at most 250 entries, up to 16 Ki characters per frame; a larger frame is explicitly marked truncated. Inspect signed records separately for their full untruncated JSON.
- **Post / comment dump:** the post button opens the full signed original, corrections, withdrawal/restoration history and directly associated reactions, tag votes, labels and poll choices. The comments button dumps the complete **locally available nested reply tree**, including reactions/labels targeting replies. The word 'complete' applies to the browser's known signed records only; disconnected peers may have additional records.
- **Friends / foes:** inspect the browser's private, reversible relationship labels. Previously granted author trust remains a **distinct, legacy** local setting; it is shown separately and can be explicitly revoked. The friend/foe action does not grant the old trust permission.
- **Peers, IPFS, replica & policy:** a snapshot of locally selected WebSocket peers, session subscriptions, outbox acknowledgments, locally selected IPFS gateways (no automatic pinning), observed voluntary group branches, signed-event counts and presentation policy.

Filters: source, record/packet kind, namespace, author key and free-text raw JSON search, plus a selectable result cap. Entries can be viewed individually and exported as JSON or copied. *Copy selected JSON* replaces the previous inline 'Copy signed record' buttons; the post detail only offers the two more useful dump actions. The signed-history view provides an Inspect action.

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

The Chromium test opens the real compact post detail, changes friends to foes and back, verifies that no relationship event was broadcast, inspects a signed post and nested comment dump, and observes actual raw WebSocket packet frames. Both HTML entry points and local workflow are covered by the normal core tests.

Future work: independent/aggregated karma accounting, public social graph controls, cross-domain friend sync with separately signed claims, network diagnostic buffering beyond browser sessions, media verification against IPFS CIDs and P2P block-level debug inspection.
