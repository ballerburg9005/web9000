# WEB9000 — Product requirements and non-negotiable design intent

**Status:** Living specification. Derived from the project owner's repeated detailed feedback in ChatGPT, especially the November 18, 2026 discussions. This document is normative for future coding agents and contributors. Record subsequent changes in [CHAT-DECISIONS.md](./CHAT-DECISIONS.md). Where a user requirement conflicts with current implementation, the requirement wins. The experimental v2 code is **not** evidence that the product design is finished.

**Essential thesis:** WEB9000 is a global *permissionless public commons* with voluntary, accountable, self-organized governance and economically expensive spam, initially presented as a small, easy-to-host image board. It must not recreate Reddit's first-registrant dictatorship of community namespaces.

## Priority order: what matters most

1. **No global authority over public expression or namespaces.** Neither "cats" nor any other space has an owner merely because an actor claimed it first. Signed records can always be produced in every space. A signer cannot compel someone else's peer to replicate their records, but a third-party "moderator" cannot globally invalidate them. Stewards/owners are *voluntarily recognized views*, never a global ACL, and their actions must be auditable.
2. **Bot spam must be economically unviable by default.** Particularly mass automated generic commercial spam, not merely topical disagreement or occasional off-topic self-promotion. Most users should not see unreviewed/unstaked posts by default. A sufficiently distributed, strictly gated **qualified replication/view lane** should be economically protected while a separate **raw lane** retains the ability to publish for free.
3. **Make something people actually want to use first.** Preserve the original seven-column grid and keyboard-centric media-first interface, its colorful tiny content badges and the complete original post interaction model. Avoid turning the project into a generic dashboard, a raw-JSON editor, a cryptographic inspector, or a one-page concept demo.
4. **Long-term universal interoperability.** The same flexible signed data and social relationships eventually support personal blogs, small communities, memes, art, forums, meetups, political organizations, events, markets, jobs, positions, DAOs and other future uses. Do not prematurely constrain the data model to one website's categories.

### Foundational network and namespace invariants

- Anyone can publish into **any** space name without permission, fee, invitation or privileged group membership. Space names are not registrable real estate or first-come property. An "owner", elected council or publisher can only *suggest* how the space should look to willing readers.
- Signed publications, independent mirrors and alternative views survive a steward's hidden posts, removal demands and governance fork. No global command erases somebody else's content or revokes their ability to post in a namespace.
- All meaningful censorship/presentation/replication refusals by claiming stewards/moderators should have signed, inspectable provenance: actor, reason, policy, evidence reference, time, scope and appeal/reversal history. Provide an **Audit** toggle that reveals suppressed content and contrasts alternative decision-making authorities, subject to local/legal restrictions on displaying illicit media.
- "Hide" is an individual viewer or peer decision. It is not a claim that the post never existed. A user can look away from posts and delegate that decision to people they trust, without granting those people a universal veto.
- Do not confuse *cryptographic validity*, *eligibility for economically qualified propagation*, *local storage willingness*, *feed visibility* and *legality of retaining media*.
- Some records become unavailable when no willing peers hold them. Do not claim magical permanent availability or immunity from laws applying to particular node operators.

### Initial adoption and UX (deliberately modest first years)

- Expect a niche image-board software with perhaps ~100 people per small community, not immediate explosive adoption or marketing. A group can put static JS files on its own domain and independently choose network peers.
- Start from the **2025 original WEB9000 design**. The current grid initially looked good, but the project owner specifically rejected replacing its unique behavior with a polished generic homepage. Retain original assets (where appropriately licensed), compact information density, animated/colorful content indicators and practical navigation.
- **Seven picture tiles per row on wide screens**, responsive fewer columns on smaller viewports. Keyboard navigation must work with **W/A/S/D and arrows**; Enter opens, Escape closes. Clicking an already selected tile closes its expanded panel. Expanding inserts a **full-width content panel immediately below the selected row**, not a tiny column. Prioritize predictable keyboard focus after network updates.
- Presentation modes **Grid**, **Blog** and **Mixed**. Mixed may combine full-width text articles/sections with rows of several compact media cards. Do not force a single card size for all data types.
- Each compact tile should visually indicate its specific content: image/multiple photos, video/audio, meetup/event and date, poll, open positions/job, offer, discussion, project, comments, tags and other relevant metadata. Avoid a uniform, meaningless "DEMO" icon dominating every tile.
- Clicking a post must show a readable large picture/gallery or video if present, headline, full article body, date/location, tags with voting and editing, reactions/karma, reporting, threaded comments, poll results/voting, open positions, navigation between adjacent posts and a way to close it. A post-detail panel is **not** a debug dump.
- Media preview should preserve consent: unknown images/video/ZIP files do not need to be fetched or cached on visiting the text feed. Self-uploaded or independently trusted safe images may display; user-selectable manual retrieval for others.
- Every form should be usable by a nontechnical person. Use normal image-file upload and actual date/time pickers, tag entry, poll choices and positions. **Never require an ordinary user to type arbitrary JSON or preexisting IPFS CIDs.**
- Mock fixture posts must demonstrate different post structures and their controls. Distinguish demo-only votes/replies from genuine network-signed ones. Do not let test content become indistinguishable from posts stored on the public commons.
- The website's own preferred presentation and moderation suggestions are **overridable** by the reader. If there is no democratically adopted presentation preference for a group/space, use the original author's suggestion as a fallback. A unilateral "blog owner" can suggest a default theme and post order but cannot turn off universal commenting or hide their actions from audit.
- Keep the original browser behavior as a serious product requirement, not an optional polish stage. Automated Chromium tests should assert geometry, click-to-collapse, keyboard navigation, media visibility, post composition and cross-browser comments.

### Spam economics and Stake4Karma

- Stake4Karma is the intended primary **hard Sybil barrier** for entry to the default, economically qualified network. The network still **must function without stake**, by selecting a permissive/raw lane or another voluntarily curated policy.
- **Proposed default threshold at least USD $10** of verified locked stake per substantive account, subject to testing and revision. Capital is temporarily locked for days/weeks; the effective lock and rolling remaining-lock time both matter. Wallets/identities cannot simply claim an arbitrary amount and be believed.
- An independently checked on-chain stake proof (chain, contract, finalized block, wallet binding, value and lock horizon) must precede qualified admission. A demo provider that simply returns a numeric score for a key is acceptable **for testing**, but must be conspicuously labeled mock, configurable and never passed off as live economic protection.
- Hard segmentation: **raw/unqualified signed events** must not be silently mixed into the same trusted presentation/replication database as stake/earned-karma qualified events. Separate indexes can both reference the same namespace. The client may show all when explicitly requested.
- Earned trust/karma should eventually replace the need to tie up coins: a genuine account locks stake, behaves well, earns deserved, independently verified karma, and eventually recovers capital. This is **not** carte blanche for an account to create/sell unlimited identities. Trust inheritance/invitations must be bounded, consent-based, rate-limited and economically accountable.
- Account-farming and identity resale must be expensive. If an invitee is proven to be a large-scale commercial bot, verified sponsors and appropriate ancestors can suffer *large* cascading penalties. The user floated **10 negative karma per one positive karma** and approximately **10× direct invite penalties**, with attenuation and caps **TBD**. Do not hard-code unreviewable, permanent collective punishment without an appeal process; require a verified, reviewable finding.
- "An identity can bootstrap more identities with karma" must be prevented. Invite quota examples: only a few per month, graduated earning and sponsorship liability. A trusted person may invite someone running a genuine blog or site, placing them in a bounded sponsorship/trust group; invitees can eventually invite others.
- **Hard-coded conservative daily defaults**: only a few posts per ordinary account each day, more comments/replies; rate limits on moderation and invites. The exact numbers are subject to testing. A local peer can impose its own ingress limits without claiming a global veto. Throttle at more than just user ID if a single wallet/stake can mint many keys.
- Default feed must not allow *unknown unreviewed* messages to appear immediately just because nobody has flagged them yet. An explicit raw view should exist and must show its status.
- Ordinary self-promotion/off-topic user activity is not the principal botspam threat model. Spam detection, rate controls and delegated curation must not become a disguised censorship mechanism for political/religious/minority viewpoints, unpopular creators or dissent.
- Review panels, transparent rationales, appeal/reversal, reviewer vote provenance, local disagreement, and the ability to demote abusive moderation groups are essential to defending against false flag floods and coordinated censorship.
- A **mock reputation/staking provider** for dev and tests is appropriate now: simple numerical score per user public key, assignable in a local testing panel. Clearly mark its results as simulated. Do not wait for a complete Stake4Karma deployment to finish the classic UI.

### Democratic organization / federation

- Individuals freely form, join, leave, delegate to and fork **clans/guilds/groups**, with a hierarchy or federation of review policies. No membership group gets universal ownership of a namespace or control of independent peers.
- Governance types may include DAO/token votes, direct democracy, representative democracy, elected councils, rotating stewards and other rules. Groups **choose their nature** in their signed charter; no universal one-vote-on-everything requirement.
- Real elections, term limits, quorum, mandates and delegated responsibilities matter for large groups. Karma alone must not determine political or moderation power. Stewards can coordinate a space's common presentation without claiming a censorship monopoly.
- Legally and conceptually, an organization should not automatically be treated as the author of each member's post. Any *voluntary sponsorship penalty* for botspam is distinct from legal liability for individual expression.
- Prefer signed state and evidence over an opaque administrator database. Ratified forks are visible and user-selectable, not silently resolved by "latest wins" or first registrant.
- Presentation rules: an adopted community/federation view has priority where a reader follows it; absent such a vote the original poster's field/layout suggestion is the fallback; an owner/steward's unilateral preference is an optional additional reader-chosen layer.

### Text versus non-text legal/safety handling

- Text/publication metadata should be portable and replicated by willing peers without relying on a central deletion authority; its existence does not obligate every reader to display it.
- **Image/video/archive bytes are different from text metadata.** Illegal-to-store content or material under unresolved legal restrictions must not be blindly cached onto users' computers. Separate media storage from the signed text index. Default to metadata-only, explicit opt-in fetch, independent pinning decisions and local quarantine/unpin.
- Specialized voluntary trusted reviewer groups may identify dangerous media CIDs, advise fast local refusals/unpinning and retain/refer evidence as legally appropriate. Their authority comes from revocable, auditable delegation by federations and clients; it is not a global IPFS deletion power.
- Prevent such groups, officials or hostile governments from silently abusing a "legal/safety" tag to suppress legitimate speech. Every decision is reviewable, reputation-bearing and subject to demotion/fork/override. No guarantee of immunity from local law is claimed.
- Do not promise that client-side decisions or technical decentralization alone prevent censorship by resource exhaustion, legal coercion, hosting takedowns, network blocking or universal refusal to mirror.

### Scalability / transport

- Start by making small groups work extremely well, then grow gradually into an interoperable universal network. Do not over-engineer for billions of users before the image board works; nonetheless avoid architecture that fundamentally collapses at larger populations.
- Data should be portable and content-addressed, replicated independently across willing peers with bounded cost. Local namespace-following, bounded spam-resistant curated indexes and selective media pinning must remain options. There should be no mandatory fixed bootstrap endpoint, centralized DNS service, global privileged space registry or single shared log that every user must fully download.
- Static JS deployment on arbitrary domains should be feasible. Browsers may need replaceable voluntary WebSocket/WebRTC gateways initially; future native browser-to-browser mesh, discovery and redundancy are still engineering milestones.
- Users may download or keep their own portable signing identity, move websites, select alternative mirrors and export signed records. Browsing and publishing must remain possible without trusting an arbitrary domain's self-appointed "cat community administrator."

## Non-goals and anti-patterns

- Do **not** repeat Plebbit's first-claimer censorship capture, tokenized "community ownership" or extortion via name sniping.
- Do **not** mark a signed publication invalid because a curator labels its author banned or the space is "owned." Rejecting *your own replication* is distinct.
- Do **not** put raw/unverified records into the default qualified feed on first sight. Lack of a spam flag is not proof of absence of spam.
- Do **not** substitute a concept-only polished homepage for a functioning post viewer/composer.
- Do **not** imply that mock karma, an unaudited stake contract, custom encryption, a browser-hosted script or voluntary reviewer groups magically protect privacy, economic identity or freedom of expression.
- Do **not** turn allegations/flags into automatic irreversible multiparty punishment. False-flag resilience and evidence/appeal provenance are mandatory.

## Acceptance criteria for the next UI milestones

- [ ] All media tiles and previews have correct dimensions; expanded post **uses full grid row width** and big image/gallery.
- [ ] Clicking selected tile twice closes it; keyboard navigation and focus work during peer network updates.
- [ ] Visually differentiated examples: images, meetup/schedule, polls, positions/jobs, discussion, projects, marketplace and multiple media. No uniform demo-only tiles.
- [ ] Appropriate voting, flagging, tags, polls, comments, date/location, attachments and media controls appear in the expanded viewer, including clearly marked local-only demo controls.
- [ ] A person can submit a post with image upload, dates, tags, poll and positions without understanding JSON or IPFS.
- [ ] Mock numeric karma provider can be configured for test public keys, can be turned off, and is unmistakably not a real verification of locked funds.
- [ ] Actual signed cross-browser post, reply, reaction and IPFS byte exchange continue to pass headless browser and Node tests.
- [ ] Live experimental site updated without destroying persistent peer identity/data. No merge to main until the owner approves.

See [CHAT-DECISIONS.md](./CHAT-DECISIONS.md) for dated user corrections and open design questions.