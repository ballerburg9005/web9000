# Adaptive database segmentation for WEB9000

**Status:** Experimental operator-local prototype (2026-11-19), NOT integrated into the live peer, browser default, existing raw index, or IPFS gateway. The owner approved further exploration of database segmentation but explicitly left karma, tier counts and exact score calculations unresolved.

## Central design shift

Use a variable number of **physical replication partitions** responsive to malicious pressure, not 100 equally spaced karma ranks. The bulk of bot traffic may target the entry path: many newly generated identities have no stake, no trusted social backing and no independently established reputation. Sharding this path is useful for isolating traffic, but merely splitting one unbounded shared stream into 100 databases does not prevent a flood. A **single aggregate entry admission budget** must remain bounded across all entry shards, with additionally capped source, author, verification queue, memory, and byte budgets. High-trust pools need independent resource reserves.

The maximum number of partitions is a **local operator policy**, not a universally adopted karma schedule. The current sandbox caps NEW physical shards at 20 (owner decision 2026-11-20), replacing the earlier experimental 100-shard limit, plus one separately curated sponsored partition and one established partition. These are experiments, not global classes or fixed identity qualifications.

Important: **Shard placement is not the same as user punishment.** A healthy account with negative social opinions stays eligible for the free entry path even with negative net votes. An abusive bot with unlimited new keys cannot exceed the physical ingress source/peer budget. Independently ratified misconduct can affect the sponsor or bond according to a separately approved governance policy, but arbitrary dislikes do not establish misconduct.

## Physical prototype implemented

The new v2/network/adaptive-tier-router.mjs module provides:

- **AdaptiveTierRouter**: an isolated opt-in local routing instance. An entry partition initially has one physical OrbitDB log; repeated quota refusals from at least two independently observed source cohorts trigger **one bounded doubling per observation window** (1 to 2 to 4, etc., at most the configured maximum). When entry activity is quiet for at least three windows, future writes can be routed to fewer partitions. Neither operation rewrites authors' signatures, deletes old logs, reclaims blocks, or changes older shard addresses. A locally signed append-only shard-directory implementation now exists, but
independently approved peer discovery and dissemination remain prerequisites for deployment.
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

P0 prerequisites: independent distribution and reader access to the local signed
shard directory, durable operator signer identity and observation-key backup, preservation of historical addresses across routing changes and restarts, signed membership/curator proof where relevant, pre-parse packet and connection admission, safe on-disk retention and IPFS blockstore garbage collection, independent authenticated reputational and staking evidence, abuse-resistant invitation graphs with verified appeals, physically enforced worker CPU/RAM/IOPS/bandwidth constraints, anti-eclipse protection, atomic routing during splits, crash recovery, and multi-peer flood/churn benchmarking.

In particular, a single Node.js process running 100 OrbitDB or Helia partitions is **not** 100 hard-failure-isolated processes. A single abused shared CPU or peer connection can still bring down the whole instance without OS-level quotas.

The source/author budgets in the sandbox are illustrative, **not** sufficient for legitimate 1.081 million-event-per-day throughput; some relays and NATs aggregate many honest signers under one observable source. Production decisions must preserve accessible free entry while surviving an arbitrary new-key spam flood.

See the prior measured feasibility reports: ORBITDB-TIER-BENCHMARK-2026-11-19.md and IPFS-TIER-BENCHMARK-2026-11-19.md.


## 2026-11-19 follow-up: source-specific failure compartments (prototype, not deployed)

The owner corrected the design's purpose: **physical database segmentation is not a verdict, accusation, or permanent exclusion**. Country, ASN, coarse IP range, VPN, hosting/datacenter, proxy and relay signals may place incoming connections into separate resource/failure compartments from the outset. A compartment accepts ordinary signed publications until its *own* bounded resources are exhausted. Its refusal does not imply its authors are fraudulent. A later resource window can admit new signed publications again. The unverified entry system is expected eventually to saturate against sufficiently large distributed Sybil floods; the objective is to keep other compartments and independently qualified peers running.

New **source-compartments.mjs** derives an opaque, operator-keyed compartment ID from a verified *ingress operator observation*: connection network kind (residential/mobile/VPN/proxy/Tor/hosting/datacenter/relay), country, ASN, and coarse IPv4 (/24 or broader) or IPv6 (/48 or broader) prefix. It never places raw IP addresses, countries or ASNs into signed posts, public shard names or debug summaries. It rejects a client-claimed origin classification and falls back to the general compartment. Crucially, a libp2p relay's last-hop IP identifies **that hop**, not necessarily the author; clients must not be allowed to supply forged X-Forwarded-For or geo/ASN metadata.

**AdaptiveTierRouter** now allocates independent per-compartment limits **within both entry and independently attested sponsored/established classes**. A saturated VPN/country/datacenter compartment does not immediately exhaust the distinct limit of another residential/other-country compartment. A single operator-wide class ceiling remains as an ultimate safety fuse. Operator-supplied maximum compartment count, maximum physical database count, an overflow box and a short-lived time window prevent unbounded index allocation. A new physical compartment becomes active only after a valid Ed25519 event passes admission, so invalid payloads cannot mint unlimited databases.

Both separate infrastructure and standard clients can operate inside these same source compartments. This is not a lifetime karma penalty or proof of spam. Group trust, earned karma, sponsor invitations and Stake4Karma remain independent, unsettled dimensions. Under the owner's bootstrap hypothesis, it is acceptable for a flooded entry compartment to fail locally; preserving proven peers is more important than making one unbounded zero-karma sink impossible to exhaust.

### Operator-signed historical physical shard directory

A separate **signed-shard-directory.mjs** implements a local, append-only, Ed25519-signed *manifest* of the operator's actual OrbitDB physical shard addresses. Every revision contains the complete sorted historical list, a previous-revision digest and an independent signature. A reader pins the chosen operator public key and optionally a previously seen revision/hash to detect forged entries, removal/replacement of an old address and rollback. The local file is updated atomically and synchronized to disk.

The optional **directoryBackedShardOpener** first looks up an existing exact OrbitDB address in that manifest rather than recreating an empty database from its logical name after restart. Real Helia/OrbitDB tests confirmed the original signed events remained in the same address after reopening and subsequent signed records were added there. The manifest is still a **self-asserted and locally stored operator discovery claim**: publication to independent readers, completeness auditing and trust-root selection are NOT implemented. A malicious operator could consistently omit a shard; signatures alone cannot prove a global complete history. No owner of an arbitrary namespace is created.

The operator's random compartment secret must be persisted securely to keep the mapping stable across restarts. Without it, new writes can go to new compartments, but historical signed shard addresses must remain discoverable from the old manifest. A read-only verifier must pin the independent directory identity and last observed revision/digest to detect stale snapshots.

### Verified behavior and unfinished hard isolation

Eleven targeted tests cover real signed OrbitDB shard reopen after restart, forged/stale directory resistance, invalid-signature compartment inflation, country/ASN/VPN/network-prefix separation, failure of one compartment while other boxes continue, different physical entry/sponsored VPN compartments, a hard global physical index limit, and the earlier 12,000 fabricated identities plus source-cohort flooding.

**Still unfinished:** real trusted network geo/ASN/VPN observation at the actual HTTP/libp2p ingress; authenticated optional publication and discovery of signed manifests; bounded prefetch, connection and CPU admission *before libp2p/OrbitDB fetches*; OS-level worker/cgroup isolation (100 DBs in one Node.js process are not 100 failure-isolated processes); actual per-tier disk garbage collection, including IPFS UnixFS child blocks; realistic quotas for carrier-grade NATs, VPNs and residential proxy botnets; and independent verifiable stake/sponsor/earned-reputation semantics. None of these prototype modules are wired into the live WEB9000 peer.


## 2026-11-20 priority-restoration and OS-worker isolation proof

The operator/reader can now subscribe to only 20 of up to 100 historical OrbitDB addresses, opening independently attested established and sponsored partitions first, reserving one free-entry slot. The priority loader lazily fetches dormant physical indexes without rewriting signed records and evicts only equal/lower-priority subscriptions. On 100 actual signed OrbitDB logs, 20 warm restored in **0.480 s** at **153.50 MiB RSS** with 20 pubsub topics; all 100 restored in **2.492 s** at **158.11 MiB RSS** with 100 topics. These are warm-in-process microbenchmarks, not large-history crash recoveries.

A separate experimental actual Helia/OrbitDB worker executable was tested with two OS worker processes. After 100 invalid packets and force-killing the entry process, the independently curated process still served health requests and accepted new signed records. A second Docker trial enforced **0.25 CPU, 256 MiB RAM and 64 PIDs per independent worker cgroup**; entry worker CPU saturation and container shutdown did not stop the established worker (test-client-inclusive health calls 388/394/388 ms baseline/saturation/after kill). These are NOT integrated into the live peer, and a true low-cost pre-OrbitDB ingress controller, IPFS storage/bandwidth quotas, source observation, stake proofs and GC are still missing.

See [PRIORITY-RECOVERY-ISOLATION-2026-11-20.md](PRIORITY-RECOVERY-ISOLATION-2026-11-20.md) for reproducible benchmark commands, exact test boundaries and resource assumptions. These tests support keeping 100 historical databases while using a **small, prioritized set of active subscriptions/physical workers** by default.


## 2026-11-20 owner selected 20 databases; bounded gateway implemented in isolated sandbox

The owner decided to use **20 physical databases**, not 100, as the operating model. New AdaptiveTierRouter configurations now default to a **maximum 20 newly allocated physical database indexes** and reject higher maxShards values. Previously created historical index addresses remain portable and verifiable; this is not a destructive 100-to-20 migration. The priority reader still loads independently trusted classes first while reserving a small free-entry path. The older 100-DB benchmarks remain evidence, not the selected production target.

The new experimental bounded-ingress.mjs receives untrusted signed metadata over a loopback-only HTTP gateway, performs cheap connection/body and source quota checks before forwarding to isolated Helia workers, and accepts short-lived independently operator-signed, signer-bound proof receipts only from a pinned issuer. The protected worker checks the credential again and still verifies the *author's* original Ed25519 signature. The gateway ignores self-claimed karma/tier and X-Forwarded-For source spoofing. The end-to-end test forcibly kills first the entry worker, and in a further independent-process test, the entire entry gateway; the protected gateway and worker continue accepting authenticated signed publications. Real source classification, real stake/vouch verifier, protected public-network edge and disk GC are still NOT enabled.

See [INGRESS-ISOLATION-2026-11-20.md](INGRESS-ISOLATION-2026-11-20.md).
