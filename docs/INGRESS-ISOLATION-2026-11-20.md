# WEB9000: bounded ingress and 20-database operator policy

**2026-11-20 — TESTED, OPT-IN LAB WORK ONLY. Not activated in the hosted peer, website, existing OrbitDB index, public IPFS provider, or public WebSocket bridge.**

## Owner decision: 20 new physical databases

The owner explicitly chose **20 databases**, not 100:

> "20 DB it is then"

New adaptive router instances default to **at most 20 physical shards and reject configuration above 20**. This applies to newly created operator-managed physical databases, not deletion of already-created historical addresses. The signed historical directory can still verify and discover older records even if an operator previously hosted more than 20. The read-only priority loader defaults to 20 active subscriptions, with a small reserved unverified entry slot, higher independently attested levels opened first, and lazy historical opening. The previous 100-way benchmark is retained as a historical comparison; it is **not** the new operating target.

A maximum of 20 configured physical worker endpoints is also enforced by the new ingress gateway. An operator may run multiple source/VPN/ASN/country *compartments* behind fewer physical worker instances; compartments are congestion/failure domains, not convictions against their users. External IP classification and actual independent reputation semantics still require engineering.

## New ingress system

Three new experimental components are in v2/network:

- **ingress-capability.mjs** creates short-lived (up to 5 minutes) Ed25519-signed, domain-separated **operator-issued metadata-routing credentials** tied to a particular original signer, an independently chosen sponsored/established class, scope metadata-publish, issuer, expiry and random nonce. The verifier requires a **pinned operator issuer** and rejects forged signatures, edited tiers, expired proofs, a different author, unexpected fields and out-of-range expiry. It does **not** independently evaluate Stake4Karma, attest group reputation, issue invitations or confer identity. The issuer is an operator-owned lab signer. The signed original post must independently verify as having been authored by the credential subject at the worker; a stolen receipt alone cannot forge that author's signed content.
- **bounded-ingress.mjs** runs an independent, loopback-only HTTP gateway. It pre-limits request/connection sizes, bytes, pending operations, verification attempts, observed-source quotas, and per-class/compartment quotas **before forwarding to Helia/OrbitDB**. It derives source observations only from the trusted local socket and an optional operator-owned classifier, **never** from X-Real-IP, X-Forwarded-For, a signed-post claim, a client-provided country or a claimed karma/tier header. It forwards only the original bounded signed envelope and, for verified protected routing, its original operator credential. Worker URLs are fixed loopback values in local configuration, never request-controlled; at most **20 endpoints** are accepted. Worker timeouts and failure codes are bounded; a failed or overloaded entry worker should not prevent distinct authenticated high-tier processing.
- **isolated-ingress-process.mjs** launches independently runnable **entry** or **protected** gateway processes with separate operator-owned JSON configuration. Entry-only listeners never accept a claimed protected credential; protected-only listeners **require** a verifiable operator credential before reading a post body. Each process can be placed in a **different operating-system cgroup**, alongside the existing independently limited Helia/OrbitDB worker executables. Do not rely on just two ports within one process to withstand a process-wide flood or crash.

The existing **isolated-tier-worker.mjs** now accepts an alternative operator-owned configuration {mode: pinned-ingress-capability, issuer: ...} for protected classes, verifies the credential *again* against the original event author and its own protected class, and still independently Ed25519 verifies the content before appending. The old protected-allowlist test fixture continues to work solely for regression testing, **not** as a production trust system.

The gateway deliberately remains loopback-only. It is not a hardened public Internet edge, Nginx/WSS adapter or complete libp2p prefetch firewall. Its limits are experimental values far below projected future legitimate vote throughput.

## Real integration results

Four targeted ingress tests now pass:

1. Valid operator-signed capability accepted. Attacker issuer, edited credential tier, wrong author, wrong class and expiry are rejected.
2. With two **real, separate Helia/libp2p/OrbitDB processes**, a bounded gateway accepts independent signed free-entry and independently credentialed protected posts; forged JSON karma, geography, and X-Forwarded-For headers fail to elevate. A burst of 80 invalid entry frames is largely rejected **before** expensive OrbitDB verification. Protected signed publishing continues after the entry worker is forcibly killed.
3. Gateway initialization rejects more than 20 physical configured worker endpoints and remote/non-loopback backend addresses.
4. With **two distinct ingress processes AND two distinct Helia/OrbitDB processes**, the entry route is saturated with invalid frames; the entry gateway is then forcibly killed. The protected ingress process and protected Helia worker continue to accept another valid, credentialed, originally signed event. Neither gateway shares an event loop, budget map or socket queue with the other.

The earlier **0.25 CPU / 256 MiB RAM / 64 PIDs per Docker container** trial demonstrated OS-enforced survival under CPU saturation and process death for the underlying worker layer. The new dual-gateway experiment demonstrates **process separation**, but does not yet reproduce an Internet-scale attack or measure the gateway under dedicated cgroup saturation. The operator must enforce OS/container quotas on ingress gateways too, and ensure their public reverse proxy/L4 listener does not bottleneck all classes together.

## Remaining blockers before live cutover

- **Deploy-time worker orchestrator**: securely provision a small number of physical Helia workers with isolated CPU/RAM/PID/IOPS/network budgets; connect them to trusted entry/protected frontends. A DNS, NAT, reverse proxy or libp2p layer can still be a shared failure point.
- **Trust verification**: a real, independently reviewed receipt issuer for qualified endorsement/vouch, group trust, signed invitation and/or independently verified Stake4Karma bond. The prototype issuer signs *lab* proofs; it does not establish who deserves them.
- **Source policy**: choose operator-owned ASN, country, proxy/VPN and coarse-prefix intelligence and ensure original source observations are not confused with relayed final hops. Classifications isolate resources without asserting identity guilt.
- **Physical resource control**: actual bounded OrbitDB gossip/prefetch subscriptions **before** costly fetches, scalable disk GC of blockstores and UnixFS child CIDs, per-class bandwidth limits and IO isolation under many independent attackers.
- **Federation**: optional publishing/discovery of operator-signed physical shard directories, explicit per-reader trust, coverage checks and graceful recovery from overload without a namespace owner.
- **End-to-end flood simulation**: separately cgroup-capped ingress/worker containers with concurrent flood, resource metrics and valid protected traffic during failure. The local process-level test and earlier cgroup-worker test are important evidence but do not prove complete public-network resilience.

The experiments make no global policy about which countries, VPNs or users are permitted to speak. Signed records remain portable to any willing independent peer, and ordinary social downvotes do not automatically erase a zero-karma access path.
