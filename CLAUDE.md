# CLAUDE.md — Expense Claims Build Task

This file is the permanent project instruction/context file for this assignment. It captures the
complete functional requirements extracted from `Build Task 02 - Expense Claims.pdf`, plus the
implementation principles and process that all future development in this repository must follow.

Source document: `Build Task 02 - Expense Claims.pdf` (2 pages). Duration given: 48 hrs from when
the task reached the candidate over email.

---

## 1. The Situation (problem statement, verbatim intent)

Staff at a company spend their own money on travel, meals, supplies and taxis, then claim it back.
The normal flow is:

1. Staff member keeps the receipt.
2. Staff member files a claim.
3. A manager signs it off (approves).
4. Finance pays it out at the end of the month.

The brief explicitly frames most real-world versions of this as "painful, because filing a claim
takes longer than the coffee cost." The task is to **build a working version of this** that removes
that friction.

---

## 2. User Roles and Responsibilities

There are exactly three roles:

1. **Staff member**
   - Files claims (submits expense claims with receipts).
   - Watches what is still unpaid (visibility into the status of their own claims — submitted,
     approved, paid, rejected, etc.).
   - Note: **managers are also staff members** in the sense that they spend money too and file
     claims of their own (see business rules below). So "staff member" capabilities must be
     available to managers as well, for their own claims.

2. **Manager**
   - Reviews the claims filed by their team (the staff who report to them).
   - Signs off (approves) or presumably rejects those claims.
   - Cannot approve their own claim (see business rules).

3. **Finance**
   - Pays out approved claims (marks them paid, presumably at end of month, though nothing
     prevents paying earlier — see open questions).
   - Watches the monthly spend: needs a view of who spent what, under which category, and who has
     gone over their limit (end-of-month reporting need, spelled out explicitly).

---

## 3. Business Rules (explicit, from "What it needs to handle")

The PDF frames these as things "the business actually deals with" and says: **"decide for yourself
what the software should do about each."** That instruction is intentional — the four bullet points
below are problems to solve, not fully-specified specs. Each one is restated here as given, followed
by what is explicitly mandated vs. left to implementation judgment.

### 3.1 Managers file claims too / self-approval / paid claims are final
- Managers spend money too, so **managers file claims as well** — the system must let a manager be
  a claimant, not just an approver.
- **A manager must not be able to sign off (approve) their own claim.** This is a hard rule — must
  be enforced by the system, not just a UI convention.
- **A claim that has been paid is finished and should not go backwards.** Once a claim reaches the
  "paid" state, it is terminal — no further status transitions (no un-paying, no re-approving, no
  rejecting after payment).
- Implication left open: who approves a manager's own claim? (Their own manager, a finance user, or
  another manager — see Open Questions.)

### 3.2 Duplicate receipts
- People send the same receipt twice: sometimes the same day, sometimes three weeks later,
  sometimes **typed slightly differently the second time** (i.e., not necessarily an exact string
  match — this implies fuzzy/near-duplicate detection, not just exact duplicate checking).
- **Finance has paid twice before and wants that to stop.** This is the business pain point driving
  the requirement: the system must detect and prevent (or at least flag) duplicate receipt
  submissions before they result in double payment.
- The detection must account for: same-day duplicates, weeks-apart duplicates, and duplicates with
  slightly different wording/OCR/typing of the same underlying receipt.

### 3.3 Monthly spend and limit reporting
- At the end of the month, finance asks three specific questions the system must be able to answer:
  1. **Who spent what** (spend per staff member).
  2. **Under which category** (spend broken down by expense category, e.g. travel, meals, supplies,
     taxis — the categories named in "The situation").
  3. **Who has gone over their limit** (implies each staff member/claimant has a monthly spending
     limit, and the system must be able to detect and surface when someone has exceeded it).
- This requires: expense categorization on every claim, a monthly spend aggregation view/report for
  finance, and a concept of a per-person (or per-role) monthly limit with over-limit detection.

### 3.4 Receipt text parsing (low-friction claim creation)
- Nobody wants to fill in six fields for a 200 rupee auto ride. Users should be able to **paste in
  whatever is written on the receipt** (free-form receipt text).
- **The system must turn that pasted text into a claim** — i.e., parse the raw receipt text and
  extract structured fields (amount, date, vendor/merchant, category, etc.) automatically.
- The system must **show the parsed result back to the user before it goes to the manager** — a
  confirmation/review step, not a silent auto-submit.
- **They will correct it sometimes** — the parsed data must be editable by the staff member before
  final submission, since automated parsing will not always be perfect.

---

## 4. Expense Claim Lifecycle / Workflow

Derived from the roles and business rules above, the claim moves through a lifecycle. The PDF does
not name exact states, but the workflow it describes is:

1. **Draft/Parsed (pre-submission):** Staff pastes receipt text (or otherwise provides receipt
   input) → system parses it into a structured claim → shown back to the staff member for review
   and correction.
2. **Submitted:** Staff member confirms and files the claim.
3. **Pending manager review:** Claim awaits sign-off from the staff member's manager.
   - If the claimant is a manager, this step cannot be performed by themselves — it must go to
     someone else (see Open Questions on who exactly).
4. **Approved / Rejected:** Manager signs off (approves) or declines the claim.
   - Rejection is implied by the existence of approval as a decision point (an approve-only system
     would not be "review"), but the PDF does not explicitly use the word "reject." This is a
     reasonable inference, not an explicit requirement — document it as an assumption when built.
5. **Paid:** Finance pays out approved claims, generally at end of month. Once paid, the claim is
   **terminal** — "should not go backwards" (no reversal, no status change after this point).

Duplicate detection should occur at or before the submission/parsing stage, so that finance never
ends up paying the same receipt twice — the earlier a likely duplicate is surfaced to the staff
member or manager, the better, per the intent of the rule.

---

## 5. Duplicate Receipt Requirements

- Must detect when a submitted receipt is a likely duplicate of a previously submitted receipt,
  even when:
  - Submitted the same day as the original.
  - Submitted weeks apart (e.g., three weeks later) from the original.
  - The text is **typed slightly differently** the second time (not an exact string match — some
    form of normalization or similarity matching is required, e.g. on amount + vendor + date
    proximity, or fuzzy text similarity).
- Goal stated explicitly: **prevent finance from paying the same claim twice.**
- The mechanism (blocking vs. flagging for review, threshold for "similar enough") is not specified
  by the PDF and is left to implementation judgment — document the chosen approach as an assumption.

---

## 6. Receipt Text Parsing Requirement

- Input: free-form pasted text as it appears on a receipt (implies varied, messy, real-world
  formatting — "receipts written badly" is explicitly required in the synthetic data, see below).
- Output: a structured claim (at minimum: amount, date, category, vendor/description — whatever
  fields the claim record needs).
- The parsed result **must be shown back to the user before it goes to the manager**, and must be
  correctable/editable by the staff member.
- Bonus/plus (see Optional Requirements): accepting a photo or screenshot of a receipt as input, in
  addition to typed/pasted text, counts as a plus — this implies OCR or an image-capable parsing
  path if pursued.

---

## 7. Monthly Spending and Limit Requirements

- Every staff member (claimant) has some notion of a **monthly limit** on claimable spend — the
  exact value, whether it's per-person, per-role, or per-category, is not specified (see Open
  Questions).
- Finance-facing reporting must answer, per month:
  - Total spend per staff member.
  - Total spend per category.
  - Which staff members have exceeded their monthly limit.
- The synthetic data must include **somebody who is close to their monthly limit** (explicit data
  requirement, see below) — implying the limit and near-limit state should be visibly
  demonstrable in the demo, not just theoretically supported.

---

## 8. Realistic Synthetic-Data Requirements

The PDF is explicit and firm about this ("We are not giving you any. Create it yourself."):

- Data must **read like real receipts and real people** — explicitly **not** `test1`/`test2`-style
  placeholder data.
- Must include:
  1. **Receipts written badly** (messy, inconsistent, realistic formatting/typos — this is also
     effectively test data for the receipt-parsing feature).
  2. **The same receipt filed twice in slightly different words** (this is the demo case for
     duplicate detection — must actually exist in the seed data so the feature can be shown
     working).
  3. **Somebody who is close to their monthly limit** (this is the demo case for the monthly
     limit/over-limit reporting feature).
- Synthetic data should span realistic names, multiple staff members, at least one manager–staff
  relationship (with the manager also having their own claims), multiple categories (travel, meals,
  supplies, taxis at minimum, per "The situation"), and claims across different lifecycle states.

---

## 9. Required Submission Deliverables

Exactly two things must be sent:

1. **A link to a public GitHub repository.**
2. **A short video, 3–5 minutes, of the candidate on camera with face visible**, walking through:
   - How they approached the problem.
   - What gave them trouble.
   - What they referred to along the way.
   - Delivery: unlisted YouTube link, Drive link, or Loom link — any of the three is acceptable.

**Preference stated:** a deployed URL or app that can be opened directly is preferred over
something that has to be run locally. This is a stated preference, not an absolute requirement —
but deployment should be treated as a priority deliverable, not a nice-to-have, given how strongly
it's worded ("we prefer... over something we have to run locally").

---

## 10. README Requirements

The README in the public GitHub repository must cover, explicitly:

1. **How to run it** (setup/run instructions — must be complete enough for the reviewer to actually
   run the project, in case the deployed version isn't used or isn't available).
2. **The decisions and assumptions made**, especially anything not explicitly told to the
   candidate — i.e., all the "decide for yourself" gaps in this document must be written up in the
   README as explicit assumptions.
3. **Which AI tools were used and where** — full disclosure of AI tool usage and where in the
   process they were applied.
4. **What would be done next with another week** — a forward-looking "future work" section.

---

## 11. Demo-Video Requirements

- 3 to 5 minutes long.
- Candidate must be **on camera, face visible** (not just a screen recording/voiceover).
- Must walk through:
  - How the problem was approached.
  - What gave trouble during the build.
  - What resources/references were used along the way.
- Hosting: unlisted YouTube, Google Drive, or Loom link — any is acceptable.

---

## 12. Optional / Bonus Requirements

Explicitly called out as a "plus," not required:

- **Taking more kinds of input than typed text** — accepting a photo or a screenshot of a receipt,
  in addition to pasted text, is a plus. This would likely require an OCR step ahead of the existing
  text-parsing requirement.

Everything else in the "Notes" section is guidance/permission rather than a bonus feature (see
Constraints below).

---

## 13. Important Constraints (from "Notes")

- **Any language, any framework, any database** — technology choice is entirely open; this is a
  "your choice" freedom, not a constraint to route around.
- **AI tools are allowed and expected** — must be disclosed in the README (which tools, where used).
- Candidates are **encouraged to lean on free tiers** and to plug in whatever providers/services
  save time (e.g., for OCR, parsing, hosting, etc.) — cost-consciousness is explicitly welcomed as
  an approach, not a workaround.
- **If something needs a payment, emulate it** — actual payment gateway integration is explicitly
  **not required**. Finance "paying out" a claim can and should be simulated/mocked rather than
  wired to a real payment processor.
- **Time constraint:** 48 hours from when the task reached the candidate over email — this is a
  scoping constraint that should bias implementation toward a working, demonstrable end-to-end
  system over gold-plating any single feature.

---

## 14. Implementation Principles

Future development on this project must:

- **Prioritize a working end-to-end application.** A complete, demonstrable flow — from receipt
  text/paste to parsed claim, submission, manager approval, and finance payout/reporting — matters
  more than depth on any single piece. Given the 48-hour framing, breadth-of-completion beats
  polish on one slice.
- **Preserve the business rules.** Every rule in Section 3 (manager can't self-approve, paid claims
  are terminal, duplicate detection, monthly limits, receipt parsing with a review step) must be
  enforced in the implementation, not merely documented.
- **Handle edge cases explicitly.** E.g., a manager who is also someone else's staff, a claim that
  is a near-duplicate but not identical, a staff member with no manager assigned, a claim that
  crosses a month boundary, empty/malformed pasted receipt text. Do not silently ignore these —
  either handle them or explicitly document them as out of scope.
- **Avoid unnecessary complexity.** Prefer the simplest mechanism that satisfies a stated
  requirement (e.g., a straightforward similarity heuristic for duplicate detection over an
  elaborate ML pipeline, unless time and value justify more). Given the 48-hour scope, simplicity is
  also a correctness strategy.
- **Use realistic demo data.** Follow Section 8 exactly — real-sounding names and receipts, messy
  formatting, an intentional near-duplicate pair, and someone near their monthly limit, seeded and
  ready to demo without manual setup.
- **Include tests for important business rules.** At minimum: manager-cannot-approve-own-claim,
  paid-claims-are-terminal, duplicate-receipt-detection, and monthly-limit/over-limit calculation.
- **Keep the application easy to deploy and demonstrate.** Favor deployment-friendly choices (per
  the PDF's stated preference for a URL over local-only setup) and keep run instructions accurate
  and minimal.
- **Document assumptions that were not explicitly specified.** Every "decide for yourself" gap
  identified in this document (see Section 15) must have its resolution written down — in this file
  as decisions are made, and ultimately in the README as required by Section 10.

---

## 15. Open Questions / Ambiguities Requiring Implementation Decisions

The PDF deliberately leaves these open ("decide for yourself what the software should do about
each"). They must be resolved with explicit, documented decisions before or during implementation —
not silently assumed:

1. **Who approves a manager's own claim?** Options: the manager's own manager (implies a reporting
   hierarchy of arbitrary depth), a designated finance/admin approver, or a peer manager. The PDF
   only says the manager can't approve *their own* claim.
2. **What exactly is a "monthly limit"?** Per-person, per-role, per-category, or a single global
   figure? Configurable per user or fixed? Not specified.
3. **Duplicate detection mechanism and threshold.** What counts as "similar enough" to flag/block —
   exact text match, fuzzy text similarity, amount+vendor+date-window matching, or a combination?
   Should a suspected duplicate be hard-blocked or flagged for manager/finance review?
4. **Claim states beyond what's implied.** The PDF implies submitted → pending approval → approved
   → paid, and a terminal "paid" state, but never uses the word "reject" or defines what happens to
   a declined claim. A rejected/returned-for-correction state is a reasonable addition but is an
   assumption, not a stated requirement.
5. **Expense categories.** "Travel, meals, supplies and taxis" are named as examples in "The
   situation," not declared as an exhaustive/fixed category list.
6. **Currency/locale.** The example uses "200 rupee auto ride," suggesting INR as a natural default
   currency for synthetic data, but this is not a stated requirement.
7. **Who assigns staff to managers**, and whether that structure is fixed at seed time or
   manageable in the app, is unspecified.
8. **Timing of finance payout** — the narrative says "finance pays it out at the end of the month,"
   but does not prohibit paying earlier; whether payout is a manual per-claim action, a batch
   end-of-month action, or both, is left open.
9. **Photo/screenshot receipt input (bonus)** — if pursued, the specific OCR approach/provider is
   unspecified and free to choose.

---

## 16. Development Process

Future implementation should proceed **phase-by-phase**, not as one large undifferentiated effort.

- **Before implementing each phase**, inspect the existing project (current code, data, and prior
  decisions) so new work is consistent with what already exists.
- **After implementing each phase**, run the appropriate tests/checks for that phase and verify the
  result before moving on.
- **Do not make unrelated changes** — each phase's work should stay scoped to that phase's goal.
