# WEB9000 / v2 prototype

This folder is the **replacement project**, built independently of the legacy single-file GunDB UI.

## Browser interface with optional peers

From the repository root:

```bash
python3 -m http.server 4173
# http://localhost:4173/v2/
```

Requires a modern browser with Ed25519 WebCrypto and IndexedDB. The UI works locally and now connects to *user-configured* WebSocket bridges on independently operated OrbitDB/libp2p peers, with signature-checked event synchronization. It has **no mandatory default server**, public bootstrap service or browser-native libp2p transport yet. It signs posts with a local browser key, validates signed incoming records, supports JSON import/export, shows configurable views and lets users flag posts without deleting the originals. The fixture content is fictional and generated locally as properly signed events. Its gallery images reference assets already in the repository.

Run deterministic protocol and policy tests (Node.js 22+):

```bash
cd v2
npm test
```

## Experimental actual P2P peers

The **Node OrbitDB peer** includes an optional loopback WebSocket bridge (default `ws://127.0.0.1:8787`), usable by a browser served from any HTTP origin. Browser clients are transport clients rather than full libp2p nodes:

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

To publish, paste a signed WEB9000 envelope JSON on one line into either peer's stdin. The index accepts signatures from any author with any space name. Peers with the same OrbitDB address can synchronize records, assuming compatible network connections. CI verifies both native two-peer OrbitDB synchronization **and** two browser-compatible WebSocket clients connecting through different peers, publishing bidirectionally, rejecting signature tampering, and fetching old records on reconnect. The peer still does not host IPFS media.

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

## Practical scope

CI currently tests both the dependency-installed Node P2P sync and core cryptographic/policy unit tests. This is not a production security audit. The v2 browser UI remains an offline-only static demonstration; it can import/export fully signed event JSON but does not connect to the working Node peers yet. No static site must be appointed a network leader. Any operator may eventually host discovery/relay/pinning nodes, subject to locally chosen replication and applicable law.

## Browser-to-peer transport (development)

In a separate terminal, serve the static board (its HTTP host does not store posts):

```bash
python3 -m http.server 4173
# open http://localhost:4173/v2/
```

In the peer terminal:

```bash
cd v2/network && npm install
WEB9000_WS_HOST=127.0.0.1 WEB9000_WS_PORT=8787 node node-peer.mjs ./peer-a
```

Select **Manage peers** in the browser, enter `ws://127.0.0.1:8787`, then **Connect selected peers**. Posts, governance votes and labels created while offline are queued and sent when peers return. The client verifies all signed records and stores them in IndexedDB. You can configure up to eight independent peer endpoints; no endpoint has global space ownership. A node may still decline to accept or retain a publication. The browser supports separate **replication scopes** and **local display follows**; media CIDs are only metadata until explicitly fetched by a separate, future IPFS media workflow.

For deployment on HTTPS websites, use `wss://` (TLS reverse proxy in front of the node's loopback WebSocket port). Set `WEB9000_WS_ORIGINS` to an optional comma-separated Origin allowlist, or leave it unset to accept embeds from any origin. Do not expose the unaudited development bridge to the public Internet without hardening, abuse controls, and operator-specific retention rules. Each websocket provider sees connecting IPs and the signed records requested. **This transport is not direct browser-to-browser libp2p**; replaceable WebSocket-accessible nodes are currently required for cross-domain networking, and a self-hosted peer can replace a missing one.

## Multiple unrelated indexes and selective mirroring

WEB9000 does **not** require all peers to agree on one OrbitDB address. The browser may connect to several unrelated indexes. When **Mirror trusted records between peers** is explicitly enabled, the local view can relay verified signed posts it trusts to each other chosen peer, subject to independently selected replication scopes and moderation. This is opt-in and off by default. The **Mirror approved records now** button sends currently retained and locally approved posts to configured peers without downloading media. A peer can still decline a record; no index can invalidate a signed record held elsewhere. This is a simple browser-carried bridge between different indexes, not automatic global discovery. It does not claim universal reachability or compliance screening of unseen data.

## Embed the board on an independent website

Copy the static `v2/` folder to any ordinary HTTP(S) host. The code host is not the content database. Set `?space=` to suggest a namespace, `&owner=ed25519:...` to optionally prefer one signing identity's posts, and `&embed=1` for compact embedding. Example (substitute your **own** static host):

```html
<iframe
  src="https://your-site.example/v2/?space=your-local-board&embed=1"
  title="WEB9000 community board"
  style="width:100%;height:800px;border:0"
  sandbox="allow-scripts allow-same-origin allow-downloads">
</iframe>
```

If an `owner=` key is supplied, the embedded board exposes a toggle to **ignore the site's owner-preferred view**. The preference never grants exclusive writes, removes outside authors' signed records or changes another client's policy. The site's host cannot silently pick WebSocket peers by query string; visitors configure their own peer endpoints. In embedded cross-origin iframes, browser storage partitioning and third-party restrictions may affect persistence—self-hosting on the same origin is preferred. No privacy anonymity is promised by this transport.
