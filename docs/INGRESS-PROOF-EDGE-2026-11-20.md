# WEB9000: isolated ingress edges and genuinely signed trust evidence

**November 20, 2026. Opt-in staging implementation only. The hosted WEB9000 v2 site, existing signed OrbitDB index, users, media host, and production reverse proxy were NOT reconfigured.**

This extends [INGRESS-ISOLATION-2026-11-20.md](INGRESS-ISOLATION-2026-11-20.md) from direct JavaScript and worker tests to a **real HTTP/Nginx boundary with isolated OS resource limits**, and replaces simulated "someone trusted this user" authorization with two verifiable WEB9000 proof types plus an **optional Base Sepolia-only Stake4Karma v0.5 adapter**. The previously selected **20 new physical databases** limit is unchanged. Historic signed databases remain readable through the manifest; no migration or deletion was undertaken.

## 1. Three independently budgeted HTTP edges

The *opt-in* Docker Compose staging stack in **v2/network/deploy/docker-compose.lab.yml** starts eight containers:

| Ingress plane | Containers | Binding and allocation |
|---|---|---|
| Unverified entry | Nginx entry edge, entry ingress, Helia/OrbitDB entry worker | Host **127.0.0.1:18180** only; Nginx 0.15 CPU / 64 MiB / 32 PIDs; gateway and worker individually 0.25 CPU / 256 MiB / 64 PIDs |
| Protected signed publishers | Nginx protected edge, protected ingress, Helia/OrbitDB sponsored worker | Host **127.0.0.1:18181** only; same separate Nginx and worker caps |
| Expensive trust verification | Nginx proof edge and independently running signed-proof issuer | Host **127.0.0.1:18182** only; Nginx 0.15 CPU / 64 MiB, issuer 0.20 CPU / 128 MiB, separate PID limits |

All containers have read-only root filesystems, dropped Linux capabilities, no-new-privileges, and only narrowly selected writable temporary or persistent mounts. Each plane has its **own Docker network namespace**; its internal gateway, issuer or worker bind to **127.0.0.1 inside that namespace**, not to the host. Only the Nginx ports are host-published. Docker bridge networks currently allow egress; this is NOT a claim of full egress/network isolation.

Nginx enforces independently allocated per-remote-IP request and concurrent-connection budgets, buffers requests before forwarding, and caps body size at 48 KiB. Invalid requests are refused at the edge without consuming OrbitDB signature verification, IPFS synchronization or persistent record allocations. Gateway and worker repeat the signed-author checks independently. The entry proxy forcibly removes any claimed protected credential, while the protected proxy requires one. The true authority is still the pinned signature, not a header.

The Nginx control planes are independent **containers and cgroups**, not just two paths in one Nginx instance. The proof issuer has a third independent queue and CPU budget. All rate numbers in the staging code are tiny deliberately experimental settings, **not intended to support the owner's eventual legitimate million-vote/day workload**.

### Actual Docker trial

Using only fresh disposable signed keys and temporary stores on the remote Docker host:

- A valid unverified signed post through **127.0.0.1:18180/publish** returned HTTP **200**.
- A post without proof to the protected edge returned HTTP **403**.
- A genuinely signed invitation plus signed acceptance through **127.0.0.1:18182/qualify** returned an independently operator-signed sponsored credential.
- Publishing with that credential through **127.0.0.1:18181/publish** returned HTTP **200**.
- Sending **100 invalid entry HTTP requests concurrently** resulted in **96 HTTP 429** edge throttles and **4 HTTP 422** invalid-payload refusals; **zero of these invalid events were admitted as valid posts**.
- Protected publication returned **HTTP 200 during the entry flood**, and **HTTP 200 again after the ENTIRE entry Nginx edge container was stopped**.
- Docker inspect confirmed individual CPU/memory/PID allocations; no production containers were stopped.
- Cold-restart test with a completely new Helia/OrbitDB process reloaded original signed events at the same stable OrbitDB address. In the staging container, three earlier protected records were also observed after its CPU-limited restart finished initialization.

The independent entry, protected and proof edge stacks were shut down after testing. Their **temporary operator secrets and stores generated for this test** were deleted. Other site/server containers, WordPress media, and previously existing untracked browser test-artifacts were not modified.

**Important topology limitation:** Nginx sees the real connection IP on its own listener; the downstream gateway sees Nginx's **loopback**. The gateway's source cohort therefore becomes a single aggregate box for proxied requests. The edge's per-client limits still work for directly connected clients, but **country/ASN/VPN classification is not wired to the true end-client across an upstream TLS reverse proxy**. Before production, independently determine the trusted remote address at the *outermost* edge, verify proxy hops with a narrow trusted CIDR allowlist or a cryptographically authenticated local control plane, and only then pass the normalized observation to an internal compartment router. Do not simply trust arbitrary X-Forwarded-For or country headers.

## 2. Signed invitation and ratified group evidence — actually verified

**v2/network/operator-trust-proof.mjs** uses the repository's real, pre-existing, standalone signed-event verifier, **evaluateReputation** and **verifyGroupProof**. A local operator explicitly chooses their own trust policy and pins its roots or exact group branch:

- **Sponsored by invitation:** an original Ed25519-signed invitation from an operator-pinned root (or a bounded lineage from it) **and the invitee's independent Ed25519-signed acceptance**. An unsigned invite, a forged acceptance, an unaccepted invite, a chain without an operator root, ambiguous two-sponsor acceptance or an expired-before-acceptance invitation **does not confer sponsored access**. A cap on distinct invitees per sponsor, graph depth and attenuation prevent automatic popularity farming.
- **Established by group:** a fully signed, independently verified, quorum-ratified group branch proof, where the operator has **pinned both the exact founding group ID and the desired charter head**. Only subjects recorded as *voting members of that branch* qualify. An arbitrary self-created group, unratified proposal, stranger's purported membership or unpinned branch cannot grant access. A pinned group is a **local voluntary authority only**, not a global community-name owner.
- Both routes issue short-lived, subject-bound, operator-signed metadata-routing credentials. The protected worker independently checks the pinned issuer **and the original signed event author** before storing anything. Old signed events remain portable regardless of the operator's classification.

The issuer's persisted Ed25519 private key must be in an explicitly private regular file (0600); startup verifies that it matches the public issuer configured for the protected worker. The issuer runs with bounded request size, bounded verification concurrency and per-minute limits. It stores no password or wallet key from users.

## 3. Stake4Karma integration: OPTIONAL unaudited Base Sepolia TESTNET only

The actual **Stake4Karma v0.5 SDK** is vendored unmodified as **v2/network/vendor/stake4karma-sdk-v0.5.0.mjs**, sourced from [ballerburg9005/stake4karma](https://github.com/ballerburg9005/stake4karma), commit **cce170d99f105b8f7a67d7102586c64c70eff9e3**, with the original MIT license alongside.

The optional **stake4karma-testnet-verifier.mjs** uses Stake4Karma's real **createChallenge / signCredential / verifyCredential** protocol, not a fabricated client stake balance. An operator must separately pin **all** of the following to enable it:

- Base Sepolia chain ID **84532** only.
- An actual contract address and **SHA-256 of its immutable deployed runtime bytecode**. Do not assume a matching address alone proves legitimate escrow code or that the contract has been audited.
- A strictly positive minimum amount of **native test ETH in wei**. No equivalence to fiat, real ETH, ERC-20 or political/democratic trust is inferred.
- A trusted HTTPS JSON-RPC origin (read-only **eth_chainId, eth_getCode and eth_call**). Client RPC URLs and wallet-reported balances are never accepted as independent proof.

The proof issuer exposes **POST /challenge** with the original WEB9000 Ed25519 subject and **POST /qualify** with the subject and actual Stake4Karma-signed challenge response. The original WEB9000 signing key **must correspond exactly** to the public key bound to the on-chain stake position. The verifier checks the issuer's unexpired, unmodified nonce, the pinned runtime bytecode, the chain, original Ed25519 stake challenge signature, positive active locked position and minimum amount through a live read-only RPC, then **atomically consumes the issuer nonce**. Reusing the same challenge, claiming a different wallet key or submitting an unrelated signed post is rejected.

If verified, testnet staking confers only this operator's **sponsored physical capacity**, **never an established group role, moderation authority or network-global karma**. It does not require disclosing any wallet private key. Lack of a valid contract/RPC config disables this route (including /challenge), leaving free entry and signed group/invitation routes available.

**Verification scope:** The tests currently mock the RPC backend and validate that the SDK performs actual contract calls and rejects wrong-chain, mismatched code, insufficient/inactive funds and replayed signatures. No real Base Sepolia contract or funds were used; the upstream README explicitly describes the Solidity implementation as **unaudited** and does not publish a shared default deployed address. The current staging trial used **signed invitations, not on-chain staking**. Do not configure mainnet or real-money collateral based on these experiments.

RPC is not a consensus oracle: a malicious or compromised operator-configured endpoint could lie about chain state or contract code. A production bond verifier needs independently pinned, quorum-checked RPC results and chain finality requirements, plus audit and a clear economic amount/duration policy. The testnet code intentionally fails closed if its pinned RPC cannot respond.

## 4. Reproduce only in a disposable staging area

All commands below operate on an isolated sandbox, not the existing production host routes:

~~~bash
cd /srv/web9000/source
export WEB9000_SOURCE_ROOT="$PWD"
export WEB9000_LAB_HOME="$(mktemp -d /tmp/web9000-ingress-lab.XXXXXXXX)"
chmod 700 "$WEB9000_LAB_HOME"

# Generate a new, disposable operator signing key, 0600 secret files,
# bilateral signed invitation, and independently signed example posts.
docker run --rm --network none \
  -v "$PWD":/app:ro -v "$WEB9000_LAB_HOME":/lab \
  -w /app/v2/network node:22-alpine \
  node deploy/bootstrap-lab.mjs /lab

docker compose -f v2/network/deploy/docker-compose.lab.yml config --quiet
docker compose -f v2/network/deploy/docker-compose.lab.yml up -d
docker compose -f v2/network/deploy/docker-compose.lab.yml ps

# TEST listeners are host LOOPBACK ONLY:
#   127.0.0.1:18180/publish   entry
#   127.0.0.1:18181/publish   credentialed
#   127.0.0.1:18182/qualify   signed evidence
#   127.0.0.1:18182/challenge optional TESTNET only

# Stop ONLY this test Compose stack. No -v / pruning production volumes.
docker compose -f v2/network/deploy/docker-compose.lab.yml down
# Only after checking it is the exact temporary directory you created:
# rm -rf -- "$WEB9000_LAB_HOME"
~~~

The Compose staging networks use separate Docker bridge namespaces, but DO NOT block all outgoing network traffic. Their listener ports are bound to host 127.0.0.1 and are **not public HTTPS**. To make real external clients use this, deliberately configure a separate approved TLS edge with independent per-lane connection limits and authenticated source observations. Do not expose the raw Node.js worker, backend gateway or secret issuer-file mounts to the Internet.

## 5. Remaining critical work

- Persistently backed and auditable independent operator reputation preferences; signed directory distribution and replication coverage across independent groups.
- Real proxy-to-gateway source observation across trusted TLS/load balancer hops, and operator-managed country/ASN/datacenter/VPN feeds; never confuse the relay's egress country with the author's origin.
- Actual cgroup-dedicated media/network/disk IOPS budgets and **physical** IPFS/OrbitDB garbage collection; the current hard limits demonstrate basic CPU/RAM/PID process failure independence, not defense against a saturated external uplink.
- Public HTTPS deployment only after opt-in, operator key management, outage/failover plan, source authentication and load testing sized for *legitimate* traffic rather than the tiny lab quotas.
- Stake4Karma production readiness requires a deployed, verified, audited contract, minimum lock durations and minimum economic cost; no deployment or chain-backed financial protection is claimed here.
