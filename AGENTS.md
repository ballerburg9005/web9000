# WEB9000 — development specification (v2)

**Status:** Actively rebuilding. The root `index.html`, `stubloader.js`, `styles.css` and legacy tests are historical prototypes. The new application lives in `v2/`. The original historical instructions are archived at `legacy/AGENTS-2025.md`.

## Non-negotiable protocol constraints

1. **Permissionless publishing to all spaces.** Any signer can publish a content event addressed to any arbitrary namespace. There is no global namespace owner, moderator, registry, admin key, DAO veto, enforced group membership, or stake requirement for cryptographically valid records. Even a website claiming dictator-like ownership over a space cannot stop competing signed publications from being carried by independent peers.
2. **No universal deletion or revocation.** Records are immutable, signed and independently retrievable from any willing holder. Retractions, spam flags, illegal-content hash labels, copyright claims and owner preferences affect only adopted *views* and *local replication*. Never add an API that deletes third-party copies or a consensus that makes signed content retrospectively invalid.
3. **Voluntary replication and moderation.** Peers choose which records/IPFS blocks to mirror. People can form self-governing hierarchical groups, inherit or override rules, and choose independent moderation specialists. Group charters, membership decisions and votes are **signed claims**, not universal network permissions. Conflicting ratified group histories stay selectable.
4. **No compulsory anti-bot credential.** Stake4Karma is optional reputation evidence and its current testnet contract is unaudited. Invitations require consent; weighted reputation influences a viewer's feed, never a post's ability to exist.
5. **No surprise media.** Text metadata and IPFS CID references may propagate without fetching file bytes. Do not automatically download or pin unknown media. Node operators individually choose refusal, quarantine, and unpin policies based on reviewed evidence. Respect applicable law; no global takedown command.
6. **No authoritative infrastructure.** Neither OrbitDB indexes, libp2p bootstrap/relay nodes, WebSocket bridges, static website hosts, nor IPFS pinning peers may become mandatory for protocol validity. Advertise portable signed records independently of indexes; users may operate alternative indexes, bridge them, and host their own transport peers.

**Physical limitation:** A record absent from all online mirrors cannot be made magically available. Permissionless publishing and immunity from universal remote deletion do not guarantee eternal reachability.

## Current implementation

- `v2/core/events.js`: domain-separated Ed25519 canonical signed events, arbitrary post fields, IPFS metadata references, signatures and schema. Preserve event-v1 compatibility or explicitly version migrations.
- `v2/core/replica.js`: local signature-validating independent mirror, deliberately no space ownership ACL.
- `v2/core/policy.js`: local reviewer delegation, space preferences, independent deduplicated labels, feed visibility.
- `v2/core/governance.js`: signed founder charters, proposals, votes, quorum, competing ratified forks; no globally selected head.
- `v2/core/reputation.js`: mutually signed invitations, bounded multi-hop trust and local sponsor sanctions. Not a staking verifier.
- `v2/core/media-policy.js`: individually adopted CID-level and record-level quarantine and optional **local** unpin.
- `v2/core/identity-backup.js`: password-encrypted portable key backups; no administrator recovery.
- `v2/app.js`, `v2/index.html`, `v2/styles.css`: redesigned static browser UI. The code host is not a database.
- `v2/network/node-peer.mjs`: a persistent libp2p/Helia/OrbitDB Node mirror with optional local WebSocket-accessible browser bridge, configurable P2P port.
- `v2/network/browser-mesh.js`, `browser-bridge.mjs`, `mirror-policy.js`: browser-to-independent-peer transport, signature validation, manual replication scopes, optional conservative trusted-record mirroring across unrelated indexes.
- `v2/network/site-context.js`: a website can suggest a space and an owner-preferred *view*; this is never exclusive write permission.

The browser currently uses WebSocket to arbitrary independent Node mirrors, **not** direct browser-native libp2p or a public bootstrap network. IPFS upload/pinning and abuse screening are not complete. Do not claim a production-ready or anonymous network.

## Operational instructions

From the repository root, `python3 -m http.server 4173` serves the static v2 interface at `/v2/`. In another terminal run `cd v2/network && npm install && node node-peer.mjs ./peer-a`. The peer exposes a loopback `ws://127.0.0.1:8787/` bridge by default; select it in the browser under **Manage peers**. A real HTTPS deployment requires an independently controlled WSS reverse proxy. `WEB9000_P2P_PORT=9000` sets a stable incoming TCP port, while a per-directory peer key persists libp2p identity. See `v2/README.md`.

## Tests / engineering rules

- Node.js >=22; pure ESM; prefer browser-native Web APIs, no mandatory hosted APIs.
- Run `cd v2 && npm test` for cryptography, governance, reputation, media and policy tests.
- Run `cd v2/network && npm install && npm run test:peer-identity && npm run test:peers && npm run test:browser-bridge && npm run test:independent-indexes`.
- GitHub Actions `.github/workflows/web9000-v2.yml` performs these checks. Fix failing tests and verify the latest head commit before claiming success.
- Preserve signed event interoperability; validate every untrusted ingress by schema and signature; bound memory, message size and rate. Render external text with `textContent`, never as untrusted HTML.
- Media pinning, legal compliance, CSAM prevention, private/political-group confidentiality, identity privacy, and hostile hosted-app scripting remain security-critical tasks requiring review.
- Use a development branch/draft PR; do not merge over the historical interface without explicit approval.
