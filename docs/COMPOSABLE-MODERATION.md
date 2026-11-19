# WEB9000 — composable adversarial review and recognition
**Design clarification from owner · 2026-11-19 · NOT an enacted default policy**

## Intent

WEB9000 groups suggest review rules to willing readers. They do **not** own a namespace, delete another author's signed record, or receive global publication/moderation rights. The owner expects many people attracted to moderation to have conflicts of interest, ambitions for status, strong ideological commitments, or incentives to overflag dissent. **Do not assume reviewers are neutral.** Make even biased reviewers useful as *evidence sources* by allowing independent, conflicting review signals to cancel unwarranted negative assessments.

The owner's example is a censorious politically extreme group flagging ideologically opposed speech as harmful. An opposing group may issue a positive **greenlight** for the same content; a mainstream reader/community can combine both signed assessment streams rather than taking either group whole. This must work for **all** viewpoints and content categories, not hard-code ideological labels or any empirical "90% true / 10% false" claim. Those proportions were an intuitive example of why rejecting every output from a biased group throws away useful signals, not verified statistics or a protocol parameter.

## Independent signed review inputs

- **Negative assessment:** a group/member's signed recommendation to warn, demote, hide from that reader's feed, or decline media replication under a particular identified rule. References exact post/event/CID, evidence, authorship, adopted group charter branch/rule version, reason, issuing scope, publication time (self-reported until independently witnessed), and signed reversal or expiry. **An allegation is not evidence of truth.**
- **Positive assessment / greenlight:** a signed, target-specific declaration that the issuer reviewed a post/CID and considers a specified negative finding unwarranted under a stated rule, or positively recommends it. It does **not** change the original post or erase its negative assessments.
- **Unreviewed / abstained:** distinct from either approval or condemnation. Qualified spam admission is a separate verifier layer; silence does not equal clean content.
- **Reader's preferences:** independently chosen subscriptions to none/one/many groups and their charter branches, plus personal per-author, content and tag rules. A subscribed group is not a universal administrator. No group may change another person's subscriptions, defaults, raw audit access or personal filter.

## Two plausible composition strategies — NOT equivalent; user has NOT chosen a mandatory one

**A. Cross-greenlight subtraction:** for a reader explicitly adopting groups A and B, compute
`effectiveNegatives(A) = negatives(A) - positiveGreenlights(B)` and
`effectiveNegatives(B) = negatives(B) - positiveGreenlights(A)`.
The remaining negative assessments feed the reader's chosen hide/downrank/warn rule. This retains a one-sided flag *unless* an opposing subscribed reviewer specifically clears it.

**B. Cross-group negative consensus:** automatically hide only when independent subscribed reviewers *both* issue an applicable negative assessment; otherwise keep the record visible with disputed/unchecked labels. This is stricter about false positives but less protective against actual spam missed by one group.

Both require explicit local adoption, condition-specific semantics, transparent signed provenance and appeal. A malicious greenlighter could rubber-stamp every objection, just as a malicious flagger could flag every political opponent. **Neither signal is automatically truthful merely because it came from an ideological adversary**. The user may also configure a more complex ruleset (e.g. specialist malware and abuse-review groups, activity-specific confidence, advisory-only warning versus hide, personal veto), but do not hard-code a numeric weight or "extremist" classification.

*Example truth table for option A, assuming A and B are both subscribed and the reader treats surviving negatives as suggestions:*

| A flag | B greenlight targeting that flag | Result for A's flag |
|---|---|---|
| yes | yes | Cancel/mark explicitly disputed; original flag remains auditable |
| yes | no / abstain | Flag remains an advisory recommendation |
| no | yes | Positive note only; no negative flag existed to cancel |
| no | no | Unreviewed, **not** verified clean |

For the reverse direction swap group roles. If **both flag**, neither independently cancels the other's flag, and their disagreement/confidence/appeal history can be displayed. If **both greenlight** a dangerous item, readers and operators still retain separate local legal/safety refusal policies.

**Safety boundary:** the reader's chosen feed composition must **not** automatically compel a peer to serve, download, or retain forbidden or legally risky media. Operator quarantine and signed-media legal review are distinct from ordinary speech recommendations and individual feed preferences.

## Reputation, status and deliberately *limited* reviewer privileges

The user proposes making accurate reviewers *look and feel recognized* through visible status and a few symbolic/presentational privileges, without creating a coercive moderation hierarchy. Candidate privileges to test (not automatically granted):
- Small **reviewer badge** beside the name, explicitly attributed to an elected/ratified group branch and **visible only where the reader has adopted that group**.
- Tiny **red flag** marker on reviewed posts, with source, scope, reason and contest/appeal controls. This is a **recommendation**, not a platform-wide infraction or proof of wrongdoing.
- An optional **featured reviewer post** or highlight for a bounded, reader-approved quota. Any such highlight must be labeled and turn-off-able, not a right to force placement, obscure dissent, or outrank user-stated display preferences.
- Recognition rewards based on **reviewer correctness as independently assessed by affected readers or verifiable appeal outcomes**, not raw volume of flags, alignment with one ideology, automatic transitive kudos or which faction won a popularity contest.

**Never misleadingly claim that symbolic reviewer privileges are site-wide enforcement authority.** The design uses status incentives, not fake sanctions or a secret moderator caste. People can leave, unfollow, appeal, choose another specialist, or inspect the underlying signed events. Do not give cosmetic review status the ability to change guild membership, capture a namespace, ban publishing, or remove signed evidence.

## Protocol and attack-review tasks before implementation

1. Define signed positive and negative *assessment* envelopes, distinct from existing `label`, `report`, `reviewer`, and governance change events. Specify explicit `target`, provenance, group ID + charter branch, rule, evidence, expiration, reversals and version. Design consent and identity/replay protections. No mutable global "latest".
2. Independently verify that the claimed reviewer was actually ratified/appointed for that **specific scope and time** at the cited parent branch; avoid granting standing to fake/expired branch positions.
3. Provide a **local, deterministic, auditable** composition engine with selectable rule presets (cross-greenlight subtraction, consensus-negative, advisory-only, personal filters), keeping all original signed negative and positive records inspectable.
4. Prevent unilateral publisher/curator groups from rewriting defaults or hiding counter-signals. A gateway's proposed moderation subscriptions are **suggestions**, not auto-enrolled peer authority.
5. Account for collusion, coordinated rubber-stamp greenlighting, malicious mass flagging, brigading, reviewer self-promotion, sock puppets, status farming, retaliatory reports, long-term reputation gaming and quorum takeover. Include reversal/appeal evidence and accountability.
6. Retain cryptographic signed snapshot completeness caveats: seeing no opposing endorsement might simply mean it was withheld by the selected mirror. Do not confuse `no greenlight received` with proof no greenlight exists.
7. Test independent peer disagreement, group fork/charter changes, per-reader overrides, offline propagation, scoped media legal refusal, display badges without global authority and local ability to turn off all group review suggestions.

### Implementation status

**This file records owner direction only, NOT an automatic group filter, enacted cross-greenlight subtraction rule, earned review rights or reviewer-ranking algorithm.** Current v2 code mainly supports negative local `label` interpretations, local reviewer weights, simple delegated group reviewer inheritance and optional group hide tags; it does not have ratified positive-greenlight votes, transparent reviewer accuracy scores, standing proof with evidence completeness, or the requested cross-opposition composition. The UI should not imply they already work. These are future features to design, test and present for owner review; the ongoing backend indexed-sync change does not alter group policy.
