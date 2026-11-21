**TESTNET UPDATE (2026-11-21):** The experimental Base Sepolia TEST ETH flow now includes a separate testnet-only issuer, browser wallet/deposit/challenge/grant controls, explicit testnet-mode gateway isolation, and a real Helia testnet-grant upload above 21 MiB. Testnet does NOT make its simulated $100/$1,000 tiers real dollars; the production-dollar issuer remains disabled. See [TESTNET-MEDIA-STAKING-2026-11-21.md](TESTNET-MEDIA-STAKING-2026-11-21.md).

# WEB9000 media priority and Stake4Karma-sized uploads (2026-11-21)

**Status: implemented and tested in the repository, NOT activated on the hosted peer.** Binary units: KiB=1,024 bytes and MiB=1,048,576 bytes. This is a local resource-priority mechanism, NOT content moderation or global authorship authority. The owner's 20-new-physical-OrbitDB-database ceiling stays unchanged.

## Default media priority table

| Category | File size | Rank / physical lane | Who can upload |
| --- | --- | --- | --- |
| Image | ≤50 KiB | 0 / tiny, reserved | Anyone |
| Image | >50 to 100 KiB | 1 / small, reserved | Anyone |
| Image | >100 to 256 KiB | 2 / standard | Anyone |
| Image | >256 to 512 KiB | 4 / standard | Anyone |
| Image | >512 KiB to 1 MiB | 10 / heavy | Operator-verified stake grant |
| Video | ≤1 MiB | 5 / standard | Anyone |
| Video | >1 to 3 MiB | 7 / heavy | Anyone |
| Video | >3 to 4 MiB | 8 / heavy | Anyone |
| Video | >4 to 5 MiB | 9 / heavy | ≥$100 verified stake |
| Video | >5 to 10 MiB | 10 / heavy | ≥$100 verified stake |
| Video | >10 to 20 MiB | 11 / heavy | ≥$100 verified stake |
| Video | >20 to 100 MiB | 12 / heavy | ≥$1,000 verified stake |
| Audio | ≤1 MiB / ≤4 MiB / ≤10 MiB | 3 standard / 6 heavy / 9 heavy | Anyone |

Ordinary maximums are **512 KiB per image, 4 MiB per video, 10 MiB per audio file**. The absolute image maximum is **1 MiB** with a grant, deliberately at very low priority. A verified ≥$100 grant allows video up to **20 MiB**, while ≥$1,000 allows **100 MiB**. Exact inclusive boundaries are tested. A larger individual upload is never treated as extra trusted voting power.

## Actual HTTP and IPFS transfer isolation

The new network/media-lanes.mjs implements distinct capacity pools: tiny 3 active/12 queued, small 3/12, standard 2/6, heavy 1/2. Smaller ranks within one pool get the next available slot. Excess queued work returns HTTP 429 instead of accumulating arbitrarily many sockets/bodies. The two fastest image pools remain independent of heavy videos.

Application-layer pacing per provider: tiny/small images are not additionally throttled; standard transfers allow up to 4 MiB/s inbound and 2 MiB/s outbound; heavy transfers allow up to 2 MiB/s inbound and **512 KiB/s outbound**. These are local pacing budgets, not a promise of guaranteed bandwidth through an overloaded ISP, router or reverse proxy.

The operator's HTTP media gateway AND its outbound libp2p Bitswap broker use the SAME local scheduler when both run in one peer, applying size-derived lanes. The Bitswap broker classifies raw blocks and UnixFS children through their operator-retained root manifest, which is important because a large video could otherwise bypass HTTP priority by fetching child blocks directly. Existing operator quarantine and optional independent provider selection remain in force.

A small-image storage reserve (up to 2 MiB or a proportionately smaller reserve for tiny provider budgets) prevents one new giant file from consuming the last capacity reserved for ≤100 KiB images. The per-client daily image, audio and video quotas are distinct, including a stricter category for optional staked oversized files. These IP/network quotas are local abuse controls, not reliable Sybil-resistant user identity.

Uploads above 4 MiB are streamed to unique, private temporary files near the operator media manifest, rather than assembled into a 100 MiB JavaScript Buffer. The uploaded bytes are SHA-256 checked before UnixFS publication, and temporary files are removed on normal completion or rejection. HTTP playback above 4 MiB verifies the complete retained content checksum BEFORE responding and then streams the selected HTTP byte range in a second pass under the heavy bandwidth lane. The existing historical 10 MiB video CIDs remain served under the defensive 100 MiB physical maximum: admission changes do not erase historical signed records.

## Dollar-denominated Stake4Karma proof: secure default is disabled

WEB9000 currently has an optional Base Sepolia Stake4Karma testnet verifier pinned to a specific contract, with **test ETH amounts**, NOT actual USD bonds. No independently audited live escrow plus trustworthy ETH/USD valuation oracle is integrated. Consequently this change implements an **operator-signed media entitlement verifier**, NOT automatic real-dollar tier issuance.

To activate a future properly backed issuer, each peer must explicitly configure both its pinned media issuer Ed25519 public key and a unique signed audience:

~~~sh
WEB9000_MEDIA_STAKE_ISSUER='ed25519:PINNED_OPERATOR_PUBLIC_KEY'
WEB9000_MEDIA_STAKE_AUDIENCE='operator-unique-media-audience'
~~~

Without those settings, no user can exceed 512 KiB images or 4 MiB videos on that provider by claiming to have staked money. The current testnet is never treated as $100/$1,000 collateral. An operator must **first** independently verify active real Stake4Karma lock, relevant finality and independently sourced USD valuation before any legitimate real-dollar tier grant is signed. This review and automatic grant issuer are NOT implemented here.

The operator-signed bearer grant contains the intended author's public signing key, exact media MIME type, byte length and SHA-256, source evidence SHA-256 commitment, USD threshold, unique target peer audience, and short issued/expiry timestamps (maximum 5 minutes). The media gateway independently verifies the pinned Ed25519 issuer, grant scope, expiry, exact file size/type and actual uploaded bytes. Client claims, forged or altered tokens, incorrect audiences, and attempts to use a token for unrelated content are rejected. The grant can still be replayed for **the same file** within its validity window; IP quotas and local storage limits apply.

The classic browser post composer has an optional advanced field to paste **one operator-issued grant for one extended attachment**. A pasted token is not trusted by browser validation: the chosen media operator performs the real check. Audio is not automatically expanded by a video stake entitlement.

## Deployment considerations and tests

The deployed test peer and public Nginx proxy were NOT altered. An operator may opt into ordinary media uploads with MEDIA_SERVER, MEDIA_UPLOAD and separately MEDIA_RICH_UPLOAD, and choose storage through WEB9000_MEDIA_STORAGE_MIB. The default local storage budget is 64 MiB, which cannot accommodate 100 MiB; a future opted-in provider must configure at least enough disk quota for the large file, associated blocks, temporary staging and the small-image reserve. The current public proxy's older 10 MiB request-body limit would also need an **explicit** operator-controlled update beyond 100 MiB, subject to strict connection/rate limits and trusted proxy header handling. Merely updating this source tree does NOT enable 100 MiB Internet uploads.

Tests:
- WEB9000 core tests: exact 50/100/256/512 KiB and 1 MiB image boundaries; 1/3/4/5/10/20/100 MiB video boundaries, matching browser preflight.
- Media gateway tests with real Helia/UnixFS: ungranted refusal; signed $100 grant admits >5 MiB, signed $1,000 test grant admits >20 MiB; wrong hash, forged signatures, audience and expiry rejected; HTTP 206/HEAD and temporary spool cleanup.
- Scheduler tests: a saturated heavy lane cannot occupy reserved tiny or small image lanes; bounded queue and within-lane rank ordering.
- Real Bitswap tests: quarantines still reject original image/video and UnixFS child blocks under the new lane pacing.
- Optional separately capped 100 MiB stress run: set WEB9000_BENCH_MEDIA_100=1 for network/media-tier-admission.test.mjs. The signer is **synthetic**, and this is NOT proof of a real wallet's collateral.

**Still open:** a production-audited Stake4Karma position + USD oracle/finality + issuer/revocation flow, true public-network bandwidth measurements, crash-safe stale upload spool cleanup, portable browser-native libp2p media serving, and a proof that all network classes can remain available under a full physical-disk flood. This is a safer starting policy, not a global spam solution.
