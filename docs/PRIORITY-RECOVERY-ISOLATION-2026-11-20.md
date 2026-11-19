# WEB9000: priority shard activation and physically isolated workers

**2026-11-20 — opt-in experimental prototypes, not enabled in the hosted peer.** This advances adaptive source/karma compartments without changing user posts, legacy index addresses, qualified admission defaults, browser media opt-ins, or the public network.

## Decision: retain 100 historical addresses, subscribe to 20 first

The owner suggested higher-trust database classes should load before lower ones, making 100 simultaneously active databases less attractive than about 20. The prototype separates **total historical shard-directory size** from **currently active subscriptions**.

New **v2/network/priority-shard-loader.mjs** requires an already Ed25519-verified, operator-pinned historical directory and opens independent real OrbitDB indexes in this order:

1. Operator/reader independently **established**, then **sponsored**; these are not globally assigned karma or mandatory rank thresholds.
2. A configurable small **free-entry reservation** (default one active subscription if maximum exceeds one), so high-tier volume cannot monopolize every one of the reader's subscriptions.
3. Additional low-tier and historical network-cohort compartments as budget permits.

The operator sets maxActive (prototype default 20, range 1–100). When a dormant database is requested, the loader opens its original pinned OrbitDB address and evicts a less-important already opened database if necessary. An entry-history request never evicts a high-tier subscription; additional high-tier subscriptions cannot evict the final reserved free-entry slot. Reads are serialized with evictions so a database cannot close mid-read. The total pending lazy-open queue is bounded to 64 requests and the retained diagnostic opening trace to 256 entries; exceeding the queue cap fails locally before creating a new expensive subscription. Signed historical entries remain present even when unsubscribed. A different operator is never silently accepted as a replacement trust root, and old snapshot revisions/address rewrites are rejected.

This is an opt-in local reader/subscription scheduler, not a universally authoritative trust ranking, proof of complete world history, actual OS resource isolation, guaranteed network-wide retention or a live automatic browser subscription choice.

### Real OrbitDB benchmark: 100 configured physical databases, 20 vs 100 active

Each run used the same 100 physical OrbitDB event logs, each with one original signed Ed25519 event, and a signed historical directory. After closing all 100, the script restored only 20 or all 100 indexes and verified their local records. **This is a warm reopen in the same Node process, not a cold restart.** Both ran in a disposable 0.6-CPU / 1,250 MiB Docker container with no external network, read-only checkout and temporary stores.

| Measurement | 20 active | 100 active |
|---|---:|---:|
| Configured historical signed DB addresses | 100 | 100 |
| Active OrbitDB/pubsub subscriptions | 20 | 100 |
| Warm restoration duration | **0.480 s** | **2.492 s** |
| Process RSS after restoration | **153.50 MiB** | **158.11 MiB** |
| Dormant but historically discoverable | **80** | **0** |
| Original signed records read back | 20/20 | 100/100 |
| Established / sponsored / entry active | 12 / 7 / 1 | 12 / 20 / 68 |

Opening 20 was approximately **5.2x faster** and required 80 fewer active gossip topics. RAM savings were ~4.6 MiB after fixture creation and closure, not a fresh-process RSS comparison. The 80 dormant indexes' signed histories were not deleted. On-demand opening costs time and may evict a lower-priority subscription.

Reproduce with the standalone commands **node --expose-gc benchmark-priority-recovery.mjs 20** or **100**, inside a disposable resource-capped container with the checkout mounted read-only. See the script header for requirements.

## Separate worker processes: physically isolate an entry class failure

An actual network flood can still overwhelm 20 databases running inside one Helia/libp2p/Node process. Another sandbox module, **v2/network/isolated-tier-worker.mjs**, runs one OrbitDB log, Helia instance and blockstore **per independent OS process**.

Each worker has its own loopback-only HTTP endpoint with a maximum 48 KiB signed envelope, 30 attempted writes/minute, 50 stored events, four concurrent appends, 16 open HTTP connections, mandatory Content-Length, short HTTP timeouts and independently Ed25519 signature-verified curator-only OrbitDB event log. A worker's class is selected by the operator **at process launch**, not by incoming event JSON. Established/sponsored lab workers require a separate operator-owned public-author allowlist standing in for future independent, verifiable evidence. **The allowlist is a lab fixture, NOT a working earned-karma, governance or Stake4Karma verifier, and must not be treated as one.** Each worker's rate caps are demonstration parameters vastly below the user's hypothetical legitimate future workload.

The Node integration test starts two separate Helia/OrbitDB worker processes, accepts original signed events, refuses unauthorized writing to the protected worker, sends 100 invalid packets to the entry worker, force-kills that process, then checks the protected worker still responds and appends a second valid original publication.

A second experiment ran on the remote test host using **two isolated Docker cgroups**:
- Each had no external network, **0.25 CPU, 256 MiB RAM, 64 PID limit**, read-only root filesystem and repository; writable temporary storage only, dropped Linux capabilities and no-new-privileges.
- An extra busy loop **inside the entry container** saturated that container's CPU quota; the established worker continued responding.
- The entry container was then stopped; the established worker continued answering health checks.

| Established worker health check | Measured end-to-end elapsed |
|---|---:|
| Normal | 388 ms |
| While entry container's CPU was saturated | 394 ms |
| After entry container was stopped | 388 ms |

These timings include launching a fresh test client inside the CPU-limited established container, so they are NOT pure HTTP server latency. The cgroup limits were confirmed via Docker inspect: NanoCpus=250000000, Memory=268435456 bytes and PidsLimit=64 on EACH independent container. The 0.25-CPU worker took roughly 12–17 s to initialize. All benchmark containers and temporary data were removed; the hosted WEB9000 peer was not modified.

**What this establishes:** a failed or overloaded entry process can be physically separated from a protected process with enforced CPU/RAM/PID quotas, unlike 100 OrbitDB logs within one shared Node.js process.

**What this does NOT establish:** resilience to public Internet network floods; a cheap trusted source-classification gateway; end-to-end HTTP/WebSocket/libp2p intake scheduling; ISP bandwidth/IOPS isolation; verifiable stake/endorsement semantics; replica completeness from 20 subscriptions; physical garbage collection of OrbitDB and UnixFS child blocks. The experiment's no-network setting explicitly excludes actual public-network behavior.

## Implementation direction, no hard global thresholds

Separate **historical storage shards**, **active gossip subscriptions**, and **isolated worker pools**. Keep verifiable historical addresses (up to 100 is affordable for small workloads) but default to about 20 active local subscriptions. Reserve protected worker capacity and at least a small entry path. Place source-based country/ASN/VPN/datacenter compartments inside a small number of OS-limited Helia worker pools, instead of launching 100 heavyweight daemons by default.

The next critical step is a minimal **pre-OrbitDB bounded ingress gateway** capable of observing trusted transport metadata, enforcing cheap connection and bandwidth caps before expensive parsing/fetch, and routing only independently verified authorization to protected workers. Workers must be bounded at the OS level so failed untrusted compartments cannot consume established workers' CPU/IOPS. Later build safe actual storage reclamation, independent manifest dissemination, and reproducible sustained adversarial flood benchmarks. These experiments did not establish globally approved karma policies or any permanent national/IP ban.
