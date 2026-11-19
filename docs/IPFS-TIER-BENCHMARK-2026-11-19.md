# IPFS media tier segmentation: 1 vs 10 vs 100 storage partitions and nodes

**2026-11-19 — actual Helia, LevelBlockstore, UnixFS and Bitswap tests.** Benchmark only; no new admission policy, network-wide censorship authority, operator-approved karma thresholds or deployed media router.

## Two different meanings of media tiers

1. **Physical blockstore partitions behind one Helia network node:** inexpensive independent LevelDB storage areas, CID/media lookups explicitly assigned to one tier. This is the promising high-tier-count architecture, but the current test ONLY proves local partitioned writes/reads. WEB9000 does **not yet implement the necessary shared tier-aware gateway/Bitswap block router** that directs every root CID *and every UnixFS DAG child block* to the correct partition. Simply attaching 100 blockstores to a Helia object does NOT make their contents available through one ordinary Helia Bitswap broker.
2. **Full independent Helia/libp2p nodes per tier:** each has an independent blockstore, provider identity, transport and outbound-policy instance. This works over real Bitswap without a new router. It is a more expensive architecture and does not provide true OS-level failure isolation if all 100 stacks are kept within the same Node.js process.

Both arrangements must enforce independent ingress, signature/evidence verification, CPU, IOPS, retained-byte and **outbound media bandwidth** limits to survive spam. Neither storage separation nor a different IPFS peer ID automatically enforces those limits.

## Test hardware and isolation

Remote test host: one logical CPU, ~5.8 GiB RAM. Every invocation ran inside a disposable Docker container limited to **0.6 CPU and 1,200 MiB RAM**, no external network (local loopback transfers only), mounted WEB9000 checkout read-only, and stored all media and peer keys in temporary **container-local** directories. Existing WEB9000 peer, persistent index identity, public media gateway and IPFS blocks were not touched.

- **Local media workload:** the same 100 independent *synthetic high-entropy* objects: 50 image-sized 96 KiB raw IPFS objects + 50 video-sized 2 MiB UnixFS objects, **104.69 MiB total**. The objects have MIME header bytes but are synthetic benchmarks, not playable/decodable media. Every stored object was read back and SHA-256 byte-verified. With 10/100 tiers, cross-tier root non-presence was checked on a sample.
- **Network workload:** one image-sized 64 KiB raw object on each independent source peer, plus one 2 MiB UnixFS video root on source 0. A separate reader explicitly dialed each provider and fetched the data over **actual libp2p Bitswap** using the same WEB9000 media-bitswap-policy.mjs manifest guard. The client verified every byte. A quarantine on the source-0 video was confirmed by the outbound policy without suppressing unrelated media on the other tiers. This network test does not benchmark concurrent external clients or full 105 MiB fanout.

## Test A: physical LevelDB partitions (one Helia/libp2p network node)

Script: v2/network/benchmark-ipfs-tiers.mjs shards 1|10|100

| Independent blockstores | Helia network nodes | Synthetic media read back | Wall time incl. open, write, verify | RSS at completion | Sampled peak RSS |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 100/100 | 6.78 s | 228 MiB | 228 MiB |
| 10 | 1 | 100/100 | 5.28 s | 262 MiB | 262 MiB |
| 100 | 1 | **100/100** | **6.01 s** | **259 MiB** | **281 MiB** |

The result for 100 stores did NOT require 100 separate libp2p listeners or 100 Bitswap services. It **did not test** remote retrieval via a common shared Helia identity and is not an implemented production media router. LevelDB storage overhead was small relative to ~105 MiB of high-entropy media blocks.

## Test B: full independent Helia/IPFS stacks per tier, local writes

Script: v2/network/benchmark-ipfs-tiers.mjs nodes 1|10|100

| Helia/libp2p stacks and blockstores | Synthetic objects verified | Total time | Node-process RSS at completion |
|---:|---:|---:|---:|
| 1 | 100/100 | 7.67 s | 185 MiB |
| 10 | 100/100 | 7.76 s | 260 MiB |
| 100 | **100/100** | **12.09 s** | **289 MiB** |

All tier stacks share one Node.js process *in this benchmark* and would still compete for CPU/memory if not separately limited. File flush/temporary-directory removal had one transient ENOTEMPTY issue in the 1-node trial; cleanup retries were added. Docker's --rm removes any remaining temporary contents. No persistent storage was changed.

## Test C: actual Bitswap remote retrieval from independent tier nodes

Script: v2/network/benchmark-ipfs-tier-bitswap.mjs 1|10|100

| Source Helia nodes | Additional independent reader | Distinct media roots fetched/verified | Bitswap fetch duration | Total-process RSS |
|---:|---:|---:|---:|---:|
| 1 | 1 | 2/2 | 0.57 s | 157 MiB |
| 10 | 1 | 11/11 | 2.27 s | 163 MiB |
| 100 | 1 | **101/101** | **43.71 s** | **282 MiB** |

The 100-source reader established 100 libp2p peer connections and retrieved 100 images plus the 2 MiB UnixFS video, totaling **8.25 MiB of application media bytes**. Bytes and UnixFS DAG reading were verified. Source-specific manifest and quarantine tests passed. More sources increase dial/session overhead; timings are sequential over local TCP, with only 0.6 CPU, **not** estimates of internet download time for normal users.

After source and reader Helia shutdown returned, the standalone benchmark Node process still retained background TLS/socket handles in 10 and 100 source runs. A watchdog exits these benchmark invocations with diagnostic code **2** after successful media tests. Similar behavior was observed in the two-peer OrbitDB benchmark and remains a real process-lifecycle concern; it is not an IPFS replication failure.

## Reproduction with isolated resources

From a WEB9000 checkout on a Docker host with web9000-test-chromium:latest available, mount the repository as /app:ro and use working directory /app/v2/network, with --rm, --network none, --cpus=0.6 and --memory=1200m --memory-swap=1200m. Commands for the Node entrypoint:

- node --expose-gc benchmark-ipfs-tiers.mjs shards 100
- node --expose-gc benchmark-ipfs-tiers.mjs nodes 100
- node --expose-gc benchmark-ipfs-tier-bitswap.mjs 100

All data remains temporary inside the disposable container, not in the source tree.

## What this means for WEB9000's spam problem

**100 storage tiers are affordable in this small real-IPFS test.** However, the actual hardline protection needs to occur BEFORE accepting unbounded raw and UnixFS blocks: cap per-class connection/request pressure, hash/proof verification, upload bytes and write IOPS, and enforce read-side Bitswap budgets. Also solve real per-tier physical garbage collection (including UnixFS child blocks), origin/identity-sybil budgets, content-addressed block deduplication and CID-to-tier assignments that do not depend on unverifiable signed karma claims.

For 100 physically separate network stacks, peer connection overhead and uncontrolled sharing of a single Node.js process limit the achievable isolation. A sensible next experiment is **100 LevelDB partitions behind a smaller fixed pool of physically resource-limited Helia media workers**, with a verified tier-to-block routing index and per-worker quotas. This is a design direction, not approved implementation. No default browser replication or upload/serving policy was changed by this benchmark.

Companion signed-event/OrbitDB benchmark: [ORBITDB-TIER-BENCHMARK-2026-11-19.md](ORBITDB-TIER-BENCHMARK-2026-11-19.md).
