# WEB9000 / v2 prototype

This folder is the **replacement project**, built independently of the legacy single-file GunDB UI.

## Offline interface

From the repository root:

```bash
python3 -m http.server 4173
# http://localhost:4173/v2/
```

Requires a modern browser with Ed25519 WebCrypto and IndexedDB. The UI displays an explicit **LOCAL PROTOTYPE** status because it does not yet connect to remote peers. It signs posts with a local browser key, validates signed incoming records, supports JSON import/export, shows configurable views and lets users flag posts without deleting the originals. The fixture content is fictional and generated locally as properly signed events. Its gallery images reference assets already in the repository.

Run deterministic protocol and policy tests (Node.js 22+):

```bash
cd v2
npm test
```

## Experimental actual P2P peers

A separate **Node-only**, manually dialed OrbitDB experiment is included:

```bash
cd v2/network
npm install
node node-peer.mjs ./peer-a
# prints INDEX address and PEER multiaddrs
```

Then start a second terminal:

```bash
cd v2/network
node node-peer.mjs ./peer-b 'PASTE_ORBITDB_ADDRESS_FROM_PEER_A' 'PASTE_REACHABLE_PEER_MULTIADDR'
```

To publish, paste a signed WEB9000 envelope JSON on one line into either peer's stdin. The index accepts signatures from any author with any space name. Peers with the same OrbitDB address can synchronize records, assuming compatible network connections. This path **has not yet passed a live multi-peer interoperability test**, and the peer does not serve a browser UI or host IPFS media.

The exact OrbitDB index address is a discovery hint, **not** a globally protected namespace. A peer can create another index, and can advertise events independently of any index. The proof-of-concept peer's stdout and local blockstore belong entirely to its operator.

## Next steps, before claiming a distributed app

- Actual browser libp2p transports with independently runnable bootstrap, discovery and relay options, supporting cross-domain embeds
- Persistent peer identity and pinned indexes, anti-entropy and peer-failure recovery
- Replication scopes and explicit local IPFS pin/unpin, preview safety, retention and legal compliance
- Signed group membership/governance policies, including voting/quorums/delegation/appeals
- Verified optional Stake4Karma adapter on testnet (no real funds until independent audit)
- Cross-browser testing, two-peer smoke tests, abusive peer/flood benchmarks, security audit

More detail: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Opt-in media handling

`core/media-policy.js` enforces a local-only preview/pinning decision: by default IPFS bytes do **not** automatically download, and independently trusted reviewer quorum is needed to quarantine by CID or source event. A node operator can choose `autoUnpin` with a local unpin handler; there is no protocol-wide deletion ability. This is policy code only: the UI does not fetch arbitrary IPFS content and a real node pin manager is not yet connected. Consult local legal counsel before operating a public media host.

## Identity portability

New browser keys can be exported **only in encrypted form** using `core/identity-backup.js`: WebCrypto PBKDF2-SHA256 (300,000 iterations) and AES-256-GCM with a random salt and authenticated metadata. The backup is password-protected and can be imported on another domain, preserving the original Ed25519 public identity. Legacy non-exportable prototype keys can only migrate to a new identity with a signed endorsement; they cannot be magically extracted. **The browser must be trusted with the decrypted key while in use.** A hostile hosted copy can forge signatures, irrespective of backup encryption. There is no central password reset or key escrow.
