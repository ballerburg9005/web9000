# WEB9000 Base Sepolia testnet media staking

2026-11-21 — implemented in source, NOT enabled on the hosted WEB9000 peer. Automated tests use a **mocked Base Sepolia RPC with genuine Ed25519 cryptography and real Helia media transport**, not a deployed public testnet contract.

## What is implemented

A separate, bounded operator issuer verifies an independently signed Stake4Karma challenge against the **current active TEST ETH escrow position** on chain 84532. It pins the exact deployed escrow address, SHA-256 of runtime bytecode, and operator-selected HTTPS read-only RPC. A verified lock awards one file-specific grant for up to 20 MiB video (simulated $100) or 100 MiB video (simulated $1,000), or a 1 MiB image.

The selected media peer independently pins the issuer public Ed25519 key and audience, and verifies the signature, expiry, file MIME type, length, SHA-256 and distinct Base Sepolia testnet domain before storing the bytes. A production-mode peer cannot accept a testnet-mode grant, even from the same signer.

The issuer is operator-optional, loopback-only by default, with 5 KiB bounded bodies, 24 attempts per minute, 2 in-flight verifications, at most 128 outstanding challenges, and a private 0600 issuer signing key. Challenges bind the user's WEB9000 identity and exact media file. Their nonces are single-use. The issuer performs only read-only contract calls and owns no on-chain wallet key.

The WEB9000 browser composer can connect an EIP-1193 wallet, explicitly ask for a test ETH deposit with wallet confirmation, hash the selected large file locally, sign the challenge with the current WEB9000 Ed25519 identity (never transmit its private key), obtain the short-lived grant and upload normally through the chosen media provider. A deposit is not required if a qualifying testnet lock already exists.

## Simulated tiers (NOT real dollars)

| Media | Anonymous | Simulated $100 tier | Simulated $1,000 tier |
| --- | ---: | ---: | ---: |
| Image | 512 KiB | 1 MiB | 1 MiB |
| Video | 4 MiB | 20 MiB | 100 MiB |
| Audio | 10 MiB | 10 MiB | 10 MiB |

Illustrative operator test-ETH thresholds: 0.0001 test ETH (100000000000000 wei) for simulated $100; 0.001 test ETH (1000000000000000 wei) for simulated $1,000. **These are arbitrary testnet thresholds, not valuations or exchange rates.** Each operator may choose different strictly increasing test-ETH amounts. Tiny images at <=50/100 KiB keep reserved high priority.

## One-time contract deployment

The current Stake4Karma GitHub README explicitly says **no shared deployed Base Sepolia contract address is provided**. A testnet participant must deploy or deliberately choose one. See https://github.com/ballerburg9005/stake4karma#deploy-your-own-testnet-contract for wallet-confirmed Base Sepolia deployment and withdrawal instructions, using the actual contracts/Stake4Karma.sol source and a **disposable test-only wallet**. Contract source is unaudited; do not use real ETH, mainnet coins or an important wallet.

**Key-binding warning:** a Stake4Karma wallet is permanently bound to one Ed25519 credential key. The WEB9000 grant uses the browser's current WEB9000 Ed25519 posting key. If the wallet was registered in the independent Stake4Karma demo with another credential key, it cannot prove eligibility for this WEB9000 identity. Use a fresh disposable test wallet (or deliberately use the exact same backed-up credential key). Do not assume creating a new WEB9000 key updates the escrow.

## Operator commands (private and optional)

From the WEB9000 repository's v2/network directory, obtain the runtime code hash:

    node testnet-media-config.mjs inspect https://sepolia.base.org 0xACTUAL_BASE_SEPOLIA_ESCROW_ADDRESS

The operator must **independently inspect the contract source and code before pinning**: a hash supplied by one RPC endpoint alone does not establish safety. Compare with the deployed contract on Base Sepolia explorer.

Create a new 0600 private issuer file outside all website roots:

    mkdir -m 700 /private/testnet-media
    node testnet-media-config.mjs init \
      /private/testnet-media/issuer.json \
      https://sepolia.base.org \
      0xACTUAL_BASE_SEPOLIA_ESCROW_ADDRESS \
      VERIFIED_RUNTIME_SHA256 \
      100000000000000 \
      1000000000000000 \
      operator-demo-media-001

This creates a new operator Ed25519 key, prints the public issuer/audience and **refuses to overwrite an existing issuer key**. Never share issuer.json. Start the isolated issuer:

    node testnet-media-issuer.mjs /private/testnet-media/issuer.json 18769

Default bind: 127.0.0.1. Endpoints: GET /health, POST /challenge, POST /grant. For a remote browser, the operator must separately provide HTTPS access to these endpoints through its preferred optional frontend or tunnel. No mandatory Nginx or central relay is required.

A media peer with separate, voluntary rich-media uploads, enough disk and a specifically pinned testnet issuer can set:

    WEB9000_MEDIA_SERVER=1
    WEB9000_MEDIA_UPLOAD=1
    WEB9000_MEDIA_RICH_UPLOAD=1
    WEB9000_MEDIA_STORAGE_MIB=256
    WEB9000_ENABLE_TESTNET_MEDIA=1
    WEB9000_MEDIA_STAKE_MODE=base-sepolia-testnet
    WEB9000_MEDIA_STAKE_ISSUER=ed25519:EXACT_ISSUER_FROM_INIT
    WEB9000_MEDIA_STAKE_AUDIENCE=operator-demo-media-001

These are **environment-file example entries**, not instructions to overwrite the existing peer. A peer must deliberately opt in to BOTH the testnet mode and an exact issuer key. Running without these settings retains the 512 KiB image / 4 MiB video ordinary limits. A production-mode peer rejects all testnet grants. The current hosted peer and public proxy were not updated; a 100 MiB upload would additionally require adequate operator disk, temp storage and any external HTTP request-body limits.

## Using the WEB9000 browser

1. In the Classic post composer, select one oversized image/video and an independently approved media peer. Open Optional operator-verified media stake grant.
2. Enter the chosen operator's Base Sepolia testnet issuer URL. Click Use browser wallet to select the disposable wallet on Base Sepolia, chain 84532. The wallet must be bound to **the same WEB9000 signing key**.
3. If insufficient test ETH is locked, click Lock test ETH (wallet confirmation). The browser reads the current position, checks the permanent signing key binding, validates chain 84532 and only then submits a wallet-confirmed transaction to the selected escrow contract. No deposit is made automatically.
4. After the transaction is actually mined, click Verify stake and request file grant. The browser hashes the file locally and sends only the hash/size/type and signed challenge to the issuer, not the media bytes or signing private key.
5. Publish the selected file promptly: signed grants expire after 60 seconds. Changing file selection clears the grant. The media peer re-verifies the exact file bytes.

To request exit or withdraw test ETH, use the original wallet and the Stake4Karma demo/recovery interface; WEB9000 does not custody or withdraw coins.

## Verification

- Run npm run test:media-testnet from v2/network. Tests cover operator config security, Base Sepolia chain/code pinning, independent active position lookup, issuer nonce anti-replay, file-bound Ed25519 token signing, 100/1000 testnet tier limits, browser wallet simulation, a real >21 MiB video UnixFS upload via the simulated $1,000 tier and **production rejection** of the testnet grant.
- The existing npm run test:media and npm run test:classic-ui suites test ordinary media admission and browser functionality. Testnet HTTP challenge/grant flows run under the browser client module; no mainnet or real chain transaction is executed by these tests.
- The upstream Stake4Karma repository also offers a disposable local-EVM Solidity integration test. A public Base Sepolia transaction, wallet-confirmed deposit or real escrow codeHash pin has **not** been performed automatically by this change.

For an optional full-size stress test, set WEB9000_BENCH_TESTNET_MEDIA_100=1 in a disposable memory-/CPU-/scratch-disk-limited Node 22 container to exercise an exact 100 MiB file and the same mocked testnet contract and independently signed grant path. This exact-size test passed in a disposable 0.6-CPU/1,250-MiB container, uploading 104,857,600 bytes through the testnet-only grant to a real UnixFS media provider and verifying HTTP 206 retrieval. This is NOT proof of any deployed live Base Sepolia escrow.

Remaining: deployment of a particular independently inspected Base Sepolia escrow using a test-funded wallet, exposure of the operator-selected issuer/media peer if public access is desired, wallet/browser field testing with a real confirmed testnet transaction, and smaller-memory browser hashing for 100 MiB files. **No fiat-price oracle or audited mainnet contracts are required to continue the testnet experiment.**

All original WEB9000 signed posts, independent groups, 20 physical OrbitDB database cap and historical media records remain unchanged.
