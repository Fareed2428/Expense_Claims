# Implementation Plan — Expense Claims Application

Status: **PLANNING ONLY — nothing in this document has been implemented yet.** No code, packages,
or database have been created. This plan is derived strictly from [`CLAUDE.md`](../CLAUDE.md) and
`Build Task 02 - Expense Claims.pdf`, and from an inspection of the current workspace.

**Workspace inspection at time of writing:** the project directory contains only
`Build Task 02 - Expense Claims.pdf` and `CLAUDE.md`. No source code, package manifests, or
database exist yet. This plan starts from a clean slate.

This plan requires explicit approval (see Section 16 and the end-of-document summary) before any
implementation phase begins.

---

## 1. Recommended Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Frontend | **Next.js 14 (App Router) + React + TypeScript** | Server components + client components in one project, file-based routing gives us the page list in Section 10 almost for free, and it deploys as a single unit. |
| Backend / API | **Next.js Route Handlers (same app)**, i.e. a single full-stack app, not a separate service | Removes an entire category of 48-hour risk: CORS, two deploy targets, two sets of env vars. One repo, one deploy, one URL to hand back — matches CLAUDE.md's "keep the application easy to deploy and demonstrate." |
| Database | **PostgreSQL**, hosted on **Neon** (serverless Postgres, free tier) | Real relational DB (claims/approvals/audit trail are inherently relational), works locally and in production with the same connection string, and Neon's free tier + serverless driver pairs natively with Vercel. Avoids SQLite's "ephemeral filesystem on serverless" trap. |
| ORM | **Prisma** | Type-safe schema-as-code, migrations, and a query API fast enough to build against in 48 hours. Schema doubles as living documentation of Section 3 below. |
| Styling / UI | **Tailwind CSS** | Fast to build consistent, readable screens without hand-rolling CSS; no design-system dependency to install and learn. |
| Auth / session | **Custom lightweight "demo login"**: a picker of seeded users, a signed httpOnly session cookie (userId + role), and route middleware that checks it | The assignment needs a login/demo-access page and role-based access, not a production identity system. A real OAuth/password flow would burn hours on a problem the assignment doesn't ask for. Documented explicitly as a demo-mode assumption in the README (see Section 16, item 7). |
| Receipt parsing | **Deterministic rule-based parser** (regex + the `chrono-node` npm library for dates + keyword dictionaries for merchant/category), written as a pure, unit-testable TypeScript module | No external API key, no network dependency, no flakiness — the parser must work identically for the reviewer's demo and for automated tests. See Section 6. |
| Duplicate detection | **Hybrid: exact-hash + fuzzy text similarity + field-based scoring**, computed server-side at submission time | Combines the "typed slightly differently" requirement (needs fuzzy matching) with a fast, deterministic first check (exact hash). See Section 7. |
| Testing | **Vitest** for unit/integration tests (parser, duplicate detector, state machine, permissions) | Fast, TypeScript-native, works well with Next.js API route logic extracted into plain functions. |
| Deployment | **Vercel** (app) + **Neon** (database), both free tier | Matches the PDF's stated preference for a deployed URL; both are a `git push`-triggered deploy with zero server management. See Section 14. |
| Optional/bonus: photo receipt input | **Not in the core 48-hour scope**; if time remains, add an OCR step (e.g. Tesseract.js client-side, or a hosted OCR API) that feeds its output text into the *same* text parser used for pasted text, so it's additive, not a parallel code path | Keeps the bonus from threatening the core deliverable; explicitly deferred, see Section 15 (Phase 9 / stretch). |

---

## 2. Application Architecture

```
                         ┌─────────────────────────────────────────┐
                         │              Vercel (hosting)            │
                         │                                           │
   Browser  ───HTTPS───▶ │  Next.js App (App Router)                │
  (Staff /               │   ├─ Pages (React Server + Client Comp.) │
  Manager /               │   ├─ Route Handlers  (/api/*)  ── API   │
  Finance)                │   ├─ Session middleware (cookie check)  │
                         │   ├─ lib/parser        (receipt parsing) │
                         │   ├─ lib/duplicates    (duplicate check) │
                         │   ├─ lib/state-machine (claim transitions)│
                         │   └─ Prisma Client                       │
                         └───────────────┬───────────────────────────┘
                                          │ Postgres wire protocol (TLS)
                                          ▼
                              ┌───────────────────────┐
                              │  Neon PostgreSQL       │
                              │  (serverless, free tier)│
                              └───────────────────────┘
```

- **Frontend**: React pages under `app/(staff|manager|finance)/...`, using server components for
  data-heavy dashboard pages (fetched directly via Prisma on the server, no client-side fetch
  waterfall) and client components only where interactivity is required (the claim-creation form,
  the parse-and-review step, approve/reject buttons).
- **Backend/API**: Next.js Route Handlers under `app/api/...` for actions that need to be callable
  independently of a page render (e.g. `POST /api/claims`, `POST /api/claims/:id/approve`) and for
  anything the client components call via `fetch`. Server components call the same underlying
  `lib/` functions directly (no HTTP hop) where possible, to avoid duplicating logic.
- **Database**: Postgres, accessed only through Prisma, only from server-side code (route handlers
  and server components). The browser never talks to the database directly.
- **External services**: none required for the core scope. Everything (parsing, duplicate
  detection, "payment") runs inside the app. If the OCR bonus is attempted, it is the one external
  service in the system (see Section 1 and Section 15).
- **Communication**: browser ↔ Next.js over HTTPS (same origin, so no CORS configuration needed);
  Next.js ↔ Postgres over the standard Postgres protocol via Prisma, using Neon's pooled connection
  string (required for serverless function environments).

---

## 3. Database Design

All tables below are described at the "important fields" level called for in the task; exact
Prisma syntax is written during implementation, not in this planning document.

### 3.1 `User`
| Field | Type | Notes |
|---|---|---|
| id | uuid/cuid, PK | |
| name | string | realistic full name |
| email | string, unique | used as the demo-login identifier |
| role | enum: `STAFF`, `MANAGER`, `FINANCE` | a `MANAGER` is also a claimant — see Section 4 |
| managerId | FK → `User.id`, nullable | self-referential; who this user's claims route to for approval. Null for Finance users and for the top-of-hierarchy manager (see Section 15 decision on who approves a manager's claim) |
| monthlyLimit | decimal | the monthly claimable limit used for over-limit reporting (Section 8) |
| createdAt | timestamp | |

### 3.2 `Claim`
| Field | Type | Notes |
|---|---|---|
| id | uuid/cuid, PK | |
| claimantId | FK → `User.id` | who filed it |
| approverId | FK → `User.id`, nullable | resolved manager for this claim, set at submission time |
| status | enum (Section 5) | `PARSED` → `SUBMITTED` → `APPROVED`/`REJECTED` → `PAID` |
| category | enum/string | Travel, Meals, Supplies, Taxi, Other (Section 15 decision) |
| merchant | string | parsed/corrected vendor name |
| amount | decimal | claimed amount |
| currency | string, default `INR` | see Section 15 decision |
| expenseDate | date | date on the receipt, not the filing date |
| description | string | free text, parsed or user-entered |
| rawReceiptText | text | the exact text the user pasted (or OCR output) — kept verbatim for audit + duplicate detection |
| duplicateFlag | boolean, default false | set by the duplicate detector at submission time |
| duplicateScore | float, nullable | highest similarity score found against prior claims |
| submittedAt | timestamp, nullable | |
| decidedAt | timestamp, nullable | when manager approved/rejected |
| decisionNote | string, nullable | manager's reason, especially for rejection |
| paidAt | timestamp, nullable | |
| paidById | FK → `User.id`, nullable | finance user who paid it |
| createdAt / updatedAt | timestamp | |

### 3.3 `Receipt` (parsed data, 1:1 with `Claim`)
Kept separate from `Claim` rather than merging every field in, so the "what the OCR/parser
originally produced" is distinguishable from "what the claim record now says" after user
correction — useful for both auditability and for evaluating parser accuracy.

| Field | Type | Notes |
|---|---|---|
| id | uuid/cuid, PK | |
| claimId | FK → `Claim.id`, unique | 1:1 |
| sourceType | enum: `PASTED_TEXT`, `IMAGE_OCR` | supports the bonus path without a schema change |
| rawText | text | original pasted/OCR'd text |
| normalizedText | text | lowercased, whitespace-collapsed, punctuation-stripped — used by duplicate detection |
| textHash | string, indexed | SHA-256 of `normalizedText`, for O(1) exact-duplicate lookups |
| parsedMerchant | string, nullable | parser's raw output, pre-correction |
| parsedDate | date, nullable | |
| parsedAmount | decimal, nullable | |
| parsedCategory | string, nullable | |
| parseConfidence | float, nullable | rough 0–1 score the parser assigns per field, used to decide what to highlight for user review |
| imageUrl | string, nullable | only populated if the OCR bonus path is built |
| createdAt | timestamp | |

### 3.4 `DuplicateMatch` (duplicate detection results)
Stores *why* a claim was flagged, so the UI can show "this looks like claim #123 filed on ..."
instead of a bare boolean, and so finance/manager can audit false positives.

| Field | Type | Notes |
|---|---|---|
| id | uuid/cuid, PK | |
| claimId | FK → `Claim.id` | the newer claim being checked |
| matchedClaimId | FK → `Claim.id` | the earlier claim it resembles |
| matchType | enum: `EXACT_HASH`, `FUZZY_TEXT`, `FIELD_MATCH` | which signal(s) fired |
| score | float | 0–1 similarity score |
| createdAt | timestamp | |

### 3.5 `ClaimEvent` (audit/history)
An append-only log of every state transition and key action on a claim — required to demonstrate
"paid claims don't go backwards" is actually enforced (not just true by accident), and generally
good practice for anything touching money.

| Field | Type | Notes |
|---|---|---|
| id | uuid/cuid, PK | |
| claimId | FK → `Claim.id` | |
| actorId | FK → `User.id`, nullable | null for system-generated events (e.g. auto-flag) |
| eventType | enum: `CREATED`, `PARSED`, `EDITED`, `SUBMITTED`, `DUPLICATE_FLAGGED`, `APPROVED`, `REJECTED`, `PAID` | |
| fromStatus / toStatus | enum, nullable | for transition events |
| note | string, nullable | |
| createdAt | timestamp | |

### 3.6 Relationships summary
- `User` 1—N `Claim` (as claimant, via `claimantId`)
- `User` 1—N `Claim` (as approver, via `approverId`)
- `User` 1—N `Claim` (as payer, via `paidById`)
- `User` 1—N `User` (self-referential manager relationship, via `managerId`)
- `Claim` 1—1 `Receipt`
- `Claim` 1—N `ClaimEvent`
- `Claim` 1—N `DuplicateMatch` (as the newer claim) and 0—N (as a `matchedClaimId` target of others)

---

## 4. User Roles and Permissions

| Action | Staff | Manager | Finance |
|---|---|---|---|
| File a claim for themselves | ✅ | ✅ (managers are claimants too) | ❌ (Finance is a payout/reporting role, not a claimant, per the PDF's role list — see Section 15) |
| Paste receipt text and review the parsed result | ✅ (own claims) | ✅ (own claims) | — |
| Edit a claim before submission | ✅ (own, while `PARSED`) | ✅ (own, while `PARSED`) | ❌ |
| View own claims / "what is still unpaid" | ✅ | ✅ | ✅ (sees all claims, not just "own") |
| View a team member's claims | ❌ | ✅ (only their direct reports) | ✅ (all) |
| Approve/reject a claim | ❌ | ✅ (**only** claims where `claim.approverId == self` **and** `claim.claimantId != self`) | ❌ |
| Approve/reject their **own** claim | ❌ (not an approver at all) | ❌ (hard-blocked, see Section 5) | ❌ |
| Mark an approved claim as paid | ❌ | ❌ | ✅ (only claims with status `APPROVED`) |
| Reverse/un-pay a claim | ❌ | ❌ | ❌ (nobody can — `PAID` is terminal for all roles, see Section 5) |
| View monthly spend / category / over-limit reports | ❌ | limited (their team only, optional nice-to-have) | ✅ (org-wide, this is Finance's core job per the PDF) |
| See another employee's individual claim detail outside their scope | ❌ | ❌ (only direct reports) | ✅ |

All of the above are **server-enforced** (Section 12), not just hidden in the UI — a Staff user
hitting `POST /api/claims/:id/approve` directly gets a 403, regardless of what the UI shows them.

---

## 5. Claim State Machine

### States
| Status | Meaning |
|---|---|
| `PARSED` | Claim exists, receipt text has been parsed, staff member is reviewing/correcting it. Not yet visible to the manager. Functions as the "draft" state. |
| `SUBMITTED` | Staff member confirmed the (possibly corrected) data; claim is now pending the assigned manager's review. |
| `APPROVED` | Manager signed off. Awaiting finance payout. |
| `REJECTED` | Manager declined it, with a `decisionNote`. Terminal for the manager's involvement, but **not** terminal for the claimant — see transitions below. |
| `PAID` | Finance has paid it out. **Fully terminal** — no transition leaves this state, for any role. |

### Allowed transitions
```
PARSED ──submit()──────────────▶ SUBMITTED
SUBMITTED ──approve()──────────▶ APPROVED
SUBMITTED ──reject()───────────▶ REJECTED
REJECTED ──resubmit()──────────▶ SUBMITTED      (staff edits and re-files; same claim record, new ClaimEvent + resets approverId if needed)
APPROVED ──markPaid()──────────▶ PAID
```

No other edges exist. In particular:
- `APPROVED ──reject()──▶` is **not allowed** (a decision, once approved, is not reversible by
  rejecting — finance's payout is the only thing that can still happen to it).
- `PAID ──(anything)──▶` is **not allowed**, from any state, by any role. Enforced at the service
  layer (see below), not just by omitting a button.
- `REJECTED` claims can be resubmitted (a reasonable, low-complexity resolution to the open question
  of "what happens to a declined claim" — otherwise a small mistake in a claim would be a dead end
  with no recovery). This is a documented assumption (Section 15).

### Explicit rule enforcement
1. **A manager cannot approve their own claim.**
   Enforced in the `approve()`/`reject()` service function: `if (claim.claimantId === actor.id)
   throw Forbidden`. This is checked in addition to, not instead of, `claim.approverId ===
   actor.id` — so even if `approverId` were ever misassigned, self-approval is still impossible.
   A unit test asserts this directly against the service function (Section 13).
2. **A paid claim cannot move backwards.**
   Enforced centrally: every transition function first loads the claim and checks
   `if (claim.status === 'PAID') throw Conflict("claim is finished")` before evaluating anything
   else. This single guard, plus the state machine only ever being driven through one
   `transition(claim, action, actor)` entry point (never ad-hoc `status` writes elsewhere in the
   codebase), is what makes "paid is terminal" actually true rather than aspirational.
3. **Rejected claims have a sensible flow.** `REJECTED → SUBMITTED` via `resubmit()`, restricted to
   the original claimant, requires the claim to still belong to them, and re-runs duplicate
   detection (since the claimant may have changed the data).

---

## 6. Receipt Parsing Design

Input: raw pasted text from a receipt (whatever the user pastes — one line or many, arbitrary
formatting, "written badly" per the seed data requirement).

Pipeline (pure function `parseReceiptText(text: string): ParsedReceipt`, no side effects, no I/O —
this is what makes it unit-testable):

1. **Normalize**: trim, collapse repeated whitespace, keep original for display but work on a
   normalized copy for extraction.
2. **Amount extraction**: regex sweep for currency-looking tokens — `₹`, `Rs.`, `INR`, or a bare
   number near words like "total", "amount", "paid", "fare" — prefer a number that appears after
   such a keyword; fall back to the largest plausible currency-shaped number in the text if no
   keyword is found. Store the winning match's confidence (keyword-anchored = high, fallback =
   low).
3. **Date extraction**: use `chrono-node` (handles "12 Sep", "12/09/2026", "yesterday", "Sep 12
   2026", etc. — receipts are inconsistent, so a real date-parsing library is worth the dependency
   rather than hand-rolled regex). If no date is found, default to "today" and mark confidence low
   so the user notices it needs checking.
4. **Merchant extraction**: heuristic — usually the first non-empty line of a receipt, or text
   before the first amount/date match; strip trailing noise (GSTIN numbers, phone numbers). Low
   confidence if the heuristic falls back to "first line" with no other signal.
5. **Category inference**: keyword dictionary mapped to the category enum, e.g. `{auto, taxi, uber,
   ola, cab} → Taxi`, `{restaurant, cafe, food, lunch, dinner} → Meals`, `{flight, train, hotel,
   irctc, indigo} → Travel`, `{stationery, printer, courier} → Supplies`; default `Other` if nothing
   matches.
6. **Description**: a short synthesized line (e.g. `"${merchant} — ${category}"`) that the user can
   freely overwrite.
7. Return `{ merchant, date, amount, category, description, confidencePerField, rawText }`.

**Review-before-submit (hard requirement):** the API for parsing (`POST /api/claims/parse`) never
creates a `SUBMITTED` claim directly — it creates/updates a claim in `PARSED` status and returns the
extracted fields to the client, which renders them in an editable form. Only an explicit
`POST /api/claims/:id/submit` call (a second, distinct action, requiring the user to have looked at
the form) moves it to `SUBMITTED`. Low-confidence fields are visually flagged in the UI so users know
what to double check.

This is deliberately a deterministic, dependency-light approach rather than calling an LLM at
request time: it has to work the same way every time for grading/testing, it has zero runtime API
cost or key requirement, and it's fast enough to run synchronously in the request. An LLM-based
parser is listed as a "what I'd do next" item (Section 15/README), not the core path.

---

## 7. Duplicate Receipt Detection

Runs server-side, synchronously, at both parse-time (early warning) and submit-time (authoritative
check), scoped to the **same claimant's** claims from roughly the last **90 days** (covers "same
day" and "three weeks later" with margin, without scanning the whole company's history for every
submission).

Three signals, combined into one score:

1. **Exact hash match** (`EXACT_HASH`): SHA-256 of the normalized receipt text
   (`Receipt.normalizedText`/`textHash`). An exact match against any prior claim in the window is an
   automatic, high-confidence duplicate — score `1.0`. Catches same-day copy-paste re-submission
   trivially and cheaply (indexed lookup, no scanning needed).
2. **Fuzzy text similarity** (`FUZZY_TEXT`): for claims not caught by #1, compute a string
   similarity (Dice's coefficient over character bigrams, or Levenshtein-ratio — simple to implement
   with no new heavy dependency) between the new `normalizedText` and each candidate claim's
   `normalizedText` in the window. This is what catches "typed slightly differently the second
   time." Similarity ≥ **0.85** counts as matched.
3. **Field-based match** (`FIELD_MATCH`): independent of text similarity — same claimant, amount
   equal (or within a small tolerance, e.g. ±₹1 for rounding), expense date within **±3 days**, and
   merchant fuzzy-matched (same similarity technique, lower threshold e.g. ≥0.6, since merchant
   strings are short). This catches cases where the *wording* differs a lot (different OCR/typing)
   but the underlying transaction is clearly the same. This is also what generalizes to the
   "three weeks later" case if the text has drifted enough to dodge signal #2 but the transaction
   facts line up — though the 90-day window plus each signal firing independently is the actual
   mechanism, not a special-cased "weeks later" rule.

**Combining:** any single signal firing is enough to flag (`OR`, not `AND` — false negatives cost
finance real money paid twice; false positives just ask a human to glance at it once). The highest
individual score is stored on `Claim.duplicateScore`; every firing signal is recorded as its own
`DuplicateMatch` row for transparency.

**What happens when flagged:**
- The claim is **not hard-blocked from being filed** — a false positive shouldn't trap a legitimate
  claim with no way through, and only finance/managers, not staff, can definitively know it's a
  real repeat. Instead:
  - At parse/pre-submit time, the staff member sees an inline warning: *"This looks similar to a
    claim you filed on <date> for ₹<amount> at <merchant> — are you sure this isn't the same
    receipt?"* with a link to the earlier claim, and can still proceed if they believe it's genuine
    (e.g. two separate auto rides to the same common vendor).
  - `Claim.duplicateFlag = true` persists into `SUBMITTED`/beyond, and the flag is visibly shown as
    a badge in both the **manager's review queue** and **finance's payout queue** — so a duplicate
    that a staff member pushes through anyway still gets a second and third set of human eyes before
    money moves.
  - **Finance cannot mark a flagged claim paid without an explicit acknowledgement step** (e.g. a
    confirmation dialog: "This claim is flagged as a possible duplicate of claim #123 — pay anyway?")
    — this is the actual point in the lifecycle where the business pain ("finance has paid twice
    before") gets fixed, so the hard friction belongs there, not earlier.
- This is a documented, deliberately chosen policy (flag + surface at every downstream step, hard
  friction only at the money-moving step) rather than a hard block at submission — written up as an
  assumption in the README per Section 15/CLAUDE.md Section 15 item 3.

---

## 8. Monthly Spending

All monthly figures are computed **on the fly** from `Claim` rows (no separate pre-aggregated
table needed at this scale — a materialized summary table is listed as a future-work idea in
Section 15/README if performance ever demanded it).

- **Total monthly spending**: `SUM(amount) WHERE status IN ('APPROVED','PAID') AND
  expenseDate BETWEEN <month start> AND <month end>`. `SUBMITTED`/`REJECTED`/`PARSED` claims are
  excluded from "spend" — they aren't committed money yet (a documented assumption; see Section 15).
- **Spending by employee**: same query, `GROUP BY claimantId`, joined to `User.name`.
- **Spending by category**: same query, `GROUP BY category`.
- **Employee monthly limit**: `User.monthlyLimit`, a single overall figure per user (not
  per-category — the PDF only asks "who has gone over **their** limit", singular, not per-category
  limits). Documented as the chosen interpretation (Section 15).
- **Near their limit**: employees whose current-month approved+paid total is ≥ **80%** of
  `monthlyLimit` but has not yet crossed it — an explicit, named threshold so the seed data and the
  UI have something concrete to demonstrate (Section 9 requires a demo case for this).
- **Over their limit**: current-month approved+paid total > `monthlyLimit`. Note: going over limit
  is **surfaced, not blocked** — the PDF says finance "asks... who has gone over their limit," which
  is a reporting need, not a stated hard cap on filing claims; blocking submission outright is not
  implemented (documented assumption, Section 15).
- Finance's dashboard (Section 10) is the home for all of the above, filterable by month
  (defaulting to the current month).

---

## 9. Synthetic / Demo Data

Seed script (`prisma/seed.ts`) creates a small but realistic, fully-connected demo org — enough to
walk through every feature live in the 3–5 minute video without extra manual setup:

- **Users** (~7–8 total):
  - 1 Finance user (e.g. *Kavya Reddy — Finance*).
  - 2 Managers, each also a claimant (e.g. *Arjun Mehta — Engineering Manager*, *Priya Nair —
    Sales Manager*). One manager reports to the other (or to a designated senior approver) to
    resolve "who approves a manager's own claim" concretely and demonstrably (Section 15 decision).
  - 4–5 Staff members reporting to one of the two managers, realistic Indian names to match the
    "200 rupee auto ride" framing (e.g. *Rohan Gupta, Sneha Iyer, Vikram Singh, Ananya Joshi*), each
    with a `monthlyLimit` (e.g. ₹15,000 for staff, ₹25,000 for managers).
- **Claims**, spread across the current month and the previous month, across all five states, and
  across all four categories, including:
  1. Several ordinary, clean claims (varied categories, realistic merchant names — "Blue Nile Cafe,"
     "Ola," "IRCTC," "Reliance Stationery").
  2. **Badly written receipts** — inconsistent capitalization, abbreviations, missing punctuation,
     e.g. `"OLA CAB TRIP 09/09 fare 187 gst incl"` or `"cafe coffee day 2 cappuccino 1 sandwich total
     rs 340/-"` — used both as realistic data and as literal parser test fixtures.
  3. **A genuine duplicate pair**: the same real-world receipt entered twice by the same staff
     member in visibly different wording (e.g. once as `"Ola auto, MG Road to office, Rs 180"` and
     again three weeks later as `"OLA - MG ROAD TO OFFICE - INR 180.00"`), so the duplicate-flag
     badge has something real to show in the manager/finance queues.
  4. **One employee close to their monthly limit** — approved+paid claims this month totaling ~90%
     of their `monthlyLimit`, and ideally one more still `SUBMITTED` that would tip them over if
     approved, to make the "over limit" report demonstrable too.
  5. At least one `REJECTED` claim with a realistic `decisionNote` (e.g. "missing itemised bill,
     please resubmit with details") to show the reject→resubmit flow.
  6. At least one claim from each manager themselves, approved by the other manager/senior approver,
     to demonstrate the self-approval rule concretely (the UI simply never offers the button, and
     the API rejects it if forced).
- All seed data uses real-sounding names, dates, and amounts — explicitly not `test1`/`test2` style,
  per CLAUDE.md Section 8.

---

## 10. UI / Pages

| Page | Route (indicative) | Purpose |
|---|---|---|
| Demo login | `/login` | Lists seeded users grouped by role (avatar/initials + name + role); one click signs in as that user and sets the session cookie. |
| Staff dashboard | `/dashboard` (role-aware landing page) | For a Staff/Manager acting as claimant: their own claims, grouped/filterable by status, with "still unpaid" total surfaced prominently (direct answer to their stated need in CLAUDE.md Section 2). |
| Create claim | `/claims/new` | Textarea for pasting receipt text (+ optional image upload if the OCR bonus is built) → "Parse" action → shows the editable structured form (merchant/date/amount/category/description) with low-confidence fields highlighted and any duplicate warning inline → "Submit" action. |
| Claim detail | `/claims/[id]` | Full claim record, its status, its audit trail (`ClaimEvent` list), duplicate-match info if flagged, and the correct action buttons for the viewer's role (approve/reject for the assigned manager, mark-paid for finance, resubmit for the claimant if rejected). |
| Manager dashboard | `/manager` | Queue of the manager's direct reports' `SUBMITTED` claims needing review, plus a view of the manager's own filed claims (as a claimant). Duplicate-flag badges shown inline. |
| Manager claim review | (uses `/claims/[id]` with approve/reject actions rendered for the manager) | Approve / Reject with a required note on reject. |
| Finance dashboard | `/finance` | Monthly spend totals, spend by employee, spend by category, near-limit and over-limit employee lists (Section 8), month selector. |
| Finance payment workflow | `/finance/payouts` (or filtered view of `/finance`) | Queue of `APPROVED` claims; "Mark Paid" action per claim, with a confirmation prompt if `duplicateFlag` is set; a "paid" state is final and disappears from this queue once actioned. |

A shared top-nav shows the signed-in user's name/role and a logout action. No role sees a nav entry
for pages they can't use (defense in depth on top of the server-side checks in Section 12).

---

## 11. API / Backend Operations

All endpoints require a valid session; each additionally enforces the role/ownership checks from
Section 4 server-side.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/demo-login` | POST | Body: `{ userId }`. Sets session cookie for a seeded user. |
| `/api/auth/logout` | POST | Clears session. |
| `/api/auth/me` | GET | Current session's user + role, for client components. |
| `/api/claims` | GET | List claims, scoped by role (own for Staff/self-as-claimant, direct-reports' pending for Manager, all for Finance) with status/month filters. |
| `/api/claims` | POST | Create a new claim in `PARSED` status from `{ rawText }` — runs the parser (Section 6) and an early, non-blocking duplicate pre-check (Section 7), returns the parsed+editable fields. |
| `/api/claims/:id` | GET | Full claim detail incl. receipt, audit trail, duplicate matches — scoped to what the caller is allowed to see. |
| `/api/claims/:id` | PATCH | Edit a claim's fields while still `PARSED` (user corrections) or the note on other allowed edits. |
| `/api/claims/:id/submit` | POST | `PARSED → SUBMITTED`. Resolves `approverId`, re-runs the authoritative duplicate check, records a `ClaimEvent`. |
| `/api/claims/:id/approve` | POST | `SUBMITTED → APPROVED`. Requires caller to be the assigned manager **and** `claimantId !== caller.id` (belt-and-braces self-approval guard). |
| `/api/claims/:id/reject` | POST | `SUBMITTED → REJECTED`. Body: `{ note }` (required). Same manager/self-approval guard as approve. |
| `/api/claims/:id/resubmit` | POST | `REJECTED → SUBMITTED`, claimant only. |
| `/api/claims/:id/pay` | POST | `APPROVED → PAID`, Finance only. Guarded by the terminal-state check described in Section 5; if `duplicateFlag` is set, requires `{ acknowledged: true }` in the body or returns a 409 with the duplicate details for the client to show a confirmation dialog. |
| `/api/reports/monthly` | GET | Query params: `month`, optional `employeeId`/`category`. Returns total spend, spend by employee, spend by category, and near/over-limit lists (Section 8). Finance only (Manager-scoped variant optional/nice-to-have). |

---

## 12. Validation and Security

Server-side is the only source of truth; the UI hiding a button is a convenience, never the
enforcement mechanism.

- **AuthN**: every non-auth API route reads the session cookie server-side; missing/invalid session
  → 401. Cookie is httpOnly + signed to prevent client-side tampering with `userId`/`role`.
- **AuthZ (role + ownership), enforced per endpoint**:
  - Create/edit/submit/resubmit a claim: caller must be the claim's `claimantId`.
  - Approve/reject: caller must equal `claim.approverId` **and** `caller.id !== claim.claimantId`
    (explicit self-approval check, independent of how `approverId` was assigned — see Section 5).
  - Mark paid: caller must have `role === 'FINANCE'`.
  - Reading a claim: claimant, assigned manager, or any Finance user; anyone else → 403.
  - Reports endpoint: `role === 'FINANCE'` only (or manager-scoped subset if that variant is built).
- **State machine guard**: a single `transition(claim, action, actor)` function is the *only* code
  path allowed to change `Claim.status` anywhere in the codebase — no route handler sets `status`
  directly. It re-checks the current status from the database (not from client-supplied data) before
  allowing a transition, closing the "resubmitted stale form" race.
- **Input validation**: request bodies validated with a schema library (e.g. Zod) at the top of
  every route handler — reject malformed amounts, dates, missing required fields, empty
  `rawReceiptText`, oversized text, before any business logic runs.
- **Money/number handling**: amounts stored as `Decimal` (via Prisma's `Decimal` type), never as
  floating point, to avoid rounding bugs in a money-handling app.
- **No secrets in the client**: `DATABASE_URL` and any future API keys live only in server-side env
  vars; nothing is exposed to the browser bundle.
- **Rejecting/paying require reasons/confirmation where it matters**: reject requires a note;
  paying a flagged-duplicate claim requires explicit acknowledgement (Section 7/11) — both enforced
  server-side, not just as required form fields.

---

## 13. Testing Strategy

Unit/integration tests (Vitest) target the business rules CLAUDE.md calls out explicitly, written
against the plain `lib/` functions (not through HTTP, so they're fast and don't need a running
server) plus a small number of route-level tests for the authz boundary:

1. **Manager cannot approve own claim** — call `approve(claim, managerActingAsClaimant)` where
   `claim.claimantId === actor.id` and `claim.approverId === actor.id` (simulating a misassigned
   record too) → expect a Forbidden error and no status change.
2. **Paid claim is terminal** — for a `PAID` claim, attempt every transition function
   (`submit`, `approve`, `reject`, `resubmit`, `pay` again) → expect every one to throw/Conflict,
   and `status` to remain `PAID`.
3. **Duplicate receipt detection**:
   - identical text submitted twice same day → flagged via `EXACT_HASH`.
   - same underlying receipt, reworded, submitted weeks apart → flagged via `FUZZY_TEXT` and/or
     `FIELD_MATCH`.
   - two genuinely different receipts with a coincidentally similar amount but different merchant
     and date → **not** flagged (false-positive guard).
4. **Monthly limit calculation** — construct a set of claims across statuses/months for one user;
   assert the "current month spend," "near limit" (≥80%, <100%), and "over limit" (>100%)
   classifications are each correct at their boundary values.
5. **Receipt parsing** — table-driven tests over a handful of realistic and badly-written receipt
   strings (including the seed data's own bad examples), asserting the parser extracts a
   reasonable amount/date/category and doesn't crash on messy input (empty string, no amount found,
   multi-line noise).
6. **Role-based access** — a small set of route-level tests (or direct calls to the
   authorization-check function) confirming: Staff cannot hit approve/pay endpoints; a Manager
   cannot approve a claim outside their team; Finance cannot edit a claim's content; a Manager acting
   on their own claim is rejected even via direct API call, not just hidden in the UI.

Running `npm test` (or `pnpm test`) is the single command to verify all of the above; this is what
"after implementation, run appropriate tests/checks and verify the result" (CLAUDE.md Section 16)
means concretely for this project, and it is what each phase below ends with.

---

## 14. Deployment

**Recommendation: Vercel (app) + Neon (Postgres), both free tier.**

Why this fits a 48-hour take-home specifically:
- **Zero server/infra management** — no Dockerfile, no VM, no manual process supervision to get
  right under time pressure.
- **Git-push deploys** — connecting the GitHub repo to Vercel gives automatic deploys on push,
  including preview URLs per branch/PR, with no separate CI config needed.
- **One deployable unit** — because the architecture (Section 2) is a single Next.js app, there is
  exactly one thing to deploy, not a frontend and a backend that both need to be stood up and wired
  together with the right CORS/env config.
- **Free tier is genuinely sufficient** for a demo-scale app (Neon's free tier Postgres branch,
  Vercel's free hobby tier) — matches CLAUDE.md's "lean on free tiers" guidance directly.
- **Seeding on deploy**: the seed script runs once against the Neon database (via `prisma migrate
  deploy` + `prisma db seed`, run manually from a local machine against the prod `DATABASE_URL`, or
  as a one-off Vercel deployment step) so the deployed URL is demo-ready without the reviewer
  needing to do anything.
- Local run instructions (for the README, per CLAUDE.md Section 10) remain simple regardless: clone,
  `npm install`, set `DATABASE_URL` (a free Neon branch or local Postgres), `npx prisma migrate
  dev`, `npm run seed`, `npm run dev`.

---

## 15. Development Phases

Each phase follows CLAUDE.md's process: inspect the existing project before starting, keep changes
scoped to the phase's objective, and run the relevant tests/checks before moving on.

**Phase 0 — Project scaffold**
- Objective: a running, empty Next.js + TypeScript + Tailwind app, connected to a Neon Postgres
  database via Prisma, deployable to Vercel.
- Files: `package.json`, `next.config.*`, `tsconfig.json`, `tailwind.config.*`, `prisma/schema.prisma`
  (empty/minimal), `.env.example`, base `app/layout.tsx`.
- Acceptance: `npm run dev` serves a placeholder page locally; `npx prisma migrate dev` succeeds
  against a real (empty) database; a first Vercel deploy succeeds and serves the placeholder page.
- Verification: manual load of the local and deployed URLs; no automated tests yet (nothing to test).

**Phase 1 — Data model**
- Objective: implement the full Prisma schema from Section 3 and run the first migration.
- Files: `prisma/schema.prisma` (full), generated migration.
- Acceptance: `npx prisma migrate dev` succeeds; Prisma Studio (or equivalent) shows all tables with
  correct relationships.
- Verification: a small smoke script creating one `User` and one `Claim` end-to-end via Prisma
  Client confirms the schema is usable, then is deleted (not left as project debris).

**Phase 2 — Demo auth & session**
- Objective: `/login` page, `/api/auth/*` routes, session cookie, and role-aware route middleware.
- Files: `app/login/`, `app/api/auth/`, `middleware.ts` or per-route guards, `lib/session.ts`.
- Acceptance: signing in as a seeded user (once Phase 3 provides seed data) sets a session and
  redirects to the correct role landing page; hitting a protected route while logged out redirects
  to `/login`.
- Verification: manual click-through for all three roles; a couple of unit tests on the session
  helper (encode/decode/tamper-detection).

**Phase 3 — Seed data**
- Objective: `prisma/seed.ts` producing the full synthetic dataset from Section 9.
- Files: `prisma/seed.ts`, `package.json` seed script wiring.
- Acceptance: `npm run seed` populates users across all three roles, claims across all five states
  and four categories, the intentional duplicate pair, the near-limit employee, and badly-written
  receipt text, all with realistic names/values.
- Verification: a short script/assertions confirming expected row counts and the presence of the
  specific demo scenarios (duplicate pair exists, near-limit employee exists) — this becomes part of
  the automated test suite so a future change can't silently break the demo data's shape.

**Phase 4 — Receipt parser (Section 6)**
- Objective: `lib/parser.ts` implemented and unit-tested in isolation, no UI/API wiring yet.
- Files: `lib/parser.ts`, `lib/parser.test.ts`.
- Acceptance: parser produces reasonable structured output for the seed data's realistic and
  badly-written receipt strings, and degrades gracefully (no throw) on edge cases (empty string, no
  recognizable amount).
- Verification: `npm test` — table-driven parser tests (Section 13 item 5) pass.

**Phase 5 — Duplicate detector (Section 7)**
- Objective: `lib/duplicates.ts` implemented and unit-tested in isolation.
- Files: `lib/duplicates.ts`, `lib/duplicates.test.ts`.
- Acceptance: correctly flags the exact-duplicate, reworded-duplicate, and weeks-apart cases from
  Section 13 item 3, and does not flag genuinely different claims.
- Verification: `npm test` passes for this module.

**Phase 6 — Claim state machine + core claim APIs**
- Objective: `lib/claims.ts` (the single `transition()` entry point + create/parse/edit functions),
  wired into `/api/claims*` route handlers, using the Phase 4/5 modules.
- Files: `lib/claims.ts`, `app/api/claims/`, `lib/claims.test.ts`.
- Acceptance: full lifecycle is exercisable via API calls — create → parse → edit → submit →
  approve/reject → resubmit (if rejected) → pay; self-approval and post-paid transitions are
  rejected as designed.
- Verification: `npm test` — state machine + self-approval + terminal-paid tests (Section 13 items
  1–2) pass; a manual `curl`/REST-client run through the full lifecycle against the seeded data.

**Phase 7 — Staff-facing UI**
- Objective: `/dashboard`, `/claims/new`, `/claims/[id]` (claimant view) built against the Phase 6
  APIs.
- Files: corresponding `app/` route folders and components.
- Acceptance: a staff user can log in, paste a realistic (including badly-written) receipt, see and
  correct the parsed fields, see a duplicate warning when applicable, submit, and see it appear
  correctly in "still unpaid."
- Verification: manual click-through covering a clean claim and the seeded duplicate scenario; no
  console/server errors.

**Phase 8 — Manager & Finance UI**
- Objective: `/manager`, `/finance`, `/finance/payouts`, and the approve/reject/pay actions on
  `/claims/[id]`.
- Files: corresponding `app/` route folders and components.
- Acceptance: a manager can approve/reject their team's claims (and cannot approve their own, even
  by direct navigation); finance can pay approved claims (with the duplicate-acknowledgement prompt
  where relevant) and view the monthly/category/limit reports (Section 8) with correct, seeded
  numbers.
- Verification: manual click-through of the full three-role lifecycle end to end using the seed
  data's specific demo scenarios (self-approval attempt, duplicate pay-out attempt, near/over-limit
  report).

**Phase 9 — Polish, edge cases, and stretch (time-permitting)**
- Objective: tighten validation error messages, empty states, loading states; address the edge
  cases named in CLAUDE.md's Implementation Principles (no manager assigned, month-boundary claims,
  malformed pasted text); attempt the OCR/photo-receipt bonus only if time remains, as an additive
  input path into the existing Phase 4 parser (not a new parallel system).
- Files: touch-ups across existing files; new `lib/ocr.ts` + an upload control only if attempted.
- Acceptance: no unhandled errors surface in the UI for the named edge cases; bonus, if attempted, is
  demoable but does not block or destabilize the core flow.
- Verification: `npm test` still green; manual pass over the edge-case list.

**Phase 10 — Deployment, README, and demo readiness**
- Objective: deployed Vercel URL backed by a seeded Neon database; README covering the four required
  sections (Section 10 of CLAUDE.md); final check that the deployed app matches local behavior.
- Files: `README.md`, `.env.example` finalized, any deployment config.
- Acceptance: the deployed URL is reachable, seeded, and walkable through the full demo script cold
  (no local setup) — this is what the 3–5 minute video will actually show.
- Verification: a full run-through against the **deployed** URL (not just local) covering every
  scenario named in Section 9's seed data.

---

## 16. Assignment Ambiguity Decisions

For each open question from CLAUDE.md Section 15, the practical decision to implement:

1. **Who approves a manager's own claim?**
   **Decision:** managers can have a `managerId` too (self-referential hierarchy already supports
   this — Section 3.1). Seed data gives one manager a senior/second manager as their approver. Simple
   to implement (no new schema), easy to explain ("managers can report to another manager, same as
   staff do"), and directly demonstrable via the seeded self-approval-attempt scenario.

2. **What exactly is a "monthly limit"?**
   **Decision:** one overall figure per user (`User.monthlyLimit`), not per-category. Matches the
   PDF's literal wording ("gone over **their** limit") and keeps the reporting logic and the seed
   data simple to reason about and show in a few minutes of video.

3. **Duplicate detection mechanism and threshold — block or flag?**
   **Decision:** flag-and-surface everywhere downstream, hard-confirmation only at the pay step
   (Section 7). Simple to justify in the README (a false positive shouldn't lock out a legitimate
   claim; the real damage — double payment — is prevented at the one point money actually moves),
   and it's the most demoable option: the video can show the badge appearing, then show finance
   being stopped from paying it silently.

4. **Claim states beyond what's implied — is there a `REJECTED` state, and what happens after?**
   **Decision:** yes, `REJECTED` exists, and a rejected claim can be edited and resubmitted by the
   claimant (`REJECTED → SUBMITTED`). Minimal additional complexity (one more enum value, one more
   transition function) and avoids a dead-end state that would look unfinished on camera.

5. **Expense categories — fixed list or open?**
   **Decision:** a fixed enum: `Travel`, `Meals`, `Supplies`, `Taxi`, `Other`. The first four are
   named directly in the PDF; `Other` is added only as a safety net for the parser/category-report,
   not as an invitation to scope-creep the category list. Simple, and matches the "under which
   category" reporting requirement cleanly (a fixed set of GROUP BY buckets).

6. **Currency/locale.**
   **Decision:** INR (₹) throughout, matching the PDF's own example ("200 rupee auto ride") and
   making the synthetic data naturally realistic without inventing an unstated locale.

7. **Who assigns staff to managers, and is it fixed or manageable in-app?**
   **Decision:** fixed at seed time only (`User.managerId` set by the seed script); no admin UI to
   reassign reporting lines is built. Org-chart management is a real feature but adds a whole new
   permission surface (who's allowed to reassign whom) that the PDF never asks for — out of scope,
   named explicitly as a "next week" item in the README.

8. **Timing/mechanics of finance payout — manual per-claim, or batch?**
   **Decision:** manual per-claim ("Mark Paid" button per approved claim), not a batch end-of-month
   job. Simpler to implement correctly and to demonstrate individually in the video (including the
   duplicate-confirmation interaction); a "pay all approved this month" batch action is named as a
   natural "next week" enhancement, not built now.

9. **Photo/screenshot receipt input (bonus).**
   **Decision:** explicitly deferred to Phase 9 / stretch, attempted only if the core scope (Phases
   0–8) is fully done and tested with time remaining, and even then implemented as an additive input
   path into the same text parser (an OCR step that produces text, then reuses Section 6 verbatim)
   rather than a second parsing system. This keeps the bonus from ever risking the required core
   deliverable, which is the higher-priority instruction in CLAUDE.md.

10. **Auth approach (raised during this planning pass, not originally in CLAUDE.md Section 15).**
    **Decision:** demo "sign in as" picker over seeded users, no real password/identity system
    (Section 1, Section 2). Named here because it's a decision the reviewer will notice immediately
    on opening the deployed URL, and it needs to be written up in the README as clearly as the other
    nine.

All ten decisions above will be written into the README's "decisions and assumptions" section
verbatim (in plain language) as required by CLAUDE.md Section 10.
