# OrbitDB: 1 vs 10 vs 100 independently replicated event databases

**2026-11-19 — isolated benchmark results, not production workload or spam-resistance proof.**

Reproduction: v2/network/benchmark-orbitdb-tiers.mjs (one peer, original Ed25519 signed events), and v2/network/benchmark-orbitdb-tier-sync.mjs (two actual Helia/libp2p peers with shared OrbitDB addresses and a real signed record in every database).

Host has one logical CPU and about 5.8 GiB RAM. Every test ran in a disposable container with --network none, --cpus=0.6, --memory=1250m, --memory-swap=1250m, with checkout read-only and new temporary index/blockstore paths. The live WEB9000 peer, keys, media and indexes were not used or modified.

## Single-peer results

With **one signed event per database**:

| Databases / topics | Total to opening, writing and measuring | Node RSS |
|---:|---:|---:|
| 1 | 0.98 s | 140.2 MiB |
| 10 | 1.41 s | 142.8 MiB |
| 100 | 5.31 s | 151.3 MiB |

With **1,000 signed events total**, evenly divided over those databases:

| Databases / topics | Total benchmark wall time | Node RSS |
|---:|---:|---:|
| 1 | 10.84 s | 161.7 MiB |
| 10 | 11.37 s | 159.4 MiB |
| 100 | 13.09 s | 163.7 MiB |

## Two local IPFS peers: real OrbitDB synchronization

Both peers ran independently identifiable libp2p stacks and separate Helia/OrbitDB stores inside one benchmark Node runtime, connected over loopback. Each peer subscribed to as many pubsub topics as there were databases; every original signed record was verified on the second peer.

| Shared databases | Second peer received | Combined Node-process RSS | Total wall time to replication |
|---:|---:|---:|---:|
| 1 | 1/1 | 144.8 MiB | 3.41 s |
| 10 | 10/10 | 149.3 MiB | 4.23 s |
| 100 | 100/100 | 176.1 MiB | 14.59 s |

The 100-database test repeated at ~176.2 MiB and 100/100 synced. Explicit DB and Helia shutdown returned, but the benchmark Node process retained TLSSocket handles at **both** 10 and 100 topics; a diagnostic watchdog ended it with exit code 2. This is a real outstanding dependency/lifecycle issue, not a failed record transfer.

## Owner's hypothetical legitimate capacity

The projected scenario is **1,000 legitimate posts/day, 10 comments + 50 tag votes + 20 classifications + 1,000 up/down votes per post**. This yields **1,081,000 legitimate signed events/day (~12.5 events/second on average), excluding all spam**. Half the posts are video and half images; video watch/download count is unknown.

At an illustrative 1 KiB per signed event, this would be ~1.03 GiB of signed event payload/day, plus OrbitDB overhead, replicates, backups, retention and adversarial traffic. Average throughput is not a peak-rate or bot-flood guarantee.

## Conclusion / outstanding

One hundred DBs did not impose catastrophic local overhead. Ten DBs are not justified as an automatic ceiling. The actual **denial-of-service problem** is expensive intake, signature verification, writes, fanout and retention under deliberately hostile traffic. Still needed: sustained multi-peer load, millions of historical events, real storage reclamation, hard per-tier queue/process budgets, verified independent karma or stake, and recovery under crashes.

Companion benchmark for physical media/IPFS segmentation: [IPFS-TIER-BENCHMARK-2026-11-19.md](IPFS-TIER-BENCHMARK-2026-11-19.md).
