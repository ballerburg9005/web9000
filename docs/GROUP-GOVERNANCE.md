# WEB9000: signed group governance, timed voting and portable proof

Status: **experimental `timed-v1` local interpretation**, not a trustless global election consensus. This design explicitly prevents an active minority from changing group signing authority just because the rest of a group did not check in. Every rule is voluntarily adopted; no group can own a public namespace or erase other groups' records.

## Identity and multisignature

A group is identified by the immutable signed founding `group` event ID, **not** by its public name or the domain hosting its UI. The charter signer is the founding member. Membership additions, removals, reviewer assignments, policy changes and metadata amendments are independent signed `proposal` events attached to the parent governance branch. Each eligible member signs a distinct `vote` event referring to the proposal ID.

The interpreter verifies the Ed25519 signature of the charter, proposals and ballots, derives eligible members from the **parent snapshot**, counts at most one distinct approving key per binding proposal, and checks the signed quorum. No signatures have to be created simultaneously or on the same device. They are individually verifiable, not an aggregated BLS/MuSig threshold signature.

A group may produce **multiple independently ratified forks**. The application never invents a single global latest winner. Readers choose branches, and the independent media/content network remains outside the group's write authority.

The group's *name, description and recommended public spaces* are now ratifiable metadata. Unsigned server metadata, unratified proposals and unilateral edits by nonmembers are not presented as adopted group information. In a fork, each valid branch can display different ratified metadata.

## Protocol decision policies

Existing charters without `decisionPolicy` retain **legacy quorum** interpretation for backward compatibility. New groups may opt into a signed policy `{"mode":"timed-v1"}`; only signed constitutional amendments can upgrade an older group. Neither a site operator nor a JavaScript update may retroactively rewrite a charter's policy.

`N` = eligible member keys in the proposal's **parent** charter snapshot.

| Proposal type | Duration | Approval rule | Effect |
|---|---:|---|---|
| Ordinary `resolution` | 7 days | Turnout ≥ min(N, max(2, ceil(N/3))); more **For** than **Against** among participants | Nonbinding, locally observed group preference only |
| `set-group-info` | 7 days | Signed For approvals ≥ max(legacy charter quorum, floor(N/2)+1) | Ratifies group name, description, and recommended spaces on one branch |
| Membership, delegation, reviewer, label rules, quorum and other constitutional changes | 14 days | Signed For approvals ≥ max(legacy charter quorum, ceil(2N/3)) | Changes that one group's governance state recognizes on one branch |
| Enable `timed-v1` policy from legacy | 14 days | Signed For approvals ≥ max(legacy charter quorum, ceil(2N/3)) | Changes only the selected branch's future decision policy |

Binding approvals are **absolute member signatures**, not a percentage of whoever happened to log in. This is intentional protection against opportunistic takeover. If enough signatures arrive within the declared window, a binding change is locally ratified without needing the rest of the members online. If they do not, its state is unchanged. An unapproved proposal does not acquire authority merely because its deadline passes.

Advisory motions use an activity-friendly turnout floor. Example: for 12 members, at least 4 must vote; a 3–1 majority is locally supported after seven days, but **cannot edit membership, grant moderation keys, alter quorum, or replace official group metadata**. A 1–0 outcome has insufficient turnout. For two members, both must participate; for one founding member, one is sufficient.

Participating members can update their advisory motion ballot; the latest signed ballot dated within the voting window is used. Rejections and revisions remain inspectable. Binding Ed25519 approvals are append-only: later dissent is preserved as evidence, but does not silently revoke an already ratified state. Proposals and votes with signed timestamps outside their prescribed window are not counted in `timed-v1` ratification. **Unverified/mock karma has absolutely no effect on these thresholds.**

**Major unresolved timing limitation:** The timestamp in an Ed25519 event is signed **by its author**, not independently certified as real-world time. Disconnected replicas can miss ballots, and a malicious signer can backdate a record. The current `timed-v1` deadlines are therefore a deterministic *local interpretation of the signed event set*, not final blockchain-style time consensus. An honest late-arriving backdated ballot may change a viewer's advisory tally. Before calling this a cryptographically final election system, implement signed multi-peer checkpoints/time attestations and a challenge period; do not silently rely on a single website clock or index operator. For binding amendments, requiring monotonic absolute signer thresholds makes portable inclusion proofs much stronger than simple majorities of an unknown incomplete turnout set.

## Offline proof that a particular group history was authorized

The classic group interface can export `web9000-group-branch-proof-v1` JSON containing a founding charter, a selected chain of signed proposals and the minimum eligible member signature records proving each ratification. Its JSON bundles require no fixed domain, current governance server, or live network.

Use **Clans → Export signed proof**, then **Clans → Verify independently signed group proof** to check a JSON file in the browser. A standalone local verification program is also available:

```sh
node v2/network/verify-group-proof.mjs web9000-group-proof-....json
```

A valid result gives the founding signer, explicit group ID, selected branch head, independently verified group information, member keys, and approval signature IDs/counts. Tampering, missing approvals, invalid extra signatures and duplicate record IDs are rejected.

**A valid inclusion proof does not prove that this is the latest, only, or politically legitimate branch.** A peer may know later ratified amendments, conflicting forks, withheld votes or competing group organizations. Proofs cannot certify real-life membership, human uniqueness, trustworthiness, or legal representation.

## Credibility-weighted legitimacy: design for `timed-dual-v2`, not yet active

The owner wants high-karma contributors to have *more* influence while preserving democratic equality, and to avoid inactive keys immobilizing every ordinary decision.

A plausible next policy is **two-chamber approval**:

1. The independent **democratic tally** has one vote per eligible member. It requires a majority of participants, subject to a predeclared participation floor, and cannot be bypassed by wealth or karma.
2. A separate **credibility tally** weights reputation based on *independently verifiable*, pre-vote, frozen score snapshots. A diminishing-returns formula such as `w = 1 + min(2, log2(1+karma/K))` caps each member at 3× the base influence; choose K only after simulations/empirical score distributions. It can strengthen approval or block a dubious motion, but never override the democratic chamber or binding constitutional signatures.

This specific formula and percentage thresholds are **design candidates, not adopted rules**. Stake capital alone must not be confused with earned credibility. Scores must be attributable to a key, Sybil-resistant, auditably signed, time-bounded, appealable and pinned before voting opens. The current numeric mock karma widget is locally editable and therefore **MUST NOT** authorize any group change.

For inactive memberships: preserve membership and the right to return. Do not remove voters, shrink a binding quorum, or count silence as a yes vote based solely on inactivity. Possible future mechanisms include revocable delegated ballots with fixed expiration, signed leave/sabbatical states, advance-noticed electorate snapshots, rotating elected operational roles and a separately specified, heavily protected group recovery/fork process. A group whose constitutional threshold is no longer achievable can be reconstituted as a **new signed charter**, without falsely claiming an irrevocable right to overwrite the original.

## Tests

Core tests use real Ed25519 keys for 2-of-3 metadata ratification, independent portable proof verification, signature forgery, duplicate signatures, competing forks, two-of-five advisory turnout, 7-day closure, vote changes, forbidden late votes, failed inactive-member takeover, 14-day constitutional safeguards, and preservation of legacy charters.

The real Chromium integration additionally creates a group, sends a signed metadata amendment and approval over an independently operated OrbitDB bridge, waits for the remote signer events, validates an exported JSON proof in-browser, and publishes a timed advisory motion. See `v2/test/governance.test.js`, `v2/test/group-proof.test.js` and `v2/network/smoke-classic.mjs`.

**Scope boundary:** This is not a production governance oracle, anonymous election, universally enforceable moderation authority, or a guarantee of trustworthy karma. It is a portable authenticated group-history interpreter with explicit local policy selection.
