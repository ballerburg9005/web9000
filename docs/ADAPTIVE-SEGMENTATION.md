# Adaptive database segmentation for WEB9000

**Status:** Experimental operator-local prototype (2026-11-19), NOT integrated into the live peer, browser default, existing raw index, or IPFS gateway. The owner approved further exploration of database segmentation but explicitly left karma, tier counts and exact score calculations unresolved.

## Central design shift

Use a variable number of **physical replication partitions** responsive to malicious pressure, not 100 equally spaced karma ranks. The bulk of bot traffic may target the entry path: many newly generated identities have no stake, no trusted social backing and no independently established reputation. Sharding this path is useful for isolating traffic, but merely splitting one unbounded shared stream into 100 databases does not prevent a flood. A **single aggregate entry admission budget** must remain bounded across all entry shards, with additionally capped source, author, verification queue, memory, and byte budgets. High-trust pools need independent resource reserves.

The maximum number of partitions is a **local operator policy**, not a universally adopted karma schedule. The current sandbox can open up to 100 entry partitions, plus one separately curated sponsored partition and one established partition. These are experiments, not global classes or fixed identity qualifications.

Important: **Shard placement is not the same as user punishment.** A healthy account with negative social opinions stays eligible for the free entry path even with negative net votes. An abusive bot with unlimited new keys cannot exceed the physical ingress source/peer budget. Independently ratified misconduct can affect the sponsor or bond according to a separately approved governance policy, but arbitrary dislikes do not establish misconduct.

## Physical prototype implemented

The new v2/network/adaptive-tier-router.mjs module provides:

- **AdaptiveTierRouter**: an isolated opt-in local routing instance. An entry partition initially has one physical OrbitDB log; repeated quota refusals from at least two independently observed source cohorts trigger **one bounded doubling per observation window** (1 to 2 to 4, etc., at most the configured maximum). When entry activity is quiet for at least three windows, future writes can be routed to fewer partitions. Neither operation rewrites authors' signatures, deletes old logs, reclaims blocks, or changes older shard addresses. A growing reader-visible index-directory/manifest is still required before deployment.
- **Independent budget accounting**: per-class and per-kind (content versus feedback), per-observed source cohort, and per-signer rate budgets. Budget exhaustion occurs before signature verification or persistent OrbitDB writes. A single hostile source cannot force unlimited new indexes by rotating signers.
- **Bounded expensive verification**: credential checking is separate from incoming event handling. A locally invoked, separately quota-limited registerAttestation control-path can cache a short-lived result only from a trusted independent verifier. Incoming event JSON never invokes the verifier to evaluate a claimed karma balance. Production will need an actual source-bound credential and real on-chain/ratified group verifier; the tests use a clearly labeled stub.
- **Bounded metadata**: at most 256 simultaneously tracked anonymized source cohorts, 8,192 signer quota keys, 2,048 recent signed-event IDs, and configurable pending-operation caps. Overflow uses shared budgets. Source observations are salted locally and omitted from OrbitDB events and public shard names.
- **Operator-curated, physically different OrbitDB logs**: openLocalAdaptiveShard opens new OrbitDB event databases whose write control permits only the local curator's OrbitDB identity, but stores original independently verified signed events by any author in any namespace. Other identities cannot directly append around the local operator's budget. Anyone can publish the same signed record to another independently operated index; this makes no namespace owner.
- **Non-authoritative evidence diagnostic**: summarizeAttestedOpinions separately reports positive recognition and negative opinions from externally verified signers/groups. It caps the contribution per recognized group and weights untrusted groups zero. Neither sum authorizes any replication privilege without independent review.

Four isolated tests use genuine Ed25519 events and actual OrbitDB/Helia instances, plus a 12,000-fabricated-identity local abuse simulation that confirms fixed accounting/DB caps. They demonstrate physical entry splitting, preserved historical event IDs, fresh keys exhausting the same source quota, two independently routed shards, an alternative writer rejected by the curator's ACL, a sponsor admitted only after externally verified local cache registration, expiration into the free entry path, quota limits on forged attestations, no below-entry penalty for negative karma and no promotion from raw claimed likes. The prototype is not loaded by node-peer.mjs.

## What actually belongs in reputation

Do NOT calculate resource priority from a single signed integer of upvotes minus downvotes.

| Evidence dimension | Proposed meaning | Admission significance |
|---|---|---|
| Unverified key with zero karma | Brand-new or unproven signing identity | Usable bounded entry access |
| Unverified negative reaction total | Popularity/disagreement, potentially brigaded | Does not reduce entry rights |
| Unverified positive vote total | Could be meme farming or mutually generated Sybil likes | No automatic promotion |
| Independently corroborated positive recognition | Diverse legitimate supporters from independently selected and ratified trusted groups | Possible reviewed/cached resource qualification |
| Contested, ratified abuse finding | Evidence-backed misconduct under voluntary jurisdiction | Local action/sponsor bond consequence, with appeal; never mere dislike |
| Voluntary signed invitation or vouch | Reputation sponsor with explicit scope, term and potential liability | Potential distinct, capped invitation budget if policy and signature verified |
| Stake4Karma locked bond | Separately verified financial collateral and capacity | Resource budget independent of earned democratic influence |
| Group/reviewer reputation | Per-reader/per-operator chosen, scoped trust in endorsers | Downweights unreliable groups; no universal group-owned censor |

A person with 20 verified supporters and 100 downvotes could have meaningful positive standing for preservation without pretending the criticism never happened. Conversely, a bot ring with 10,000 mutually generated likes should still count as unverified until those signers/endorsers are validated outside their own circle. Do not reward raw age, coin balance, author timestamp or popularity alone.

Avoid recursive reputation inflation: reviews from groups should be discounted according to an independently chosen, pinned external trust root, not multiplied solely by other groups that ratify each other. Deduplicate by verifier/source/group, cap any one clique's influence, require time-bounded evidence, detect coordinated rings and preserve signed appeals/forks. The actual calculation is **undecided**, and the module intentionally does not promote from its diagnostic opinion summary.

## What belongs in network/source segmentation

A short-lived, **trusted observer-derived** cohort can combine routing locality, hosting ASN, coarse network prefix, data-center/VPN/relay classification, observed burst intensity, new-key creation rates, similarity of content/CID reposts, verified sponsor/bond availability, and peer-level past resource behavior. Country/region may help plan geographical network capacity, but should not be a hardcoded conviction of fraud, permanent karma score or denial of a whole country's users. Country and IP geolocation are often wrong; attackers can use residential proxies, and legitimate users share carrier NAT, VPNs, Tor exits and cloud hosting.

Use live abuse rates and actual network/provider observations rather than hard-coded nationality lists. Only the **current ingress operator** can measure network source information. A replicated record passing through another libp2p peer reveals the last hop, NOT the author's originating IP, so never export a claimed "real source country" inside the signed post. Coarse source cohorts should be kept ephemeral, salted and privacy-limited; let readers and other operators disregard them.

Useful additional zero-karma controls: preparse packet limits, token buckets for connections and bytes before CPU-intensive Ed25519 checks, per-source and per-peer budgets spanning arbitrary new keys, rejection of exact repost/event-ID replay, CID near-duplicate detection before allocating permanent media storage, new-key/endorsement-ring analysis, isolated gossip topics, bounded subscriptions, eviction/GC of saturated entry storage, fair opportunity for genuinely new users, and dedicated work queues for comments and voting versus large media uploads.

## Adaptive allocation

**Entry compartment:** If one source floods, throttle it in-place. Do not spend hundreds of database slots on its identities. If overload spans several separately observed sources, grow a bounded entry shard pool, preserving a global entry class cap rather than multiplying capacity by shard count. The current sandbox doubles at most once per local observation window and halves future-write routing after three quiet windows. These constants are prototype test parameters, NOT network defaults or endorsed policy.

**Other compartments:** Sponsor-backed and independently established accounts should use distinct preallocated admission pools, independent from zero-karma congestion. Economic stake may optionally buy bounded resource capacity without buying social trust or votes. A sponsored account still needs limits because its inviter may be compromised or abusive.

**Content type isolation:** Under WEB9000's plausible legitimate future (1,000 genuine posts/day, 10 comments, 50 tag votes, 20 classifications and 1,000 reaction votes per post), the network processes approximately 1,081,000 *legitimate* signed events/day, with spam entirely additional. Signed reactions are the main event-volume component; maintain a feedback queue distinct from posts/replies and an independently resource-limited media/IPFS queue.

**IPFS:** Keep media as an independent block service. The previous 100-IPFS-blockstore and real Bitswap experiments show that many partitions can work, but a tier-aware shared Helia block router, UnixFS root/child mapping, physical GC, differentiated bandwidth and upload quotas are NOT implemented. Do not confuse routing metadata to a physical OrbitDB shard with moving the media CID or its blocks.

## Security and unfinished protocol work before deployment

The prototype is intentionally **disabled** in the live test peer. The current normal public index has existing addresses, subscriptions and signed history. Changing them automatically would be destructive.

P0 prerequisites: signed discoverable shard directories/epoch manifests with independent read permission, preservation of historical addresses across routing changes and restarts, signed membership/curator proof where relevant, pre-parse packet and connection admission, safe on-disk retention and IPFS blockstore garbage collection, independent authenticated reputational and staking evidence, abuse-resistant invitation graphs with verified appeals, physically enforced worker CPU/RAM/IOPS/bandwidth constraints, anti-eclipse protection, atomic routing during splits, crash recovery, and multi-peer flood/churn benchmarking.

In particular, a single Node.js process running 100 OrbitDB or Helia partitions is **not** 100 hard-failure-isolated processes. A single abused shared CPU or peer connection can still bring down the whole instance without OS-level quotas.

The source/author budgets in the sandbox are illustrative, **not** sufficient for legitimate 1.081 million-event-per-day throughput; some relays and NATs aggregate many honest signers under one observable source. Production decisions must preserve accessible free entry while surviving an arbitrary new-key spam flood.

See the prior measured feasibility reports: ORBITDB-TIER-BENCHMARK-2026-11-19.md and IPFS-TIER-BENCHMARK-2026-11-19.md.
