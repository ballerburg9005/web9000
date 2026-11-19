> **WEB9000 decentralized v2 is now maintained on `main`.** Start with [v2/README.md](v2/README.md), the mandatory [AGENTS.md](AGENTS.md), the [short status](docs/STATUS.md), and the [open-issues backlog](docs/OPEN-ISSUES.md). The existing root page below is retained as the earlier UI; [the current classic v2 test board](https://syburg.my.to/web9000/v2/) is separate. The experimental raw peer is not automatically migrated to the new signed-append index.

# WEB9000

Permissionless, portable content publishing with self-governing communities, local moderation policies and independently mirrored records.

**The rebuild is in [v2/](./v2/).** The root-level `index.html` and GunDB-era UI are preserved solely as a historical prototype; the active protocol uses signed Ed25519 events, optional OrbitDB 4 / Helia / libp2p peer indexes and IPFS content references. A website can suggest a namespace and an owner-preferred view but cannot prohibit other people from publishing to it. Anyone can keep records; every operator chooses what to replicate or show. There is no global deletion or privileged moderator.

## Try the static v2 board

```bash
python3 -m http.server 4173
# Visit http://localhost:4173/v2/
```

For live peer transport, run an independent mirror in another terminal:

```bash
cd v2/network
npm install
WEB9000_P2P_PORT=9000 WEB9000_WS_PORT=8787 node node-peer.mjs ./peer-a
```

In the board, open **Manage peers**, enter `ws://127.0.0.1:8787/`, and connect. On HTTPS websites use a WSS proxy. You can choose different peers or manually mirror locally approved records between unrelated indexes. The code-hosting site is not the database, and no particular peer is required for publishing valid signed events.

This is experimental, unaudited research. Public bootstrap/discovery, direct browser libp2p, safe IPFS upload/pinning and private political-organizing features are still incomplete. No data availability, anonymity or end-to-end protection is promised.

**Technical details:** [v2 README](./v2/README.md) · [Architecture](./v2/ARCHITECTURE.md) · [Development instructions](./AGENTS.md).
