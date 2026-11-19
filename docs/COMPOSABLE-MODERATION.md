# WEB9000 — independent group scoring, reader filters and reviewer accountability

**Owner-corrected design · November 19, 2026. Parts are implemented experimentally; no central moderator authority is enacted.**

## The actual principle: groups judge content independently

Each group defines and publishes **its own signed content ratings and suggested thresholds**. Groups **do not flag, invalidate or directly greenlight another group's individual decisions**. There is no system of groups filing appeals against each other's review records.

Instead, readers (or willing groups) choose several independent sources and extract useful patterns from the **statistical differences** among their opinions. An ideologically biased organization can nevertheless supply useful spam or safety evidence. A disagreement between competing groups is a reason to **avoid suppressing** controversial or legitimate material, not evidence that either group is correct.

"10% lies mixed with 90% truth" in the earlier example is a qualitative threat model, **not** a verified proportion, rule constant, or hard-coded political classification. Review quality and group trust are to be measured by reader-chosen, auditable evidence rather than automatically inferred ideology.

The owner corrected the earlier "explicit challenges to another group's negative assessments" interpretation: **do not implement it**. The previous cross-greenlight subtraction/consensus-negative proposal is superseded. A single group independently assesses the underlying content; a reader may compare multiple groups' independent ratings of **the same post**, without either one targeting the other group's votes.

## Signed content-rating dimensions

**Popularity remains independent of suitability and importance.** A meme may be popular and intellectually trivial, while a graphic news report may be of high democratic importance.

One signed `content-rating` event targets an original signed post ID and carries the following independent values:

| Field | Domain | Meaning |
|---|---|---|
| Age/suitability tier | 0–6 ordinal | 0 All audiences; 1 PG; 2 age 13+; 3 age 18+; 4 extreme/disgusting adult material; 5 graphic gore (including news); 6 potential legal concern — an **unverified allegation**, never a legal verdict |
| Controversy/censorship pressure | 0–5 | The content is likely to attract strong disagreement, contested suppression, or heightened review pressure |
| Democratic urgency | 0–5 | Importance of timely reporting for civic or democratic participation |
| Intellectual importance | 0–5 | Seriousness, educational or analytical value, distinct from upvote popularity |
| Spam/low-value likelihood | 0–5 | Independent assessment of low-value/automated/spam characteristics |
| Public-interest censorship-pressure alert | Boolean, **special purpose** | **Only** for news/reporting, politically controversial speech under heavy suppression pressure or matters foundational to democratic discourse; not ordinary memes/attention-seeking |

These dimensions are not necessarily objective. Every rating must retain provenance, signer and optional reason. Group affiliation may be **claimed** in a signed payload, but no extra authority is attached unless that signer is a ratified reviewer on a **selected, subscribed group charter branch**. Self-claims do not count as group approval.

**One compact, interactive spider popup:** The normal post reaction bar shows its separate popularity number followed by a tiny 🕸 button. Clicking that icon opens one overlay, **not an in-article dropdown or a mass of sliders**. Five draggable spokes are the 0–6 age tier and four independent 0–5 content-value axes. The active point has a visible numeric value and immediately updated plain-language meaning; drag, keyboard arrows, Home and End work. A dashed shape may show the local median of independently recognized ratings, but it is not authoritative consensus. Unrecognized claims can be inspected independently and cannot silently manipulate automatic filters. The special **public-interest / censorship-pressure alert appears only in the existing ⚑ Report category menu**, as a separately signed `label` with tag `public-interest-censorship-pressure`. This label never implies a zero-age suitability rating or resets spider scores. Older signed `content-rating.publicInterestAlert` records remain recognized for compatibility. An alert does not automatically make a story trend: even a text-first display hint requires multiple credible independent signers and substantive urgency/intellectual criteria. Popularity votes remain separate.

**Gray background scope (new owner correction, 2026-11-19):** The pink polygon is **your own editable vote**. Its gray dashed background should show the **median of all the OTHER users' signed votes the current browser has actually received**, one latest assessment per distinct signing key. It is **not initially limited to personally trusted or group-recognized ratings**, which previously caused an assessment made in another browser/account to disappear. Show how many outside signers were observed; if none, explain there is no gray background yet, without presenting zero as a consensus rating. This unweighted median can be gamed by Sybil keys, and one peer can omit signed history. **Future target**: reader-selected *extended federation of trusted groups* supplies an independently verified signer set to narrow the descriptive background. Never accept an unverified \`body.group\` claim as ratification; signed nested delegations, fork selection and resource-bounded independent discovery remain open. Visual inclusion and automatic rating-based enforcement MUST stay separate; even when all signers are displayed as a reference, only separately qualified/reader-trusted raters can affect the user's voluntary media thresholds.

**Legality warning is not an age certification or moderation command.** Potentially unlawful material is complicated, contextual and jurisdiction-dependent. Reader-selected visibility and operators' lawful storage/quarantine decisions remain separate. An age-tier vote alone does not automatically condemn an author or require a storage peer to fetch forbidden media.

## Threshold-based local interpretation; disagreement is a protection

The owner explicitly rejected **group agreement as a universal prerequisite** because small communities may have only one useful reviewer group. Use adjustable **counts of independently recognized assessments**, not a rigid unanimity requirement.

The owner's illustrative defaults:

- Two qualified age-18+ assessments may **blur a media preview**.
- Five qualified age-18+ assessments may **hide that preview in the reader's view** (never delete its signed post).
- A case with **ten high-age assessments from group A and two credible below-18 ratings from group B** should normally remain **unblurred**, because credible disagreement is a protection against malicious censorship. The opposing group did not need to target or overturn any review decision.
- The user can reveal their locally hidden/blurred media; the original signed event, text, replies and audit history remain available where lawful. **A preview that is set to HIDE is not fetched at all before reveal; a BLUR must fetch media bytes to render it blurred.** A browser may already hold bytes from a previous view/cached session; a later hide cannot undo earlier downloads.
- A new or untrusted key cannot automatically impose or lift restrictions: signed identity ≠ Sybil resistance. To affect automatic presentation, a signer must be individually selected by the reader or independently verified as a reviewer of a reader-subscribed group. Duplicate/new ratings from a key do not multiply votes; its latest signed rating supersedes its own earlier rating in the local projection.

These numbers are **provisional**, not adopted network-wide defaults. A reader's rules are versioned (`v1`), stored locally, and **disabled for automatic media hiding until explicitly enabled**. Controversy, political importance and age are separate axes; political urgency must never become an automatic feed-spam bypass.

A mismatch among many reviewers may indicate strategic flagging, source capture, incomplete replication, or genuine subjectivity. Readers may view per-group distributions; the software should later offer *suggestions* to tune thresholds based on size, trusted review volume, variance, independent downstream outcomes and changing network conditions. Group charters may recommend updated values. Existing users must **not** have preferences silently replaced by incompatible values, nor become stuck on an obsolete version: provide explicit upgrades/migrations, visibility of proposals, simple rollback, and careful budgeted defaults. No automatic calibration or proven accuracy scoring exists yet.

## Groups, moderator incentives and accountability

Members may volunteer/self-nominate as reviewers, without acquiring authority by doing so. Where a group's charter requires election, appointment, term or vote, the role begins **only** after independently verifiable ratification on a selected branch. A group can remove misbehaving reviewers via ordinary quorum-backed amendments; competing signed forks remain inspectable.

Moderators/reviewers should have public, readable activity logs **on their profiles**, including their own signed ratings and negative flags and other people's signed conduct assessments (with optional evidence IDs). Their behavior receives more scrutiny than ordinary publishing. Peers and readers can separately publish **group trust/distrust** ratings as signed opinions; those may inform voluntary recommendations about the group's reliability. They cannot magically punish all members, erase group records, create legal liability or create global sanctions. Any future inherited-group reputation penalty must be explicitly opted into and carefully bounded against collective punishment, retaliation and Sybils.

A reviewer can receive:
- A small **ratified-group badge** next to their name, visible only where that group/branch is voluntarily recognized.
- A tiny, attributed red flag on posts their adopted group has reviewed.
- A limited, reader-chosen opportunity to visually highlight their own posts; status incentives must not become hidden advertising, post deletion, mandatory ordering, or coercive power.

Recognition may reward **verified useful review behavior**, not simply report quantity, ideological agreement, follower count or the ability to mass flag. The symbolic power is intentionally limited and clearly labeled as presentation, **not falsely advertised as a site-wide enforcement role**.

## Actual implementation boundary (2026-11-19)

Implemented experimental:
- Portable signed `content-rating` events with numeric age + radar axes, independent special public-interest alert, optional claimed group, optional explanation.
- Independent signed `group-rating`, `reviewer-conduct` and `reviewer-candidacy` events; signed group opinions never edit another group's rating event. Group-candidacy is not automatic reviewer eligibility.
- Pure local rating projection deduplicates by signer, differentiates untrusted from selected reviewers, and applies versioned local 2/5/2 age threshold/dissent example without modifying or deleting any signed event.
- One compact, score-adjacent 🕸 popup with five directly draggable/keyboard-operable values, live text descriptions, signed Submit, optional review-source inspection/trust; no in-article rating block or sliders. Reader thresholds still live in the Search & filters preferences.
- Group reputation display, reviewer self-candidacy, quorum-backed appointment/removal proposals, and readable activity reports on reviewer profiles.

**Not yet implemented or guaranteed:** cryptographically robust stake/earned-karma score, accurate statistical reviewer quality, adaptive threshold recommendations, independent anti-Sybil aggregation, a proven cross-peer completeness guarantee, private-group filtering, automatic moderator term expiry, cross-group governance elections beyond the existing prototype, reviewer recognition quotas/automatic promotions, or actual legal adjudication. Cosmetic permissions cannot become automatic authority. Verified participant counts describe **this peer's signed observation**, not all records in the network.

## Adversarial tests and future requirements

Test: (1) 10 high-age vs 2 independently credible low-age ratings from distinct groups; (2) only one small group and no requirement for a second group; (3) forged group affiliation confers zero added weight; (4) new Sybil keys do not force blurring; (5) reversing a reviewer endorsement doesn't erase evidence; (6) review changes cannot mutate signed content or other groups' decisions; (7) a reviewer volunteer cannot become appointed without charter ratification; (8) personal audit actions cannot remove or globally censor; (9) malicious "democratic urgency" promotions cannot bypass spam/stake gating; (10) future settings versions do not silently overwrite choices; (11) evidence withheld by a peer is never interpreted as proof of consensus.

For implementation status see `docs/OPEN-ISSUES.md`; foundational authority constraints remain in `docs/PRODUCT-REQUIREMENTS.md` and `docs/GROUP-GOVERNANCE.md`.
