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
- Continue UI polish from the original WEB9000 prototype and testing against real browsers. Remaining: avatar/profile UX, vote/tag cloud deeper interactions, governance votes/appeal audit, media safety, proper higher-resolution upload/gallery UX, live staking verification. The alternate developer dashboard is explicitly noncanonical and may still show different local fixtures.## 2026-11-18: fourth UI pass — threaded discussions, audit reporting and extensible forms

User request: "ok I check later complete more things" — continue making the default original-style imageboard genuinely usable, not redesigning the alternate dashboard.

- **Real nested signed comments**: Replies are nested under their actual parent, rather than displayed in a nearly flat list. The vertical rail is the comment's own left border, separated from its text by padding. Signed nested replies can be collapsed/expanded independently, with bounded rendering for large threads. Their original records are not destroyed.
- **Stable live discussion editing**: Peer updates no longer rebuild the expanded post for every unrelated event and detach a textarea before/during typing. Only signed updates to that thread refresh it. A small Refresh board control handles other feed updates while a discussion remains expanded.
- **Auditable signed reporting**: A compact Report control offers spam, scams, malware, suspected prohibited media and other reports. A user's allegation is a signed label event carrying the author's identity, time, reason and scope. There is no globally authoritative ban or deletion.
- **Local reversible label override**: Audit displays the signed reporter, timestamp, tag and reason, and whether the currently selected reviewer policy considers the label. A viewer can ignore/restore a particular signed allegation locally; the original post and report stay in the independent signed replica. Local policy filters the ignored label ID, not all reports from that user.
- **No raw JSON required for arbitrary attributes**: Ordinary composer includes structured category choices, marketplace price/terms, and a small editor for up to 12 named string fields. Values are published inside the portable signed event and accessible through attribute-specific search. The expanded viewer presents supported key/value fields as normal readable metadata.
- **Tests and safety**: Unit test proves a locally ignored signed report does not remove the alleged content or report from the replica. Real headless Chromium across independent origins tests signed nested replies, comment-rail geometry and collapse, signed spam report and divergent viewer policy, Trash audit and local reversal, and publication/search/presentation of a custom marketplace attribute.

Design requirements remain unchanged. One-sided moderation is a user-chosen view, not a global right to control a namespace. A strict spam default must not hide audit trails or permit flag-bot censorship. Real Stake4Karma proof and governance elections remain incomplete; mock numerical scores are NOT an independent anti-Sybil mechanism. Original main remains unchanged and unmerged.
## 2026-11-18: classic identity portability added and independently tested

The user explicitly wants anyone to run the client from arbitrary static domains and retain their own public-key account without depending on a central company or community administrator. To make this practical in the *default classic frontend* (rather than hiding it only in the experimental dashboard), the following workflow was implemented:

- Compact **Identity** control displays the current public Ed25519 signing identity with a copy action. No third-party login or author/space registrar is necessary.
- **Download encrypted backup** uses the existing, unit-tested AES-256-GCM / PBKDF2-SHA256 password-based identity backup module. It refuses nonexportable legacy keys rather than pretending they are portable. The file contains the public author and ciphertext, not an unencrypted private signing key.
- **Restore encrypted backup** validates the file's size and format, checks the password and cryptographic public-key consistency, asks permission before replacing a different local signing identity, and persists the restored signing key to this site's IndexedDB. Old signed records are neither rewritten nor magically attributed to the new key. This exports **only the signing key**, not the contents of the entire feed or IPFS attachments.
- The dialog warns that JavaScript served by a compromised origin can access keys and that users must choose sites they trust. No claim of perfect client-side safety or immunity from malicious code.
- **Verified browser-level portability**, not just cryptographic unit tests: a real second website exported an encrypted key through the classic dialog, a third independent website origin restored it through the file input, and that third origin used the restored key to sign and replicate a real publication accepted by the independent OrbitDB/Helia peer. The same identity author was preserved without central account registration.
- This preserves the critical user invariant that namespace stewards cannot confiscate accounts or identities. Data availability still depends on voluntary replication, and identity recovery depends on securely keeping the encrypted file and its password.

This is experimental client-side cryptography. There has not been an independent security audit of the website, browser storage or the on-chain Stake4Karma mechanism.## 2026-11-18: fifth UI correction — exact user feedback and implementation

User quotes and normative product intent:

> "the scrolling seems to be off in places, for example I open a post then close it or navigate with arrows, it should use the current grid row as the row that is aligned to the top and also when open the post initially."

> "Use CSS to hide that posts are images/text/video/sound like what is obvious. Also in my UI demo data I had like sound and videos and there was a decent mini-player for them not the default player and it would play thumbnails if hovering them."

> "improve the tag display like the - is outside of the tag that is not right it doesn't have the + green and - red and add tag is not a tag and ... hide more than 20 tags but ... is a tag that disappears when clicked and unhides the rest of tags all loaded."

> "Copy CID hide that with CSS"

> "in blog view a very generous portion of the description/text is shown like to max out the space that it uses and like align vertically top the headline etc. and the info overlay bubbles they are shown not over the image but top-right of the card"

> "mixed view is good with 3 cells used"

> "also good with the spaces shown on top, like they could be personal selections and add a second row user can disable this of group-recommended spaces."

> "Move some stuff in user control center like identity. And also users have personal pages where their karma is shown like a grid view browser like the main page just with their stats on top and personal description or whatever."

> "when commenting the comment that is commented to is scrolled as top of page if post is commented to dirtectly then the ratings bar."

> "this bar it needs highlighting that it was selected and the colors are all over the place too many colors perhaps use CSS box shadows in board theme yellow"

User also rejected the EXAMPLE · SIGNED badge overlapping other metadata, the huge Search/Exclude type checkboxes, and text preview collisions.

Engineering decisions:
1. Opening, arrow navigation, clicking to close, and Escape anchor the selected grid ROW directly beneath the sticky header. Do not scroll to the expanded panel or jump to the top on close. Provide trailing scroll space so the final row can be anchored after collapse.
2. Tags display as single pills with label, weighted count, distinct GREEN + and RED minus inside the pill; display 20, then an ellipsis pill that disappears when clicked while expanding the remaining tags. Add tag is an independent subtle text control, NOT a tag chip.
3. Ordinary media categories are hidden where visually obvious; preserve badges that add information (meetups/polls/roles/offers). EXAMPLE · SIGNED does not obstruct the image; signed provenance remains available in details. Copy CID controls are CSS-hidden in ordinary reading view, with signed-record inspection still available.
4. Original demo video clips use muted on-hover thumbnail playback, progress indicator and a custom player with seek/mute/fullscreen in detail; original sound samples use a compact waveform player with play/seek/time. ONLY the trusted demo signer can reference allowlisted static demo media. The original static MP3/MP4 examples are hosted on the DEMO WEBSITE, NOT claimed as pinned by the IPFS image node. Images in the earlier demo remain CID-addressed. Arbitrary stranger media is not auto-fetched.
5. Blog cards present as much meaningful text as feasible, below a headline aligned to the top. Info badges sit at the top-right of the CARD, not over the picture. The useful three-cell Mixed layout is retained unchanged.
6. Search type exclusions use tiny actual native checkboxes in a responsive compact grid, not giant input fields overlapping labels.
7. Direct comments scroll the selected POST'S REACTION BAR to just below the sticky header; nested replies scroll their parent comment there, both on composer focus and after posting. Preserve drafts across remote peer updates.
8. Selected ++/+/-/-- reactions show a persistent gold/yellow inset glow and correct aria-pressed state, not several clashing colored backgrounds.
9. The first namespace strip is the user's personal followed spaces. The independently hideable second strip displays names recommended by group charters of FOLLOWED groups. Neither recommendations nor a charter claim exclusive ownership of a public space. Group charter composer can suggest names in a signed recommendedSpaces list.
10. My account combines portable encrypted signing identity controls with a signed profile editor. Author links open an author's page rendered with the SAME imageboard grid across their public spaces, with self-signed name, description, website, post/reply count, received vote score and a visibly LOCAL MOCK karma score when enabled. These are signed metadata events, not real-world identity verification.
11. The developer/dashboard interface remains secondary, and the original main branch is still preserved. No one may globally deny publication in any namespace; moderation remains a viewer/peer-chosen, auditable filter.

Testing: Browser suite checks row scrolling, compact search checkboxes, blog text, 20-tag expansion, embedded tag votes, custom media controls, signed group-recommended spaces and optional hide/show, signed profile and author-specific grid. Existing peer integration, cryptographic controls, reports, comments, encrypted identity migration and IPFS image handling remain regression-tested. New signed demo sound and video examples were published into the test index; group and profile example metadata will be published after the running test daemon recognizes the new profile event kind.

Remaining important work: real Stake4Karma proof and adversarial anti-spam economics; genuine non-demo audio/video IPFS uploads and independent pinning; democratic elections, group-presentation ballots and appeals; user/privacy accessibility and broader peer discovery. Mock numbers are NOT independently verified stake. Production deployment is not claimed.
### Actual deployed site integration check for the 2026-11-18 UI revision

A real headless Chromium session on the HTTPS-hosted board (not merely a local mock server) confirmed 26 independently signed demo posts, one functioning custom audio tile, two video hover preview tiles, an active WebSocket test mirror, a third signed group charter named Open Media Circle with volunteered space recommendations, and the signed WEB9000 Demo Publisher profile. The selected group could be followed and its suggestions immediately appeared in the optional second namespace strip. The resulting personal page displayed 26 posts, four signed replies and received signed vote-score 5, with karma explicitly marked NOT VERIFIED. A 390px mobile viewport reported zero horizontal document overflow.

The live test initially exposed that clicking Follow policy updated the group list but neglected to recompute the optional recommended namespace strip. This was fixed by rerendering the recommendation strip on follow/unfollow, not by refreshing the page. The reproducible optional operator test is in v2/network/live-ui-qa.mjs, invoked with npm run test:live-ui. It is deliberately not the core unit-test suite because it depends on independently operated public demo services.## 2026-11-18: sixth UI refinement — further user corrections

Direct user requirements, preserved for future agents:

> "pls no huge grid cells like I have two now that consume 9 cells or such in mixed view new only the text posts can consume more cells it is meant to promote text because image/video si more catchy"

> "sound player should work such that it continues playing when opening post and this is reflected in the post player not two isolated instances"

> "no scrolling to comment upon write, on second thought disable all scrolling for commenting it just says where it was"

> "pressing ++ or + etc should also never scroll page it just scrolled me to bottom"

> "tooltips for the bubbles like this ☏ 1 what is this I need tooltip with more infos"

> "the demo data you pushed it has videos that have images as thumbnails from other posts it makes no sense"

> "no stopping sound when open->closing post"

> "Choose a picture First image · 0 vote(s) Second image · 1 vote(s) Third image · 0 vote(s) this is not recognizable from UI design as a poll with the tabs very weird"

> "and tags go below that vote bar"

> "And there needs to be some reasonable assumptions about mixed galleries. Like all media can be mixed. I think picking video as main or picture for thumbnail and then opening posts the other stuff is like small grid scroll gallery below the post as attachments like sound/images. No the user must be able to pick which content is the primary one, but if he doesn't it is chosen by criteria by the system."

> "And for posting there is a preview screen, and a box to check I understand that information in the system cannot be deleted."

> "With the video player that is not thumbnail don't do the controls just this bar that can be dragged and a play/pause custom transparent slightly black with volume slider in bottom left."

Additional direct follow-ups:

> "make the text one setting bigger like the images they are distracting and for comments also only what people actually wrote ... perhaps you can also dim the content grid like 30% black if there is text-only post but not sure if that obstructs usage"

> "and perhaps more top/bottom padding for the text so it pops more, like text posts have more value in the presentation ... in actuality it is a content platform and to promote important discussions and ideas, like the ideamarket thing where you can describe ideas like crowdsourcer and then attract people to fill roles like activism etc. political group organization"

> "oh another thing when closing a post and the scroll was such that more than the top row was shown then don't reset the scroll only when less than top row was shown"

> "look, the image/media goes on top then this [title, author, signed provenance, ratings, tags]"

> "and remove close"

Implemented in the development branch:

1. Mixed grid: only text-first discussion/idea posts WITHOUT images/audio/video get the wide three-column treatment. Image and media posts stay compact, even when their preview is unavailable. Text is one step larger with generous vertical padding and a subtle gold-accented reading surface, without dimming the entire imageboard. Idea posts may include positions/roles.
2. Audio: one shared page-wide audio engine provides sound for compact and expanded mini-player controls. Opening, closing or rerendering a post does not stop or restart playback. Tile and article seek/play state are synchronized.
3. Scroll behavior: commenting and reacting do not explicitly scroll the document. The click-to-close action preserves scroll when most of the selected row remains visible; if the row is clipped, it aligns the row under the sticky header. Opening and keyboard navigation continue to align the selected row.
4. Bubble tooltips describe meaningful attributes, including the direct signed-comment count behind ☏ N. Never use unexplained debug overlays.
5. Demo video previews use the video asset's own muted first frame and hover animation, never a photo CID belonging to another example. The expanded player has minimal translucent play/pause, seek and volume controls.
6. Polls have a recognizable question header, separate choices, latest signed vote counts, percentages and selected-state feedback. Tag pills go BELOW the reaction/report/audit bar.
7. Ordinary composer has a preview before publication and an explicit unchecked permanence acknowledgment. Publication requires consent. Uploads occur only after confirmation. A selected primary image index is signed and honored by gallery and thumbnail; absent selection, first image is the fallback.
8. Expanded post ordering was explicitly corrected again: primary media first, then headline, metadata, reaction/report/audit bar, tags, written body, structured data and signed comments. No visible Close button; the selected tile or Escape closes the post. The UI regression asserts this DOM order and absence of the button.
9. Real nested comments continue to update without losing a draft; successful submission clears focus without scrolling, so newly published replies can become visible.

Still incomplete, and must not be misrepresented: generic mixed audio/video/image attachment upload and arbitrary primary media types, safe media pinning and scanning, reversible publication/retraction policy, finished Ideamarket-style organization governance, and independently verified real Stake4Karma. The current composer supports a preferred PRIMARY IMAGE among up to three small image uploads; the demo audio/video assets are website-hosted, not pinned by the image-only IPFS peer. The permanence notice correctly says deletion from independent replicas cannot be guaranteed, not that revision requests will never be possible.

TEST: 54 protocol/unit tests and the full real Chromium integration suite are mandatory before pushing; the integration test includes preview consent, selected-row close, media-first details, audio continuity, signed nested comments, audits, group charter creation, gallery and portable identity across three origins.## 2026-11-18: append-only corrections and voluntary withdrawal workflow

Product motivation: User previously requested post preview and an acknowledgement that material replicated by independent peers cannot reliably be deleted. User also explicitly wanted room for *future revisions and deletion requests*, while preserving the fundamental no-global-authority rule. This implementation advances that request without making false deletion guarantees.

### Protocol / signed-data invariants

1. The original signed post is NEVER rewritten. Corrections are ordinary new independently signed post events containing a structured fields.revises reference to the immutable original event ID. Their full bodies (text, title, attributes, CIDs) are independently retained and verifiable.
2. A correction can supersede a root for display only when BOTH the Ed25519 signing key and public space match the original. A stranger can create any post in any namespace, even one claiming to revise another post, but cannot rewrite the other author's identity, root, comments, ratings, or label history. A missing-root or unauthorized alleged correction remains a separate attributable signed publication.
3. Revision timelines are projected locally by v2/core/lifecycle.js from the signed event set; projection does not mutate Replica, OrbitDB, IPFS or another peer. Direct root references are handled deterministically by signed timestamps and event-ID ordering. The root event ID remains the stable permalink/thread/reaction target.
4. An author can issue signed retraction events addressed to the root with action=withdraw or action=restore and optional explanation. They are *statements of author intent*, not permissions to delete bytes or compel peers to erase text. Only the ORIGINAL signing key in the same namespace can change the locally projected withdrawal state. Every withdrawal and restoration remains independently signed in the timeline.
5. Default local policy respects a signed withdrawal by suppressing that root from ordinary feeds but retaining it in Trash for inspection. A reader may explicitly uncheck the advanced-search 'Hide author-withdrawn posts' preference: locally showing a withdrawn post never changes anyone else's rule. Independent mirrors still choose whether to retain bytes, for legal/safety reasons.
6. Signed history is readable inside a normal expanded post: original title, written contents, published time, associated tags and later corrected versions, plus the reasons for withdrawal/restoration. JSON/source export remains optional technical inspection; author-facing corrections use the existing regular post editor, preview and explicit permanence acknowledgement.
7. The composer preloads the last signed version and preserves existing CIDs when no replacement media are chosen. New images deliberately replace the attachment set in the correction, and the UI explicitly warns that prior copies may remain on peers. Public-space identity stays immutable across corrections. Authors alone see the correction and withdrawal actions.
8. Public personal pages count ROOT POSTS and show correction and withdrawal counters separately, rather than inflating original post counts by adding corrections as separate publications.

### Security / unfinished design work

- This is an initial *reader-side projection policy*, not network-wide censorship, eviction, a cryptographic deletion mechanism, or a promise of GDPR-style universal removal. No upstream remote block deletion, pin-manager automation, retention expiry, or legal adjudication is implemented here.
- Another party cannot impersonate authors, but multiple legitimate same-key corrections still need production rate limits, moderation/economic policy and conflict UX. Clock skew/future-dated events and inherited trust must be considered before relying on this for high-stakes governance.
- Account/key rotation continuity is not automatically established by this correction protocol; private-key ownership remains necessary. Signing-key portability exists through encrypted backups.
- True multimodal IPFS attachments, primary video/audio selection, independent media policy, DAO/representative elections and real Stake4Karma anti-Sybil verification remain separate future milestones.
- Backward compatibility: old posts lacking corrections still display exactly as before. A peer with only partial event history can still display individually signed records; projection updates when the root and later signed events become available.

### Test evidence

Core tests check immutable preservation, same-key corrections, unauthorized cross-key revision/withdrawal resistance, restore history and invalid envelope rejection. The independent-browser regression test publishes a correction from an imported portable key, verifies the unchanged original grid ID and corrected article text, then sends signed author withdrawal and restore requests. Tests confirm the original, correction and withdrawal all remain available on the peer, the per-reader advanced preference can override withdrawal, and history includes human-readable original text. Existing cryptographic, governance, gallery, comments, and anti-spam policy tests continue to run.
### Independent cross-site verification (additional regression)

Beyond a single author-controlled UI, the Chromium integration suite now verifies that another static-origin browser connected to the same voluntary peer sees the author's corrected title under the SAME original post ID; the other browser's default local policy then hides that post on signed withdrawal and restores visibility after the author's separately signed restoration. This tests peer propagation and voluntary interpretation from TWO clients in addition to the signed version-history and immutable-record checks. The ordinary test never modifies the public hosted demonstration data.## 2026-11-18: mixed image/audio/video IPFS publication and gallery

This milestone implements the user's earlier explicit request that mixed media (pictures, sound and video in one post) be supported, the author can choose a primary thumbnail or the system derives a sensible fallback, and the remaining attachments appear in a horizontally navigable gallery. The original imageboard/Mixed text promotion and keyboard navigation must not regress.

### Current implementation

1. An individual signed post still carries only a stable ordered array of IPFS CID strings in body.media, never inline binary or arbitrary URLs. The new optional, signed body.fields.mediaTypes is a parallel list of whitelisted MIME types. body.fields.primaryMediaIndex chooses an attachment for the grid and initial expanded view. Existing posts without mediaTypes remain compatible with image-only interpretation.
2. If no primary is deliberately selected, the browser chooses first image; if none, first video; if no visual, first sound. The author can override this choice with a radio control in the *prepublication preview*, including selecting a video rather than an image. Structured media metadata is signed and validated. Image/video/audio can coexist in any order up to six local uploads (signed protocol supports up to twelve references for non-browser clients).
3. Classic image grid: trusted primary video is a muted on-hover preview; primary audio is the existing page-global persistent mini-player; primary image remains a picture. All stay SMALL grid cells. In Mixed mode, only actual text-first idea/discussion without attachments gains a wide preview. Readers do not automatically fetch binaries from unknown signing keys.
4. The expanded post's mixed-media gallery presents the selected primary media first, then compact horizontally scrollable attachment chips. A picture displays as a picture, a video uses the minimal translucent custom play/seek/volume player, and a sound uses the existing shared audio engine. Swapping attachments does not destroy the global sound playback. Untested/untrusted authors show one Load this attachment button per selected CID rather than auto-downloading it.
5. The normal composer accepts JPEG/PNG/WebP (256 KiB each), MP3/Ogg/WAV (8 MiB each) and MP4/WebM (12 MiB each), maximum six files. All undergo the same human-readable preview and explicit permanence acknowledgment BEFORE any media is uploaded or any signed post is published. User-facing errors identify if the chosen peer refuses an upload.
6. The optional operator-controlled media node stores pre-existing small raster raw-codec IPFS blocks exactly as before, and stores larger audio/video as chunked UnixFS files using @helia/unixfs. It serves byte ranges (HTTP 206, Accept-Ranges, Content-Range), necessary for seeking through videos. Verified output checks MIME magic and a stored SHA-256 digest before serving; storage is content-addressed. Manifest survives read-only restart and points to the local peer's own Helia blockstore.
7. **Two distinct operator opt-ins:** WEB9000_MEDIA_UPLOAD=1 permits existing small image uploads; WEB9000_MEDIA_RICH_UPLOAD=1 also permits audio/video uploads. The second switch defaults OFF and is deliberately not automatically activated on the existing public test peer: no legal/abuse-scanning media approval system exists. Storage is bounded by a default total 64 MiB, 12 raster uploads or 2 rich uploads per remote socket address per UTC day; large upload caps are per file. This is a test policy, not a production spam resistance or trusted stake validator. Any public IP-based throttling behind a shared reverse proxy may group clients conservatively. It does not provide Sybil resistance, cross-peer deletion or durable quotas across process restarts.
8. No authority arises from hosting, pinning or namespace naming. Each peer voluntarily chooses whether to store raw text metadata versus dangerous binary media. The media node is NOT a global takedown mechanism, mass scanner, or permissioned registry. Signed post refs may exist without any willing peer hosting binary files; UI must handle unavailable media and explicit load refusal.

### Verification

- New pure core tests check image-first and video-first primary selections, media category classification, MIME ordering and invalid metadata rejection.
- Media-node integration test starts an actual isolated Helia/libp2p/LevelDB node, confirms that audio/video upload requires separate opt-in, uploads real MP3 plus MP4 data beyond a single IPFS raw block, retrieves the exact bytes from UnixFS, verifies video seeking with HTTP 206 range and 416 invalid ranges, checks two-rich-uploads/day guard and read-only restart with preserved blocks.
- Full Chromium multi-browser test on two independent HTTP origins uses real local File objects of JPEG, MP3 and MP4 selected via the ordinary composer. The author chooses MP4 as primary at preview, signs and publishes the resulting three CID refs, sees a video tile and all three custom viewer types, and the independent second browser receives the signed media metadata. A *different signing identity* can see the signed post only after opting into unknown authors, and must click Load this attachment to fetch untrusted video. Existing 58+ cryptographic/UI/governance lifecycle regressions remain covered.

### Unfinished production work

- Proper media screening and legal operator processes, media policy appeals, opt-in pin management/quarantine, robust multi-peer media retrieval/failover, efficient streaming without full-file pre-verification on each request, thumbnails for arbitrary video files, transcoding, resumable uploads, independently staked spam barriers and true decentralized browser P2P (rather than an operator-selected bridge). Do not imply these are implemented.
- Binary media is not synchronously copied by OrbitDB text replication; the signed CID remains portable, but availability is not promised. New media formats are opt-in under the operator's risk assessment.

## 2026-11-18: explicit public media enablement and binary MiB limits

User's latest instructions:

> "enable audio/video but no more than 10MB and please continue"

Then corrected units:

> "pls use mibibibbies not decimal MB"

This later correction supersedes prior 8 MiB audio / 12 MiB video limits: both audio and video MUST be capped at **10 MiB = 10,485,760 bytes per individual file**. Images retain the 256 KiB limit. Server and browser limits, any Nginx proxy request-size cap, user-facing validation, health fields and documentation must use the same units. Do not silently switch back to decimal MB.

The user explicitly authorized enabling public audio/video uploads on the existing self-operated peer. The operator-side gate WEB9000_MEDIA_RICH_UPLOAD=1 must be set on the runtime container, not just written in source. Any operational claim must be verified against the HTTPS media peer's /health endpoint after deployment. The independently hosted browser's existing media selection, preview, permissionless signed events and IPFS CID semantics remain unchanged. Do not enable global binary replication or grant hosting operators ownership of public namespaces.

Operational hardening added in the same pass: upload counts are saved in a peer-local per-day quota file rather than reset on each restart; the persisted keys are SHA-256 digests of day/client/type instead of plaintext visitor IPs. The media peer trusts a reverse-proxy X-Real-IP only when the direct TCP peer is its explicitly configured trusted Nginx/Docker bridge address. Nginx sanitizes and overwrites that header, independently meters only POST uploads, and retains normal GET/HEAD/HTTP 206 playback without applying upload rate limits. The media pool is set to 256 MiB for the public trial; storage policy, remote pins and access policies remain strictly local to each operator. Note IP quotas are a temporary abuse brake, not real Stake4Karma proof, user authentication, a guarantee of lawful binary storage or a deletion power. Legal-media handling and responsive abuse reports remain outstanding.

## 2026-11-18: clarification — separate metadata and voluntary media-mirror networks

Direct user clarification:

> "but you understand that media files are mirrored by specialized IPFS nodes/clients and by default the web client only mirrors text and meta info, i.e. the rest, unless perhaps user opts in to mirror everything"

This distinction is **normative**, not an implementation detail:

- Browser participation defaults to synchronization of **signed events, textual posts, comments, tags, scores, moderation/governance records and media metadata/CIDs** within the user's selected indexes/scopes. Merely receiving a post must NOT force persistent IPFS pinning or binary-media replication.
- A **specialized IPFS node or an explicitly consenting client** volunteers disk space and bandwidth for image/audio/video/archives. The initial uploader is just one possible media mirror, NOT the canonical permanent owner. Peers can independently obtain/pin identical CIDs from other willing peers. Lack of the original gateway must not invalidate a signed record.
- Distinguish **(a) viewing/temporary download, (b) web-browser HTTP caching, (c) deliberate persistent storage and re-serving/pinning**. Ordinary web browsing should not be represented as volunteering to redistribute binary data. Actual browser cache behavior is platform-dependent; never promise that viewing causes zero temporary storage.
- Opt-in "mirror everything" is a **future feature** requiring clear storage, bandwidth, scope, moderation/safety and legal controls. Never enable it by default or imply that it is already implemented. "Everything" should be bounded by operator/client choices, not a mandatory indiscriminate download of unsafe material.
- The current independent media peer already persists uploads by CID; the browser currently retrieves media from one selected HTTP gateway, and multi-mirror CID discovery/failover, native libp2p IPFS-to-IPFS pin acquisition and browser-hosted mirroring are **not yet implemented**. Do not conflate available CID-addressed storage with full specialized multi-node media replication.

Operator-local serving quarantine work (experimental) adds a *revocable* file-based refusal to deliver a CID from that specific HTTP peer, without changing the signed post or any other media node. This is not a universal deletion, does not guarantee physical blockstore garbage collection, and is not content screening. More capable opt-in media mirrors must be developed separately.

## 2026-11-18: implementation pass — signed media-provider discovery and opt-in fallback

The user authorized continuing WEB9000 development after specifically confirming that ordinary browsers mirror signed text/metadata and specialized volunteer IPFS clients/nodes mirror binaries, with voluntary user opt-in to more storage. This pass preserves that distinction.

- A new `media-provider` signed event provides ephemeral, independently verifiable claims for specific media CIDs and a gateway URL (offer/withdraw, 32 CIDs maximum, 7-day maximum signed TTL). *Claims do not prove availability or grant authority; even a trusted claim cannot make a browser contact a new host by itself.*
- The browser's peer dialog can list received signed provider claims, lets the user explicitly add manually approved backup gateways, and attempts approved backups for media after source failures. No accidental automatic binary replication or unreviewed-author media fetch is introduced.
- A lightweight `GET /have/<CID>` from an individually operated media peer reports local inventory without downloading binary data; quarantined CIDs are not advertised.
- An optional operator JWK signing/publishing CLI allows standalone peer operators to announce availability through any willing WebSocket bridge; its private key belongs to that operator.
- Tests include anti-forgery/invalid event checks, CID-specific claim expiry/withdrawal, zero-contact policy for unapproved hosts, real Node bridge publication and full Chromium browser failover. Existing 10 MiB audio/video cap, separate media-operator quotas and experimental raw vs qualified indexes remain unchanged.

**Important outstanding defects and scope:** Browser media bytes from a potentially malicious gateway are not independently checked against UnixFS CID, and an accepted provider claim is not proof of retrievability. Native IPFS multi-provider routing, browser pinning with explicit storage/bandwidth budgets, broader peer-discovery redundancy, rate/abuse review and a complete legal-media screening process remain unfinished. Do not claim automatic global media replication.

## 2026-11-18: user clarification — offline members, high-karma influence, decision deadlines

User's follow-up, after asking whether group information requires multisignature validation:

> "I mean with multi-signature a major issue could be that it requires too many account to be online in a given time, or that accounts don't go stale/defunct so this could become a massive issue that affects mainly low karma low activity accounts, so the idea was that high karma accounts play a bigger role in group decisions like more voting power since the karma acts as a credibility score it needs to be this way in some shape or form but democratic equality is also important so not sure how to fine-tune this"

> "we should also factor in timeouts of decisions, like for most things there is only votes for and votes against and not waiting indefinitely for inactive users it settles by participating people but this must not be so tight that it is exploitable such that small groups can hostile overtaken just because they didn't check in and such"

These are *product requirements*, not a desire for a single fixed percentage of all accounts on every vote. Independent Ed25519 signatures are asynchronous, but indefinite voter denominator and inactivity can stall governance. The user wants ordinary decisions settled with For/Against ballots and a **predeclared deadline**, with an anti-hostile-takeover floor and a meaningful **credibility/karma influence that remains subordinate to democratic legitimacy**.

**Implemented this pass:** versioned `timed-v1` signed group decision policy, with 7-day timeboxed *nonbinding advisory* motions (minimum approximately one-third voter turnout, at least two for multiperson groups, majority of participating signers), 7-day group-information amendments (absolute democratic signer threshold), 14-day constitutional/membership/moderation amendments (absolute two-thirds eligible signer threshold subject to any stronger charter quorum), portable independently verifiable signed history proofs, member ballots/proposal UI, and explicit fork selection. Existing legacy charters remain unchanged unless independently ratified. Stale accounts **are not** implicitly removed. Inadequate turnout is an unapproved outcome, never a yes by omission. Retain a high threshold for binding governance to avoid takeover, even if this means defunct groups must openly fork or reconstitute. The precise details are documented in [GROUP-GOVERNANCE.md](./GROUP-GOVERNANCE.md).

**Not implemented / design pending:** second capped credibility-weighted tally requiring verifiable frozen score snapshots; actual on-chain stake and earned-karma validators; delegated voting terms; formal dormant-member handling with notice and appeals; independent signed time witnesses/checkpoints. No mock/supplied karma may confer voting power or automatically change group authority. Signed `time` is self-asserted by the signer, so deadline tally across disconnected replicas lacks true cryptographic global finality; do not pretend otherwise.

## 2026-11-19: proposal initiation, earned group legitimacy, nested groups, friend/foe and debug console

**User decisions in this chat** (preserve distinctions and avoid guessing thresholds):

> "I think karma should mainly be necessary to start votes in the first place, paired with a certain length of approved membership (not subscribed membership) that is gained by group members not anti-karma the subscriber/member and giving them karma. So this makes members approved in the end or with an approval vote that is shown below posts. This should be configurable in the group charter or such a thing that can be voted on. Sounds like something that needs tons of fine-tuning later and it is not a binary things lots of thresholds to take into consideration that factor in the group size and group activity."

> "And also the whole mechanism it should work for hierarchies i.e. nested groups - somehow. And those nested groups it is like they can share rulesets and law enforcement moderation sort of authorities that specialize on flagging and screening - somehow later..."

> "oh also make a debug console where all the stuff from the decentralized tech can be seen raw and various filters"

> "and 'trust author' this is replaced by 'add friend' and the same way there is 'add foe' and it influences credibility in a way to be determined later."

> "Copy signed record get rid of this we have debug console and then just a button dump post dump comments and people can check it there"

**Principle:** Karma should first restrict the *right to originate group votes or binding proposals* alongside a minimum tenure of **approved group membership**. Approval is NOT subscription, not merely participating in a public namespace, and not a unilateral nomination by a leader. Members can confer positive/negative signals (anti-karma); an explicit approval vote displayed beneath relevant posts is a candidate UI. The actual rule must be configurable in signed founding charters and subsequently amended by the existing verified quorum process; weights and thresholds need careful scaling for group size and recent activity. In ordinary voting, preserve the individual's democratic vote, avoid making high karma an overriding veto, and retain the anti-capture protections for major group decisions. A credible proposal requires independent karma validation at a frozen checkpoint; **local mock scores or client-provided numbers are not proof**. Current implementation still allows existing eligible members to propose and vote under the charter: no enforced karma-based proposer gate is live.

**Hierarchy plan:** Nested groups should have signed charters and their own member/proposer requirements, optionally share inheritable *rulesets* and delegate narrow, revocable moderation/flagging/screening specialties to named child groups. Every delegation needs scope, responsibility, validity/expiry, appeal path, provenance, maximum depth, cycle detection and independent local opt-in. No child becomes a mandatory namespace ruler. The existing `delegate` and `undelegate` types and local reviewer policy inheritance are a starting point, not the full specialized enforcement system. Avoid unreviewable central flag-list censorship.

**Implemented UI/debug this pass:** A compact raw debug dialog displays already locally replicated signed events and bounded real WebSocket packet traces (hello/index metadata, subscribe/sync, batches, publication, acknowledgments and failures). Filters for kind, namespace, author and text plus raw JSON, copy, download and status counts. Expanded posts have **Dump post** (including signed version/withdrawal history and related votes/labels) and **Dump comments** (nested signed comments and reactions), both opening the console instead of copying records; signed history has an inspect action. **Add friend** / **Add foe** labels are mutually exclusive, removable and saved only in this local browser at first; they are NOT silently broadcast or used as verified credibility, group voting power, anti-karma, global blocking, or media-fetch authorization. Users may alter those meanings in a later, explicitly ratified policy. The legacy user-controlled trust data is retained separately for compatibility and does not originate from the new friend action. Debug console must never expose local signing secrets. Tests include the raw wire callback, social changes, root/nested reply dump, filters and Chromium UI behavior.

**Still undecided:** karma measurement, anti-karma aggregation/appeal, group-size/activity weighting, member approval age and expiry, fake membership attacks, historical snapshot finality, multi-parent hierarchy and jurisdiction-dependent screening. Preserve these uncertainties in future work rather than hard-code numbers or quietly equate friend with public trust.

## 2026-11-19: backend-audit and Nostr research request — owner emphasizes **DO NOT assume approval**

Latest owner prompt:

> "those unresolved things and unimplemented things put that in a file for fast overview and also I didn't see that you changed AGENTS.md for new instance it needs to know everything when this session is full."

> "also check if anything you did in backend sort of cut corners or did things differently than my vision of the software or what I said and not explicitly approved because I only skim over what you write and not even all the time and clarify where conflicting design could be"

> "ok I go to sleep soon, one important thing is you could research tech like this board esp. Nostr and check if they have like advanced methodology compatible with web9000 design goals and constraints and if we could steal from that and insights where things could go sideways for us in future and how overcome"

**Decision and agent rule:** The owner reads only some status reports. **Silence or a skimmed status update is not approval of architectural defaults.** Every agent must actively audit its own shortcuts and make mismatches and open tradeoffs discoverable across conversations. Put a brief quick overview in [STATUS.md](./STATUS.md), detailed prioritized backlog in [OPEN-ISSUES.md](./OPEN-ISSUES.md), code-based findings and explicitly *unapproved* prototype choices in [BACKEND-AUDIT.md](./BACKEND-AUDIT.md), Nostr primary-source research in [NOSTR-RESEARCH.md](./NOSTR-RESEARCH.md), and a robust mandatory read order in the repo-root [AGENTS.md](../AGENTS.md). Do not make the owner replay chat history or ask them to approve every tentative number before doing risk-reducing work.

**Code review finding fixed in this pass:** Previously merely loading site `peers.json` suggestions (even at bootstrap) set persistent active `state.mediaBase`; this contradicted the reader's explicitly approved media-provider policy. Suggestions now prefill the form but **do not authorize fetching IPFS bytes** until a deliberate Connect action. Added a two-origin Chromium assertion that a populated suggested URL does **not** appear as approved in the Debug system status. Core and browser tests are required before claiming a deployed fix.

**Important correction to preliminary inspection:** A purported `set-quorum {numerator:0,denominator:0}` input is already rejected by `validatePayload` because its numerator must be >=1. Attempted signing reproduced that rejection. Do not describe this as an exploit; preserve the audit standard of tested vs hypothetical.

**Other audit concerns not yet fixed:** raw OrbitDB `write:['*']` log append budget/validation, unscoped `['*']` browser metadata replication, missing on-chain qualified stake verifier, whether quarantined Helia blocks may still be served by P2P, no browser UnixFS integrity check, untrusted self-declared vote timestamps, direct browser-origin custody of extractable keys, incomplete specialist/nested-group moderation, unapproved `timed-v1` numerical defaults and owner-preferring site presentation. Clearly distinguish confirmed code behavior from suspected vulnerabilities and unapproved design proposals. See audit for location, consequence and test plan.

**Nostr takeaway:** NIP-65 author relay hints, NIP-77 Negentropy anti-entropy, NIP-32 labels, NIP-56 reports, NIP-46 isolated signing, NIP-42/98 signed auth, NIP-b7 Blossom media integrity and NIP-66 independent liveness observation have useful ideas. NIP-29's relay-admin group model (even with migration and forking) is **not** WEB9000's public namespace/governance model; the user rejected first-claim relay/autocrat capture. Nostr signatures/secp256k1 are not binary compatible with WEB9000 Ed25519 event-v1, so any bridge needs explicit translation/dual signing and provenance.

**Migration follow-up:** Because earlier `classic-media-url` storage conflated the initial unapproved `peers.json` hint with a manually approved gateway, the new `classic-media-approved-v1` marker prevents implicit grandfathering. Legacy stored URLs become inactive **pending review** until the reader clicks Connect again. Pending URL is saved separately across page reload and unrelated preference updates, so the reader does not lose its address. Verified by adding a Chromium migration regression. Note the deliberate cost: some readers who had voluntarily selected a gateway in an earlier build must reapprove it once. This is more defensible than silently auto-fetching third-party bytes.

## 2026-11-19: owner explicitly selects `main` for WEB9000; continue development

Owner instructed **"ok thanks continue I review tomorrow"**, then clarified **"also make everything main"**. This overrides prior agents' draft-PR instruction *not* to merge without explicit approval. The existing overhaul branch's full descendant history was fast-forwarded to GitHub `main` (ancestor of it was original `main`); all 87 v2 additions/updated docs and original root site remain intact, without history rewriting. PR #1 is marked merged. Subsequent implementation must commit and test **`main`**, with ordinary optimistic head checks and no forced updates.

Additional development: adversarial OrbitDB test demonstrated the old raw index physically accepts a directly appended invalid envelope, even though the application refuses it. Added a separately registered `web9000-signed-v1` access controller for *NEW*, opt-in raw indexes: verifies v1 signature, strict fixed 48 KiB limit and all-author/no-space-ACL validity at native OrbitDB append and replicate boundary. CI must verify an independent two-peer test of both the legacy exposure and signed-mode rejection. The live existing OrbitDB address **MUST NOT** be quietly swapped or reset. An explicit data migration, coexistence policy and operator controls remain outstanding. This does not prove complete IPFS/gossipsub DoS resistance.

**Operational guard added:** `v2/network/raw-index-selection.mjs` binds a *new* signed-index peer directory to the signed mode and exact index identity. Reusing a legacy data directory to toggle `WEB9000_RAW_SIGNED_INDEX=1` fails early instead of creating a seemingly empty peer/index. A signed-mode directory cannot be silently downgraded at restart. Pure filesystem tests plus two independent Helia/OrbitDB direct-writer tests cover this. The legacy live peer retains its existing directory, identity and OrbitDB address.


### 2026-11-19: continued work on safe signed-index migration

Owner requested continued WEB9000 development on `main`. A local offline migration pipeline was added, not a mandatory transition: `migrate-verified-events.mjs` audits the source physical legacy OrbitDB log, verifies WEB9000 event signatures, detects invalid, duplicate and oversize records, sorts valid immutable event IDs, computes a deterministic local snapshot fingerprint and independently checks copied signatures and ID sets. `migrate-raw-index.mjs` defaults to dry run, requires a source fingerprint explicitly supplied back by the operator before writing to a fresh protected signed-index directory, refuses changed source or overlapping/symlinked directories, and supports resuming partial copies without duplicates. Operators must stop the source or use a consistent offline copy; there is **no automatic migration/cutover** of the live original peer, no forced replication, no global completeness proof and no attempt to rewrite old authors' signed envelopes. Added multi-peer migration and full CLI restart/resume tests. Documented in [RAW-INDEX-MIGRATION.md](./RAW-INDEX-MIGRATION.md).


### 2026-11-19: continue — IPFS block-serving quarantine audit and fix

Owner simply requested continued WEB9000 work on `main`. The audit demonstrated that Helia's Bitswap serving ledger calls the blockstore `get` for incoming P2P want-block requests, **outside the HTTP `/ipfs` quarantine**. A new `media-bitswap-policy.mjs` wraps the Bitswap-only serving broker for media-enabled independent peers. It dynamically enumerates the operator-retained media CID manifest, maps every UnixFS DAG root to its descendant blocks (including raw chunks), and checks revocable CID quarantine at each outbound media block request. Unknown/unmanifested raw/DAG-PB chunks and invalid policy fail closed; shared chunks are withheld when any associated manifest root is blocked. Local storage, independent HTTP gateway, signed metadata, arbitrary namespace write eligibility and other peers' rights remain unchanged. A real second Helia/libp2p peer test verified actual raw image and UnixFS child retrieval **before** quarantine, P2P refusal **after** local quarantine, independent signed OrbitDB metadata delivery while quarantine was active, denial of an unmanifested raw orphan, malformed policy denial and operator-local reversal. The remaining risks are **other exchange protocols, preexisting downstream copies, in-flight P2P transfers, provider adverts, safe GC and operator ingest/DoS**; do not call this universally safe or network-wide censorship. CI updated with the P2P regression.


### 2026-11-19: continue — reader-selected namespace metadata synchronization

Owner prompted **"ok thanks continue"** after IPFS Bitswap hardening. Implemented reader-opted, persisted **public namespace synchronization scopes** in classic Join Network. Existing accounts default to `*` for backwards compatibility; the reader can enter one namespace per line, including names containing comma or semicolon, and voluntarily choose different scopes when connecting to independent peers. This is transport/storage interest, **not namespace authority, display follows or group membership**. A chosen peer sees the names of subscribed namespaces; a malicious peer can transmit unsolicited records on the wire, but browser-side verification refuses to *ingest* signed events outside the authorized scope. Old local signed records survive later scope changes; original signed publications may still be made to *any* namespace regardless of subscription. Added explicit parser/malicious-bridge checks, two independent Helia/OrbitDB peer checks, and four website origins proving persistence, historical group sync and scope changes. **Unfinished:** server-side indexed queries, missing-event/set reconciliation, signed checkpoints, efficient anti-entropy, independent discoverability, private subscription privacy and global completeness evidence. No change to the live demo peer default feed.


## 2026-11-19: owner correction — NO inline debugging, console in top-right; image previews blocked

Latest owner messages:

> "Dump post
> Dump comments
>
> this is shown inline but I want zero debug info inline I want a console that pops up from pressing debug in the top-right page menu bar. And there you have buttons and stuff and it shows live traffic and traffic that has already occured."

> "also right now it shows like this: IPFS media · open to choose what to load ... only the video previews work and sound but the images don't load"

> "No independent IPFS media gateway configured. The signed CID can be copied to another gateway.
>
> this is what it shows if I click manual"

**Implemented direction:** Top-right HEADER Debug opens a modal. Remove `Dump post`, `Dump comments`, old raw signed-record copy and ID inspector buttons from post details and revision history; keep nondebug moderation/audit human-reading UI. The modal itself now provides post picker and Dump post/Dump comments buttons, filtered real signed records, live WebSocket trace with already recorded traffic, bounded per-tab saved packets through reload, pause/refresh and explicit copy/download. Do NOT claim historic packets from before the browser was ever running or remote libp2p packet captures.

**Media failure root cause and repair:** earlier approved-gateway migration rightly stopped blindly accepting `peers.json` suggestions as active media hosts, but it produced an unusable manual-load path when the user hadn't approved the media host. UI now displays a clearly labeled **Enable images · HOST** action and manual **Load image from HOST** action; clicking either explicitly approves the proposed host and stores consent, allowing signed demo image CID preview to load without overriding the opt-in rule for unfamiliar authors. Keep offscreen thumbnail lazy loading and forbid automatic third-party media hosts or browser pinning.


## 2026-11-19 owner correction — hosted images MUST load without a click

The user immediately rejected the fresh **`Images off · enable media gateway above`** placeholder:

> "Images off · enable media gateway above
>
> why is it off pls make it work again without user doing things"

The previous change correctly prevented silent connections to arbitrary newly advertised *third-party* gateways, but its explicit-approval requirement for the same site's own WEB9000 media gateway contradicted the original imageboard experience. **New rule:** `v2/demo.json` on the current website can declare `galleryPeer` alongside `autoConnectSameOrigin:true`; only if that URL has the **exact same scheme, host AND port** as `location.origin` may the browser use it to load IPFS CID image/video/audio previews without asking. No new WebSocket authority, additional mirror or file pinning. All signed public image tiles should display automatically from this first-party endpoint, not only locally trusted authors. Unapproved external gateway suggestions, malicious cross-origin `galleryPeer` values, `media-provider` claims and secondary mirrors never become first-party. Keep a true manual gateway override for external sites, and never pretend auto site default is a user's consent in IndexedDB.

Both static HTML entry points share `classic.js`, so this fixes the production demo without changing signatures or CID content. Tests: sixth independent website origin with same-origin CID gateway (also adversarial external configuration), hosted Chromium clean browser loads image immediately and after reload, no click; browser core and full integration.


## 2026-11-19: owner requested continuing on `main` — incremental indexed metadata history

User requested **"please continue"** after the top-right Debug and automatically displayed first-party IPFS images were fixed and pushed on `main`. Implemented the next documented non-controversial backend task: the WebSocket bridge previously called `Replica.list().filter().sort()` on **every 32-record history page**, including narrow namespace requests. Added `v2/network/scoped-event-catalog.mjs` to index signed event IDs by public namespace and wildcard, seeded once from independently verified `Replica` records and incrementally maintained after valid inserts, without any author or space ACL. A subscription now freezes an **unsigned local observation sequence number** for its history pages; new events are also sent as live WebSocket frames and become part of the next new history snapshot. Adding this does **not** grant a peer authority over which records exist elsewhere or which posts any user may publish. The wire `hello` announces supported index/snapshot capabilities and `batch` carries a local `snapshotRevision` for the reader's raw Debug console. Neither is a cryptographically witnessed time, signed checkpoint, complete-history proof, or NIP-77 reconciliation. New tests verify 9,000 local ID index lookups, repeated pages without repeated `Replica.list` cloning, two separate scoped subscriptions and live updates mid-snapshot; run through `npm run test:indexed-sync`. Remain open: independent cross-peer missing-ID reconciliation, per-author outbox discovery, Byzantine withholding, snapshot completeness and recovery, no mandatory namespace operators.


## 2026-11-19: owner reiterates anti-capture group review and status incentives (interrupt during indexed sync)

**Verbatim owner clarification:**

> so one thing I wanted to reiterate on how it is encouraged to filter actual spam: those groups they suggest preferred filtering to the members, based on rules what is flagged as good or bad. So a left-wing-extremist group they are very eager to remove conservative viewpoints and flag them maliciously. But the normal strategy of those groups, it is to do 10% lies mixed with 90% truth, so people will not reject them entirely. And we can easily extract the 90% truth by having the opposing extremist group greenlight the content that they flagged. And so non-extremist groups they simply subscribe to both filtering but minus the greenlighting. And it works for all sorts of other groups as well. The user can of course subscribe as individual to whatever filtering they prefer. The assumption is that most mod-alike activity will come from people with ulterior motives, or some sort of self-profiling or need to exercise power over users. Something creative like this could be done, so in the profiles or next to their username they gain extra recognition by flagging in a way that users acknowledge as legitimate, and they should gain bonus rights that makes them look more powerful to others, e.g. a contingent of highlighting their own post as moderator and putting a tiny red flag next to other people's posts. But in actuality their power is very limited and it is just show to feed the deviant nature of those people.

**Implementation boundary recorded:** This is a threat model and composable filtering architecture, not evidence that any ideological group makes a measurable percentage of false claims. Signed negative and positive assessment streams need scoped group charter provenance and reversible local adoption, in a non-exclusive namespace. An explicit opposing group's positive greenlight can cancel a subscribed group's negative opinion, **without erasing either signed record**, or the reader may independently choose consensus-negative rules. These two policies differ when one side abstains; do not invent one mandatory default, final reviewer scoring, or numeric anti-karma rate. Role recognition is reader-selected/group-scoped presentation, not deceptive site-wide bans or deletion authority. The user suggested visible reviewer badges, tiny flagged-post indicators and bounded self-post highlights, not actual censorship power. Keep operator legal/safety IPFS serving decisions independent of optional political or spam content recommendation. See [COMPOSABLE-MODERATION.md](./COMPOSABLE-MODERATION.md) for the design alternatives, adversarial pitfalls and open questions.
