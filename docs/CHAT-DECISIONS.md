# WEB9000 — Chat requirements and decision ledger

This is an intentionally durable engineering handoff for future sessions. It records **user requirements**, the mistakes corrected, tentative proposals, implementation status and evidence. It is not a complete verbatim archive of the ChatGPT transcript. Preserve direct user phrases and add new entries whenever a user sends a new requirement: future agents must not lose the guiding purpose during context compaction.

## Requirements recorded from original prototype (2025) and November 2026 work

- The original prototype had a compact seven-column picture grid, keyboard navigation, selected-row expansion, media/gallery navigation, rating and flagging bars, tags/tag voting, comments, polls, schedules, open positions and a distinct colored overlay. Original assets/styles live under root-level \`index.html\`, \`styles.css\` and \`thumb/\`. New technology should **restore and enhance** this, not discard it.
- Universal data classes evolve from images/memes to blogs, marketplaces, jobs, events, projects and political/social organization. The early adoption model is a tiny independent image board for perhaps ~100-person communities hosted via static JS on any domain.
- Any public key may publish in any arbitrary namespace. The first person to register \`cats\` gains no ownership. Stewards and self-declared owners may suggest presentation, not censor the protocol. The public can audit suppressed posts and the identity/authority behind suppression.
- Classic commercial botspam must be dramatically uneconomic. Stake4Karma is the main proposed hard mechanism; default qualification ~USD $10 locked for weeks, with other independently reviewed earned-karma routes. Independent raw/unqualified and qualified replication lanes must be kept separate. Default unknown posts must not slip in merely by being unreviewed.
- Self-bootstrapping Sybil invitations and sold accounts must be punished economically. User floated tenfold negative reputation and severe, cascading sponsorship penalty, but exact multipliers, eligibility, adjudication and appeal are TBD. Daily limits: few posts, much more comment capacity. Invites are limited and subject to ancestral responsibility.
- Clans/groups/DAOs/federations are autonomous, hierarchical as needed, optionally democratic via recurring elections and delegated roles—not always karma voting and not one vote on every single item. No global judge for disputes.
- Legal and moderation responsibilities apply per operator/peer. Separate metadata and image/video/ZIP content; controlled media pinning/refusal; voluntary specialist review groups with auditable, revocable authority; anti-abuse and anti-false-flag mechanisms to prevent censorship disguised as safety.
- Group-voted presentation may override an author's suggestions in the **viewer-adopted view**; if no vote exists, defer to the author. A self-styled "blog owner" can propose a view, never disable universal comments or erase audit evidence.

## 2026-11-18: detailed course correction — USER INTENT (direct excerpts)

> "I wanted to keep the old frontend with the grid view and keyboard navigation. I mean it looked not as polished as your stuff, but it had a lot of details which were really unique and good UI-wise."

> "It looks as if you did just stubs, like I click an article/post it shows debug info basically but no real presentation with tags and comments etc. like in the prototype I had made of UI."

> "We cannot expect this to lift off massively, there is no marketing etc. ... in the first few years it is just this meme kind of image board software ... those small communities, like 100 people or such to share pictures or make a website frontend without servers just dump the JS on some domain."

> "The Stake4Karma, yes the software can be configured to work without it that is a must. But it should default to requiring a larger stake of at least $10 ... Because it is literally the only hard barrier to prevent bot spam."

> "No one has the power to restrict other people's freedoms. But everyone has the freedom to look away basically, and like said they can group themselves to filter out posts that don't meet criteria."

> "We can't leave gaps in the default presentation at least that would allow spambot posts to be instantly visible, just because no one has looked at the post yet."

> "It is about bots that just leave massive amounts of shit everywhere. And against this botspam the software needs to be very swift and sort of hard-coded to deal with attacks."

> "A group can't be held responsible for a member's post in a legal sense (not in a sense of being punished for spam like described before)."

> "The presentation again it is a suggestion that comes from your group and if group has no votes on presentation it takes suggestion from the original poster in that space."

> "There is a button and that button highlights what the self-proclaimed 'owner' or steward of the space removed or some account associated with extra authority in their scheme."

> "Anyone starts posting in 'cats' for example ... on web9000 this is not possible [to become owner] ... if users are acted against then it must all be auditable."

**Decision:** The universal open text/event protocol and optional curator peers are retained. Revert the main v2 frontend to the original-style compact grid, keep the alternate dashboard secondary, and make the image board fully usable before expanding the governance UX. Qualified admission requires independent verification, not only frontend filtering. No single reviewer or group is globally authoritative.

## 2026-11-18: second UI correction — USER INTENT (direct excerpts)

> "Document all the requirements I send in chat so new instance will not be at loss and not operate in wrong direction or spirit ... it is not a secret what I say in chat."

> "The UI rendering I can see grid initally looks good with the colors etc. But all posts just say demo, it doesn't have the icons for different post contents, like a meetup etc."

> "When I click poost then there is this tiny space to the left where all the text flows into I can't make out anything and the picture of pos is not shown I don't see voting flagging bars etc. normal things that were there before and stuff like clicking the post again does not collapse it."

> "Perhaps we finish UI first and since Stake4Karma needs a lot of testing probably we just use some stub testing provider for this in place. Like, this thing just gives a score for a user's key it is just a number basically that it provides we can fake that."

**Decision:** UI correctness first. Investigate the actual rendered grid geometry, not simply whether a DOM element exists. Build differentiated, meaningful demo posts with visible content-type icons, keep full-size image/gallery, interactions, collapsible details. Add a **clearly marked local mock numeric score provider** keyed by signing identity to test feed qualification; never misrepresent fake scores as real on-chain financial stake.

### Confirmed rendering bug and remedy

The root legacy stylesheet defines \`.nav-arrow { position: absolute; top: 50%; transform: translateY(-50%); }\`. The new expanded row reuses \`nav-arrow\` without resetting positioning. As a result, both arrows leave CSS grid flow and the content body auto-places into column 1, **35 pixels wide**. This was reproduced in real Chromium at 1440px: expanded panel width 1190px but \`.expanded-body\` width exactly **35px**; after explicitly restoring static grid positioning the content body measured **1118px**. This is why the body became unreadable and demo images apparently disappeared. Keep an automated geometric assertion and regression test.

### Other confirmed fixes

- In the classic board, network status changes formerly rebuilt every grid tile, detaching the focused/clicked node. Network status should update its own status bar.
- A remote comment was already signed, broadcast and persisted but did not display in a nonforeground tab: rendering incorrectly waited on \`requestAnimationFrame\`. Use event/microtask-driven updates rather than throttled rendering.
- The media gateway initially treated an async Helia block stream as a raw byte buffer, returning 503. Properly consume bounded async chunks and verify the block CID digest.
- A stable libp2p key alone is insufficient to stabilize a qualified OrbitDB database: bind its curator identity to a persistent identity. Distinct indices do not equal a globally owned namespace.

## Current experimental infrastructure (not guaranteed or production-grade)

- Branch: \`overhaul/orbitdb-trust-v2\`, draft PR #1; original \`main\` unchanged.
- Static classic: \`https://syburg.my.to/web9000/v2/\`. Alternative dashboard: \`https://syburg.my.to/web9000/v2/dashboard.html\`.
- Voluntary raw test peer: \`wss://syburg.my.to/web9000/ws/\`. Physically separate curator-qualified test index: \`wss://syburg.my.to/web9000/qualified/\` **without any functioning external stake verifier; admissions are default denied**.
- Experimental image peer: \`https://syburg.my.to/web9000/media/\`, independent storage, JPEG/PNG/WebP under 256 KiB (no malicious-content classifier).
- Node data: \`/srv/web9000/data\`; static repo: \`/srv/web9000/source\` on SSH server; Docker service \`web9000-test-peer\`. Never erase persisted identity/index/image files during a deploy.
- Running \`npm audit\` revealed transitive high-severity advisories; host is **experimental** and not audited. Do not call it resistant to spam attacks or safe for hostile production use.

## Protocol/UX status and caveats

**Verified functional prototype:** Ed25519 signed records, web origin-specific IndexedDB, offline outbox, optional WebSocket peer network, Node-to-Node OrbitDB, post/reply/reaction/tag-vote/poll-choice event kinds, image raw-block upload and manual/selected-trust retrieval, native date/time fields, fixed-stake policy model, draft group governance, audit view, import/export tools, browser integration tests.

**Missing or not reliably complete:** Real staking verifier and liquid-dollar valuation, wallet-to-identity binding, on-chain lock duration checks, resilient spam economy and bot detection, strong multi-peers discovery, real election UI and moderation redress/audit signing, cross-browser accessibility, robust upload security, legally operational media review/unpin. Do not describe policy code or mock score provider as equivalent to real staking.

## Rules for subsequent AI development sessions

1. Read this ledger, [PRODUCT-REQUIREMENTS.md](./PRODUCT-REQUIREMENTS.md), \`AGENTS.md\`, \`v2/ARCHITECTURE.md\` and both the original UI assets and current v2 UI **before major changes**.
2. Work on user-visible classic functionality and correctness before inventing new abstract consensus systems; no default dashboard replacement. UI acceptance tests should inspect real screenshots **and element geometry**.
3. Before each response ends, append an entry to this file with all new user requirements, deviations, decisions, implemented tests and **unresolved** limitations. Preserve user expressions and dates, not just a generic summary.
4. New agents may not treat a draft commit as deployed or a passing unit test as proof of a working feature. Verify GitHub Actions **at latest head** and the real site.
5. Keep a draft PR. Do not merge to main, overwrite original UI assets, delete peer data or declare "production-ready" without explicit user authorization.
6. Distinguish **normative product requirement**, **experimental approximation**, **mock test fixture** and **actual production implementation** in both code/docs and user communication.

## 2026-11-18: UI restoration pass, implementation verified

Following the owner's complaint that the demo cards lacked content badges and post interactions and that image/article details rendered in a narrow strip, the following was implemented in distinct development commits:

1. **Root-cause geometric fix:** Reset legacy absolutely positioned .nav-arrow nodes to static CSS grid children. The real desktop layout test now requires the body to occupy at least 70% of the 1190px grid width. The same-tile click toggles the expansion closed, with Escape also working. On large displays the detail uses a width of approximately 1118px, not 35px.
2. **Full-size preview media:** Expanded pictures use a 640px-wide responsive viewer (when available) rather than staying at 128px intrinsic thumbnail width. The Chromium regression waits for image bytes to load and requires a real, large visible image.
3. **Diverse original-style demos:** 24 old prototype thumbnails now correspond to different meaningful examples—meetups, polls, jobs/positions, video, project collaboration, marketplace offers, discussions and normal images. Colored type indicators show the actual kind of post. The subtle PREVIEW label means these illustrative records are not signed or published.
4. **Preview interactions:** Demo posts expose working local preview votes, poll choices, tag votes, flag/report and comments. They are explicitly presented as simulated local-only interactions and cannot be accidentally signed as public records. Real content continues to use signed events for actual interactions.
5. **Configurable mock karma:** core/mock-karma.js provides a local numeric score (0..100) per ed25519 public key. The classic UI has a Test karma dialog to assign/clear values and enable *simulated* default-feed qualification for scores >=10, persisted per browser origin. It labels mock mode visibly. The raw/qualified OrbitDB distinction is unchanged; **no stake is verified, and no qualified peer may accept mock scores**.
6. **Automated end-to-end verification:** Chromium tests cover actual old-style keyboard navigation, post expansion and collapse, wide gallery geometry, visual post-type icons, preview voting and comments, mock score assignments, ordinary composition, signed cross-origin comments/reactions, and independent peer replication. The live test site uses the draft branch; the original main branch remains untouched.

**Latest tested source at this entry:** commit 8a57196a39ea29f37ea53598873b2d87e5dd50e7. [GitHub Actions run #139](https://github.com/ballerburg9005/web9000/actions/runs/44340506143) passed all jobs. This is still an experimental public demo and not a secure staking-enabled social network.

**Next UX priorities requested or still unmet:** multiple real image attachments and proper swipe/gallery UI; inline media/video preview and safety controls; fully functional real-world tag editing, threaded comments/notifications, mixed/blog views and authored presentation preferences; signed, interactive audit of moderator actions and policy forks; responsive accessibility and persistence of local demo test interactions; real volunteer media pinning policy. The mock provider is temporary test scaffolding, not a replacement for a future independently verifiable stake/karma proof.


## 2026-11-18: third UI and discovery correction — direct owner feedback

> "This still looks massively more crude than the UI I already had made, like there are these borders around things for no reason with margins and ugly buttons just listed next to each other with no clear visual distinction."

> "The first comment it is not indented the same as the vertical bar so the bar overflows into it and it just looks ugly."

> "There is also this black gradiant obstructing the image in the grid."

> "Can you put the demo content into some demo space and I can't see navigation for spaces, it doesn't list them, I see no clans to join and no groups to form and the alternative dashboard shows different content presumbably example."

> "Pls load the demo content into the db."

> "The tags also tag clouds dynamic search options that drop down if you click search field like search in new popular trash min karma exclude sound video text-only meetups etc [other flags] exclude additional tags, then advanced search and one can search for only attributes."

**Requirements and corrective plan:**
- The old root stylesheet and v2 classic stylesheet previously leaked selectors into each other. Use a self-contained compact stylesheet that copies useful original design choices rather than layering generic rectangles, excessive margins and dull buttons.
- Remove the large dark gradient covering pictures. Put captions below the media itself; use small bright multitype information ribbons. Differentiate vote strength, downvotes, reporting, tags, comments and tool controls visually.
- Align the threaded-comment vertical guide entirely within its comment padding; it must never slice through the comment text, especially at depth zero.
- Move demonstration content from local DOM-only fixture generation into the actual signed raw OrbitDB database under the separate **demo** namespace. This is a normal public namespace, not claimed by the first signer or by a privileged owner.
- Browse spaces discovered from signed publications, and let visitors follow individual spaces for convenience. No globally registrable namespace names.
- Browse signed clans/guild/group charters; support forming signed groups and submitting actual membership requests. Membership is not granted by mere following or requesting; charter-voter ratification is required. Do not present unimplemented DAO elections as finished governance.
- Search dropdown on focus: New, Popular, Old, Trash (locally suppressed), dynamic tag cloud, include/exclude tags, exclusion filters for sound/video/text-only/meetups/polls/jobs/offers/images, optional minimum mock karma and advanced specific-attribute/custom-field search. No search filtering is universal database deletion.
- Polish **default** classic UI before extending alternate developer dashboard; label dashboard fixture content as a non-canonical experimental view.

**Actual seed and tests:**
- Public demo author key: ed25519:pqstGobWYkSpJhAeYDlPF2CZRFRZh3FOZ2uOvFhgrxg, advertised in v2/demo.json as a voluntary suggestion **only in demo**.
- Private signing key stored under operator data path, not in GitHub or frontend.
- 24 real signed posts published into the independent OrbitDB raw index, confirmed via WebSocket readback; ten original raster files uploaded to IPFS raw blockstore and referenced by CID.
- Separate signed operator seeding added two sample group charters, four signed threaded comments, one reaction, one tag vote and one poll vote; daemon restarted with 33 stored signed events.
- The default viewer does not automatically trust this demo publisher in any other namespace, and the demo publisher has no global write veto.

**Remaining:** Multiple-attachment gallery, proper rich video/audio upload, reviewer election procedures, transparent governance/appeals and independently verified Stake4Karma. The current peer remains unaudited experimental infrastructure.
## 2026-11-18: live usability follow-through and cross-origin validation

- The user's requirement that demo posts actually exist in the database has been met: 24 signed publications are in `/demo`, with real IPFS CID media and additional signed sample replies/reactions/groups. A public WebSocket mirror provides those records; no namespace is privately claimed.
- On the self-hosted example site, a fresh browser now automatically connects to **the website's own same-origin voluntary test peer** while opening `/demo`, so its default page has visible content without special setup. This is a site-specific, explicitly configured exception, NOT automatic dialing of arbitrary third-party gateways. Disconnecting persists an opt-out. Independently hosted WEB9000 frontends retain normal user-selected peer configuration.
- The demo publication signer's comments had been wrongly filtered even on the explicitly selected demo page. Comment visibility now uses the same locally selected trusted-author policy as the posts. A real browser confirmed two signed example comments render in `/demo`.
- The media viewer now handles multi-CID image galleries with compact previous/next navigation, selected attachment count and manual load for untrusted media. The Chromium end-to-end suite confirms switching between two attachments of a signed post.
- The group-formation controls were tested with actual browser signing and OrbitDB publication: a new group charter reached the independent peer and appeared in the creating browser. The UI does not claim automatic membership approval or finished DAO elections.
- The live Chromium two-browser suite exposed a genuine race whereby network repainting could remove the focused comment draft. The frontend now defers grid rebuilds during reply composition and caches the local draft by post/thread ID. The complete signed posting, comments, voting, gallery and signed group-creation integration test passed after the correction.
- Continue UI polish from the original WEB9000 prototype and testing against real browsers. Remaining: avatar/profile UX, vote/tag cloud deeper interactions, governance votes/appeal audit, media safety, proper higher-resolution upload/gallery UX, live staking verification. The alternate developer dashboard is explicitly noncanonical and may still show different local fixtures.