# WEB9000 — one-screen project status

**2026-11-19 · `overhaul/orbitdb-trust-v2` · draft PR #1 · `main` untouched**

**Start here when resuming work.** For detailed tasks and links see [OPEN-ISSUES.md](./OPEN-ISSUES.md); for discovered technical/design mismatches see [BACKEND-AUDIT.md](./BACKEND-AUDIT.md); all exact owner constraints are in [PRODUCT-REQUIREMENTS.md](./PRODUCT-REQUIREMENTS.md) and dated [CHAT-DECISIONS.md](./CHAT-DECISIONS.md). **AGENTS.md is mandatory for new instances.**

**Working prototype:** seven-column classic WEB9000 board, signed posts/comments/metadata, corrections/withdrawals, group charter/quorum votes and proof export, local author friend/foe, raw WebSocket/record debug, actual Helia/OrbitDB peers, volunteered IPFS media hosting with images ≤256 KiB and audio/video ≤10 MiB, explicit media-provider claims and manually approved backup gateways. Browser does **NOT** automatically pin/serve file bytes. Qualified index exists but admits **no verified users**.

## First things to fix

| Priority | Gap | Why it matters |
|---|---|---|
| P0 | Real independently checked Stake4Karma / earned reputation | Current score and qualified index are deliberately nonfunctional simulations |
| P0 | Media refusal at **IPFS block-serving layer**, safe ingest/auth | HTTP quarantine may not cover P2P retrieval; crafted or illegal bytes and unbounded storage remain operator risks |
| P0 | Raw OrbitDB append-validation and resource limits | `write:['*']` may allow remote DB writers to bypass wrapper signature verification and fill the physical log |
| P0 | Witnessed time, group checkpoint integrity, signing-key custody | Backdated/missing votes, website-controlled browser keys and unverifiable claim of latest group history |
| P1 | Verified karma + **approved membership tenure** to **start proposals** | Latest owner direction; follow/subscription is not group membership. Signed member karma/anti-karma and membership votes unimplemented |
| P1 | Scoped nested-group specialized moderation and appeals | Current `delegate` inheritance is coarse; no categories, expiry, auditable specialist authority or challenge |
| P1 | Selective replication, anti-entropy and independent discovery | Current browser bridge wildcard `['*']` and manual/static peer discovery do not scale or prove completeness |
| P1 | Browser CID integrity, opt-in media mirroring and quotas | Reader-approved hosts exist, but no UnixFS byte validation or browser mirror storage budgets |
| P2 | Owner's UI walkthrough, votes below posts, debug coverage | Clans dialog is prototype; debug doesn't expose native P2P or Bitswap traffic |
| DESIGN | Tune karma/anti-karma, activity-sensitive thresholds, dormancy, group hierarchy | **Not owner-approved numerical rules** — avoid imposing or guessing them |

**Concrete fix in current audit:** `loadSuggestions` no longer silently authorizes the suggested media gateway; the browser requires an explicit Connect click. Older persisted gateway URLs are preserved as **pending review** until reapproved (even previously manually approved URLs require one confirmation because old versions did not record consent distinctly). Chromium tests exercise both flows. Confirm CI and deployment state on the final pushed commit before declaring release.

**Nostr research:** [NOSTR-RESEARCH.md](./NOSTR-RESEARCH.md). Best concepts to adapt are NIP-77 Negentropy, NIP-65 outbox discovery, NIP-32/56 signed moderation evidence, NIP-46 remote signer, and Blossom's verified/replaceable media hosts. NIP-29's relay-administered groups violate WEB9000's resistance to administrator capture as the default governance primitive.

**Don't regress:** no namespace owner, no global deletion, no required credential for signature-valid raw publishing, no forced media mirroring, no public social graph without consent, no fabricated karma, no silent 'latest' authority or arbitrarily simplified seven-column UI.

**Tests:** `docker exec web9000-test-peer sh -c 'cd /app/v2 && npm test'` and `docker run --rm --network host --ipc host -v /srv/web9000/source:/app -w /app/v2/network web9000-test-chromium:latest npm run test:classic-ui`. GitHub Actions must pass **on the exact pushed head**. Preserve `/srv/web9000/data`, node keys, OrbitDB and untracked screenshot artifacts.
