# Tiered replication to survive adversarial spam

Status: design exploration, not an approved admission policy or an implemented feature.
Owner idea: 2026-11-19.

The owner proposes physically separating signed-record replication based on independently verified karma bands: e.g. 0 / 10 / 100 / 1000, or 20–50+ progressive thresholds extending up to 1000. The main goal is **surviving hostile and sustained bot spam and avoiding crash/overload**, not optimizing small text bandwidth during normal operation. A free 0-karma entry path should remain possible; whether Stake4Karma collateral is a separate dimension from earned social karma remains undecided. Under disk pressure, retain recently received records (owner places high value on recent material), with reputation-based weighting and proportionally stronger shedding from low-value saturated classes. Under overload, higher-verified classes should receive more bandwidth. No threshold/rate/physical database count is approved.

## Answer: are dozens/hundreds of physical OrbitDB databases inherently unacceptable?

No. On modern hardware, text-message bandwidth is not generally the primary concern. Millions of small signed records are still a serious CPU, disk IOPS, signature validation, indexing, memory, synchronization and durability attack. OrbitDB databases each have their own append-only operation log and synchronization state over libp2p; dozens may be affordable, but 100 physically open databases must be measured for steady-state resource usage and churn (including connection/topic maintenance, replay/merge, storage and recovery). Do not imply that 100 databases is automatically impossible, or that 20+ fine logical tiers by themselves provide isolation. An entirely logical filter performed after an unbounded raw-log ingest does NOT defend against spam.

Avoid multiplying physical streams by every arbitrary namespace, creating unbounded streams/topics at attacker's request. Limit the number of provisioned tier topics and enforce budgets before allocating durable DB/log resources.

## Proposed hardline protection, without a global publication authority

- Admission, storage, and forwarding are voluntary **per peer**. A signed post remains portable even if a peer refuses it; independent willing peers may accept it and any namespace remains globally nonexclusive.
- Physically partition a small initial set of experimental class streams, and benchmark 1, 4, 8, 16, 50 and 100 concurrently open databases to learn the safe tradeoff. More tiers are legitimate if their overhead is tolerable. Start with clear blast-radius separation, not just UI classes.
- Allocate **separate inbound connection, message, signature-verification CPU, transaction/write IOPS, memory, retained-byte and outbound bandwidth budgets** per class. Reserve a bounded but nonzero zero-karma lane, not an unlimited upload sink. Also limit each author/peer/wallet within each class. Under congestion apply weighted fair queuing and deterministic admission limits BEFORE allocating unbounded durable storage.
- Before expensive verification, bound frame size, queue length and per-source ingress. To admit higher classes, require independently verified, current, replay-resistant reputation or stake evidence rather than author-supplied karma. Cryptographic checking itself needs a queue/cost budget and caching. Merely gating an OrbitDB append AFTER IPFS fetched unbounded entries may be too late for DoS prevention.
- Consider per-class rate-limited record announcements plus on-demand retrieval of the signed payload. Do not auto-fetch a giant append-only raw tier and filter it afterward.
- Include a recency opportunity for legitimate newly published posts, but do not rely on unconditional newest-first retention. A spammer can mint new records continuously. Combine local receipt time, fair author quota, priority, retained bytes and independent replication rarity. The signed author timestamp does not prove real-world arrival time.
- Make retention and compaction actual operations, not merely hiding entries in a local Replica. Audit exact physical OrbitDB oplog and IPFS blockstore semantics before promising deletion/space reclamation. A peer's local deletion never erases a signed record held by another willing peer.
- Keep immutable signed records deduplicated where feasible; changing score or migrating tiers must not require republishing under new author signatures or storing all ancestors in every class. Version and audit the local routing/reclassification decisions. Multi-tier subscribers should not repeatedly store duplicate event bodies.
- Separate **Stake4Karma's independently verified economic resource entitlement** from **earned, appealable social credibility** unless deliberately chosen otherwise. A USD-to-karma conversion is not settled and money must not silently purchase group voting rights.
- Sponsor liability must be based on verified, appealable abuse findings, not mere reports. Assume Sybil identity farming, wealthy spammers, compromised/stale proofs, collusion, score oscillation, and malicious peer/topic churn.

## Current WEB9000 implementation gaps

There is an unrestricted raw OrbitDB index; a voluntary qualified index exists but the running test peer explicitly admits no records without independent qualification. Local anti-spam scores/default thresholds are provisional and do not provide a deployed stake verifier. The Replica count cap does not equal durable OrbitDB/IPFS garbage collection. There is no actual tier-separated ingress scheduler. Reproducible 1/10/100 database experiments and genuine 1/10/100 IPFS media storage / Bitswap experiments were completed 2026-11-19. See ORBITDB-TIER-BENCHMARK-2026-11-19.md and IPFS-TIER-BENCHMARK-2026-11-19.md. They are **NOT** spam-flood or long-term retention tests.

## Next validation

1. **Partially measured:** 1/10/100 live OrbitDB databases, 100/100 cross-peer signed records, 1/10/100 separate IPFS blockstores and Helia nodes with ~105 MiB verified local media, and 100/100 remote Bitswap sources each serving an image (plus 2 MiB video on source 0). **Still needed:** hardline attack floods, 4/8/16/50, millions of old records, cold restarts, disk IOPS, client/provider churn, strict per-tier CPU/storage/network enforcement, and fixing benchmark dependency shutdown handles. No legitimate media may auto-replicate into a new tier before reader/operator approval.
2. Simulate a hostile low-tier bot flood and a wealthy/high-tier adversary concurrently with legitimate low- and high-tier users. Report which operations and records survive, not merely throughput.
3. Prototype bounded, opt-in ingress queues and real per-class durable retention on an isolated test node. Do not enable money/karma-based admission on the existing live experimental peer without a verified proof protocol and owner-approved decisions.

References: docs/OPEN-ISSUES.md, docs/BACKEND-AUDIT.md, v2/network/qualified-index.js, v2/core/anti-spam.js.


## 2026-11-19 owner correction: source compartments within proof classes

Location-based and infrastructure-based segmentation is **not a guilty verdict or permanent IP ban**. Independent local source failure domains can exist for countries, coarse IP ranges, ASN, VPN, hosting/datacenter or relay classifications, also within low and higher verified reputation classes. A source compartment can accept ordinary signed traffic until its resource budget is exhausted, while other compartments stay functional and its future admission reopens with available capacity. The owner explicitly anticipates the untrusted zero-karma pool may fail under eventually inevitable massive Sybil attacks; the network must protect the voluntarily proven lanes and independently consenting peers. Experimental code and real signed physical directory restart tests are described in ADAPTIVE-SEGMENTATION.md. None of these are default live policies, no global country censorship has been approved, and a relay's observed network origin must not be confused with the author's nationality.
