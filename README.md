# Expense Claims

A working expense claims system: staff paste raw receipt text, the system turns it into a
structured claim, a manager signs it off, and finance pays it out — with duplicate-receipt
protection and monthly spend visibility built in from the start.

Built for the "Build Task 02 — Expense Claims" take-home assignment.

---

## 1. Overview

Staff at a company spend their own money on travel, meals, supplies and taxis, then claim it
back. This application implements that whole loop end to end:

1. A staff member pastes whatever text is on their receipt.
2. The system parses it into a structured claim (merchant, date, amount, category) and shows
   the result back for review before anything is sent onward.
3. The staff member corrects anything the parser got wrong and submits.
4. Their manager reviews it, and either approves or rejects it (with a required reason).
5. Finance reviews approved claims, acknowledges any duplicate-receipt warning if one exists,
   and pays it out (simulated — no real money moves).

There are three roles:

- **Staff** — files claims, tracks what's still unpaid.
- **Manager** — reviews their team's claims and signs them off. Managers spend money too, so a
  manager is *also* a staff member for their own claims — but can never approve their own claim.
- **Finance** — pays out approved claims and monitors monthly spend across the company.

Every business rule (who can do what, which state transitions are legal, whether a claim looks
like a duplicate) is enforced **server-side**, in one domain service — never just hidden behind a
UI button.

---

## 2. Key Features

- **Messy receipt text parsing** — paste one line or several, in whatever format the receipt was
  actually written in; the parser degrades gracefully rather than failing.
- **Employee review/correction** — every parsed field is shown back before submission, labeled
  "Extracted from receipt" vs. "Corrected by you/employee" once edited.
- **Full claim lifecycle** — `PARSED → SUBMITTED → APPROVED/REJECTED → PAID`, with
  `REJECTED → SUBMITTED` resubmission.
- **Manager approval/rejection**, with a required reason on rejection.
- **Self-approval prevention** — enforced server-side, independent of any UI, even if the
  request is sent directly.
- **Duplicate receipt detection** — same-day, weeks-apart, and reworded duplicates are all
  caught by a hybrid detector.
- **Duplicate acknowledgement before payment** — a flagged claim can still be filed and approved,
  but Finance must explicitly acknowledge the warning before it can be paid.
- **Simulated payment** — no real payment gateway; marking a claim paid is an internal,
  authorized state change.
- **Terminal PAID state** — once paid, a claim can never transition again, for any role.
- **Monthly employee spending** — who spent what, this month, per person.
- **Category spending** — spend broken down by Travel/Meals/Supplies/Taxi/Other.
- **Near/over-limit monitoring** — surfaced to Finance and Managers; never blocks filing a claim.
- **Full audit history** — every state change and key action is recorded as an append-only
  `ClaimEvent`, visible on every role's claim detail page.
- **Realistic seeded demo data** — real-sounding names, messy receipts, an intentional duplicate
  pair, a near-limit employee, and a rejected claim, ready to demo without manual setup.

---

## 3. Tech Stack

| Concern | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org/) 16 (App Router) |
| Language | TypeScript |
| UI | React 19 + Tailwind CSS |
| Database | PostgreSQL (developed against [Neon](https://neon.tech), serverless Postgres) |
| ORM | [Prisma](https://www.prisma.io/) |
| Date parsing | [chrono-node](https://github.com/wanasit/chrono) (used inside the receipt parser) |
| Testing | [Vitest](https://vitest.dev/) + React Testing Library |
| Intended deployment | [Vercel](https://vercel.com/) (app) + Neon (database) |

No other backend framework, no separate API server, no charting library, and no external
AI/LLM API is used at runtime — the receipt parser and duplicate detector are both deterministic,
dependency-light TypeScript modules (see Sections 6–7).

---

## 4. Architecture

```
Browser / UI
     ↓
Next.js App Router
  ├─ Server Components  — pages read data directly via the domain service (no HTTP hop)
  └─ Route Handlers      — app/api/**, called by client components and for role/state changes
     ↓
Server-side claim service / domain layer  (lib/claim-service.ts)
     ↓
Prisma Client
     ↓
PostgreSQL (Neon)
```

A single Next.js application handles both the UI and the API — there's no separate backend
service to deploy or wire up.

- **API routes are thin.** Every route handler in `app/api/**` does exactly three things:
  authenticate the request, parse/validate the request body, and call one function in the
  domain service. No business logic lives in a route handler.
- **Business rules live in one place** — `lib/claim-service.ts`. Every write to a claim's status
  goes through a single `applyTransition()` function, which is the *only* code path allowed to
  change `Claim.status` anywhere in the codebase. That's what makes "PAID is terminal" and
  "no skipping states" actually true, not just documented.
- **Authorization is server-side.** Every list/detail/action function in the domain service
  re-checks the caller's role and ownership itself — a Staff user hitting an approval endpoint
  directly gets a 403, regardless of what the UI shows.
- **The claim state machine** (`lib/claim-state-machine.ts`) is the single source of truth for
  which status transitions are legal; the service layer asks it before ever writing a status.
- **Audit events** (`ClaimEvent`, one row per action) are written inside the same transaction as
  every state change, so the audit trail can never drift from what actually happened.
- **The duplicate detector** (`lib/duplicate-detector.ts`) and **receipt parser**
  (`lib/receipt-parser.ts`) are both pure, side-effect-free modules the service layer calls into —
  independently unit-tested, with no knowledge of HTTP or the database.
- **Server Components** are used for every server-side read (dashboards, claim lists, claim
  detail pages) — they call the domain service directly, with no client-side fetch waterfall.
  Only the interactive pieces (the parse/review/submit flow, approve/reject, acknowledge/pay) are
  client components, and even those only ever call the same API routes described above.

---

## 5. Claim Lifecycle

```
PARSED ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──pay──▶ PAID
                        │
                        └──reject──▶ REJECTED ──resubmit──▶ SUBMITTED
```

- **`PARSED`** — a draft: the receipt text has been parsed, the staff member is still
  reviewing/correcting it. Not visible to their manager yet.
- **`SUBMITTED`** — confirmed and filed; pending the assigned manager's review.
- **`APPROVED`** — manager signed off; awaiting Finance payout.
- **`REJECTED`** — manager declined it, with a required reason. Not a dead end — the claimant can
  correct it and resubmit, which moves it back to `SUBMITTED`.
- **`PAID`** — Finance has paid it out. **Fully terminal.** No transition leaves this state, for
  any role, under any circumstance.

**Invalid transitions are rejected**, not just discouraged — every transition is checked against
an explicit allow-list before it's applied, and the underlying database write is a conditional
`UPDATE ... WHERE status = <expected>`, so even two concurrent requests racing to change the same
claim can't both succeed.

**A manager can never approve or reject their own claim.** This is checked explicitly and
unconditionally — before anything else — every time an approve/reject action runs, independent of
whatever the claim's assigned approver happens to be.

---

## 6. Receipt Parsing

The flow: a user pastes whatever text is on their receipt → the system parses it → the parsed
result is shown back to them, editable, before it goes anywhere near their manager.

- Extraction targets **merchant, date, amount, and category**, using regex/keyword heuristics for
  merchant/amount/category and [`chrono-node`](https://github.com/wanasit/chrono) for date
  parsing (receipts write dates in every format imaginable — a real date-parsing library earns
  its keep here).
- Every parse also produces a **confidence score** and a list of **human-readable warnings**
  (e.g. "Could not determine the expense date"), both stored and shown back to the reviewer —
  visible to the employee at review time, and to the Manager/Finance reviewer later.
- The employee **reviews and corrects** the parsed fields before submitting; corrected fields are
  visibly labeled differently from untouched, parser-extracted ones, both at submission time and
  later on the Manager/Finance detail pages.

**This is deterministic, rule-based parsing — not an external LLM call.** No AI API is invoked at
request time to parse a receipt. That's a deliberate choice: it behaves identically every time
(important for testing and demoing), has no per-request cost or external dependency, and runs
synchronously fast enough to not need a loading spinner.

---

## 7. Duplicate Detection

Runs server-side at both creation and submission time, scoped to the **same claimant's** claims
within a **30-day** candidate window around the new claim's expense date (comfortably covers the
brief's "sometimes three weeks later" example, without scanning the whole company's history on
every submission).

Three independent signals, any one of which is enough to flag a claim:

1. **Exact hash match** — SHA-256 of the normalized (lowercased, whitespace-collapsed,
   punctuation-stripped) receipt text, compared against every candidate. Catches an identical
   same-day resubmission cheaply and immediately.
2. **Fuzzy text similarity** — Dice's coefficient over character bigrams between the new and
   candidate normalized text. This is what catches "typed slightly differently the second time."
3. **Field match** — same claimant, amount equal (within a small rounding tolerance), expense
   date within a tight ±3-day window, and merchant fuzzy-matched. Catches cases where the wording
   differs a lot but the underlying transaction is clearly the same.

**A flagged claim is never blocked from being filed or approved** — a false positive shouldn't
trap a legitimate claim with no way through. Instead, the flag follows the claim visibly through
manager review and into Finance's queue. **The one hard stop is at payment**: Finance cannot mark
a flagged claim as paid until they've explicitly acknowledged the warning — that's the actual
point in the lifecycle where a double payment would happen, so that's where the friction belongs.

---

## 8. Roles & Permissions

| Action | Staff | Manager | Finance |
|---|:---:|:---:|:---:|
| Create/paste receipt → parse → review/correct → submit own claims | ✅ | ✅ (also a claimant) | ❌ |
| View own claims | ✅ | ✅ | — |
| Resubmit a rejected claim of their own | ✅ | ✅ | — |
| Review claims assigned to them / their team | ❌ | ✅ | — |
| Approve / reject a claim | ❌ | ✅ (never their own) | ❌ |
| View claims required for payment | ❌ | ❌ | ✅ |
| Acknowledge a duplicate-receipt warning | ❌ | ❌ | ✅ |
| Pay an approved claim | ❌ | ❌ | ✅ |
| Monthly spending monitoring (employee/category/limits) | ❌ | (team-level summary) | ✅ (org-wide) |

Every row above is enforced in the server-side domain service, not just by hiding a button.

---

## 9. Monthly Spending Logic

- **Committed spending** = `APPROVED + PAID` — money that will or did leave the company.
- **Pending** = `SUBMITTED` — filed but not yet decided; not counted as spend yet.
- **Not committed** = `PARSED` (still a draft) and `REJECTED` (declined) — excluded entirely.

Reported two ways:

- **Employee totals** — committed/pending/remaining/utilization per person, this month.
- **Category totals** — committed spend broken down across Travel/Meals/Supplies/Taxi/Other, with
  each category's share of the month's total.

**Near-limit** is ≥80% of an employee's monthly limit (and not yet over it); **over-limit** is
anything past 100%. Both are **surfaced for monitoring only** — nobody is blocked from creating
or submitting a claim because of their limit; going over is something Finance is told about, not
something the system prevents.

The seed data includes a deliberate near-limit demo case: **Sneha Iyer**, at roughly ₹13,500 of
her ₹15,000 monthly limit.

---

## 10. Demo Users

There are no passwords. `/login` lists every seeded user grouped by role — click "Sign in" next
to a name to sign in as them.

| Name | Role | Reports to |
|---|---|---|
| Kavya Reddy | Finance | — |
| Arjun Mehta | Manager | — (top of the hierarchy) |
| Priya Nair | Manager | Arjun Mehta |
| Rohan Gupta | Staff | Arjun Mehta |
| Sneha Iyer | Staff | Arjun Mehta |
| Vikram Singh | Staff | Priya Nair |
| Ananya Joshi | Staff | Priya Nair |
| Meera Krishnan | Staff | Priya Nair |

Both managers are claimants too — a manager's own claims route to the *other* manager for
approval, which is exactly how the self-approval rule gets demonstrated.

---

## 11. Getting Started

### Prerequisites

- Node.js (v18.18+ recommended for Next.js 16)
- A PostgreSQL database — a free [Neon](https://neon.tech) branch is what this project was
  developed against, but any reachable Postgres instance works

### Install

```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

### Configure environment

Copy `.env.example` to `.env` and fill in real values:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
SESSION_SECRET="<a random secret — see .env.example for how to generate one>"
```

Never commit a real `.env` file — it's already excluded via `.gitignore`.

### Seed the demo data

```bash
npm run seed
```

This wipes and recreates the full demo dataset described in Section 10, deterministically, every
time it's run.

### Run it

```bash
npm run dev
```

Then open **http://localhost:3000** and sign in as any seeded user from `/login`.

### Tests and build

```bash
npm test         # runs the full automated test suite
npm run build    # production build
```

---

## 12. Database / Prisma

- Schema lives in `prisma/schema.prisma`; the full history of changes is in `prisma/migrations/`.
- `npx prisma migrate deploy` applies existing migrations without prompting to create new ones —
  the right command for setting up an existing project (use `npx prisma migrate dev` instead if
  you're actively changing the schema locally).
- The database is real PostgreSQL throughout — no SQLite/local-file shortcut — so the same
  connection string shape works locally (a Neon branch, or any local Postgres) and in production.
- `prisma/seed.ts` populates a small, realistic, fully-connected demo org (Section 10) rather than
  placeholder rows — see Section 15 for why.
- No credentials are stored anywhere in the schema or seed script; both read the connection string
  from `DATABASE_URL` at runtime.

---

## 13. Testing

**Current verified result: 346 tests passing across 25 test files.**

```
npm test
```

Coverage spans three layers:

- **Unit tests** — the receipt parser, duplicate detector, claim state machine, and small format/
  UI-decision helpers, each tested in isolation as pure functions.
- **Service/domain tests** — `lib/claim-service.ts` (the largest test file), covering every
  business rule explicitly: self-approval rejection, terminal-PAID enforcement, duplicate flagging
  and acknowledgement gating, authorization scoping per role, and monthly-spend calculations at
  their boundary values.
- **UI/component tests** — React Testing Library tests for the claim-review flow, approve/reject
  and acknowledge/pay panels, list/table components, and status/duplicate-warning displays.

In addition, **real database and real HTTP verification was performed during development** for
every phase of the build — signing in as actual seeded users, exercising the full create → parse
→ submit → approve/reject → acknowledge → pay lifecycle against a live Postgres database, and
confirming authorization boundaries by calling protected endpoints directly as the wrong role.
Those verification scripts were intentionally temporary and were deleted after each phase (per the
project's own working process) — **they are not included in this repository**; `npm test` and
`npm run build` are the durable, repeatable checks a reviewer can run themselves.

---

## 14. Security / Authorization

- **Session**: a signed, `httpOnly` cookie (HMAC-SHA256 via the Web Crypto API) carrying only a
  user ID — never a role. Tampering with the cookie fails signature verification and is treated
  as "not signed in," not as a way to change identity or role.
- **Role is always re-derived server-side** from the database on every request, keyed off the
  verified cookie's user ID — a client can never assert its own role.
- **Server-side authorization everywhere**: every list/detail/action function in the domain
  service checks the caller's role and ownership itself, independent of the UI. UI-side "can this
  user see this button" helpers exist purely for a clean UX and are explicitly documented in code
  as defense-in-depth only — never the actual enforcement.
- **Self-approval is blocked server-side**, unconditionally, before any other check runs.
- **Staff** can only ever see/act on their own claims (query-level scoping, not filtered client-side).
- **Managers** are scoped to claims assigned to them or belonging to their direct reports.
- **Finance** has read access across all claims (needed for payment and monthly reporting) but no
  approve/reject authority at all.
- **Secrets** (`DATABASE_URL`, `SESSION_SECRET`) live only in environment variables, never in
  source, and `.env` is excluded from Git via `.gitignore` (confirmed — see Section 21's Git
  hygiene note).

**This is a demo authentication flow built for this assignment — not a production-grade identity
system.** There's no password, no MFA, no email verification, and no external identity provider.
It's explicitly a "pick a seeded user" sign-in, documented as such on the `/login` page itself.

---

## 15. Design Decisions & Assumptions

The brief deliberately leaves a number of things open ("decide for yourself what the software
should do about each"). The choices actually made:

- **Deterministic, rule-based receipt parsing**, not an external LLM — predictable, testable,
  zero runtime API cost or key requirement.
- **Duplicate detection is hybrid** — exact hash + fuzzy text + field matching combined, rather
  than any single technique, to catch same-day, reworded, and weeks-apart duplicates alike.
- **A flagged duplicate never blocks filing or approval** — only payment is hard-gated, and only
  once Finance has explicitly acknowledged the warning.
- **The duplicate candidate window is 30 days** (not the ~90 days floated in early planning notes)
  — comfortably covers the brief's "three weeks later" example without over-scanning history.
- **Monthly limit is a monitoring/reporting figure only** — it never blocks claim creation or
  submission; going over it is something Finance is told about, not prevented.
- **Payment is simulated** — marking a claim `PAID` is an internal, authorized state change; no
  real payment gateway is integrated (explicitly not required by the brief).
- **Managers can file and submit their own claims** — a manager's claim routes to another manager
  for approval, since a manager can never be their own approver.
- **Self-approval is forbidden server-side**, unconditionally.
- **`PAID` is fully terminal** — no role, under any circumstance, can move a claim out of it.
- **Currency is INR throughout**, matching the brief's own "200 rupee auto ride" framing.
- **Seed data is realistic**, not `test1`/`test2` placeholder rows — real-sounding names, messy
  receipt text, an intentional duplicate pair, and a near-limit employee.
- **OCR / photo-receipt input is deferred** — the brief calls it an explicit "plus," not a
  requirement, and it was not attempted in the time available (see Section 17).

---

## 16. AI Tools Used

Full transparency, as the assignment asks:

- **Claude Code** was used extensively throughout implementation — writing application code
  (the Next.js app, the domain service, the receipt parser and duplicate detector, the UI
  components), writing and running the automated test suite, and running real database/HTTP
  verification against a live Postgres instance during development.
- **ChatGPT** was used for planning and architecture review, phase-by-phase planning, prompt
  drafting and review, debugging guidance, and preparing this final submission.
- AI assistance was used across implementation, testing strategy, code review, documentation
  planning, and verification guidance throughout the build.

This was not a blind, unreviewed generation process. Implementation decisions were reviewed and
verified at each stage — through the automated test suite (346 tests), through `npm run build`
passing cleanly, and through real database/HTTP verification exercising the actual application
against real seeded data (see Section 13). Business-rule correctness (self-approval prevention,
terminal-PAID enforcement, duplicate-acknowledgement gating, authorization boundaries) was
specifically and repeatedly checked, not just assumed from generated code.

---

## 17. Known Limitations

- **Demo authentication, not a production identity system** — no passwords, MFA, or external
  identity provider (see Section 14).
- **Payment is simulated** — no real payment gateway is integrated.
- **OCR / image receipt input is not implemented** — only pasted text is supported today (the data
  model has an unused `IMAGE_OCR` source-type placeholder for this, but no parsing path uses it).
- **No external payment gateway integration.**
- **No email or notification system** — status changes are visible in-app only; nobody is
  emailed when their claim is approved, rejected, or paid.
- **A top-of-hierarchy manager with no manager of their own cannot submit a *new* claim** under
  the current approver-assignment rule (a claim always routes to the claimant's own manager; a
  manager with `managerId = null` has nowhere for a new claim to route to). In the seed data this
  is resolved by giving the top manager a senior peer as their approver; the underlying rule would
  need a fallback (e.g. a designated senior/admin approver) to handle a *newly created* account at
  the very top of a real org chart.

---

## 18. What I Would Do With Another Week

1. **Production authentication/SSO and stronger RBAC** — replace the demo sign-in with a real
   identity provider and tighten role/permission management around it.
2. **OCR/image receipt support** — accept a photo or screenshot, feeding OCR output into the same
   existing text parser (additive, not a parallel system).
3. **Better duplicate detection** — configurable thresholds, and a manager/finance-facing way to
   dismiss a false positive with a recorded reason.
4. **Real payment integration** with idempotency controls, replacing the simulated payout.
5. **Notifications/email** — notify a claimant when their claim is approved, rejected, or paid;
   notify a manager when something needs their review.
6. **More advanced reporting/export** — CSV/PDF export of monthly reports, date-range comparisons.
7. **Observability/audit improvements** — structured logging, and a dedicated audit view for
   security-relevant events (logins, permission denials).
8. **More comprehensive end-to-end tests** — a browser-automated (e.g. Playwright) suite running
   against a real dev server, to complement the current unit/service/component test suite.

---

## 19. Deployment

**Deployment target:** Vercel (application) + Neon PostgreSQL (database) — matches the brief's
stated preference for a deployed URL over something that has to be run locally, and both have
sufficient free tiers for a demo of this size.

**Live Demo:** TBD — this project has not yet been deployed. We will update this section with the
live URL once it is.

Until then, see Section 11 for local setup — everything works identically locally against a real
Postgres database (a free Neon branch or otherwise).

---

## 20. Demo Scenarios

Everything below is present in the seeded data and demonstrable immediately after `npm run seed`,
with no manual setup:

- **Messy receipt parsing** — several seeded claims use deliberately badly-written receipt text
  (inconsistent capitalization, abbreviations, missing punctuation) to show the parser handling
  real-world input, not clean examples.
- **Ananya's duplicate receipt pair** — the same Ola auto-ride receipt filed twice, three weeks
  apart, worded differently the second time — the scenario the duplicate detector exists for.
- **Sneha's near-limit spending** — ~₹13,500 of her ₹15,000 monthly limit, visible on both her own
  dashboard and Finance's monthly spending view.
- **Vikram's rejected claim and resubmission** — a claim rejected with a realistic reason
  ("missing itemised bill"), which he can correct and resubmit, with the rejection still visible
  in the claim's history afterward.
- **Manager self-approval prevention** — sign in as either manager, open one of their own claims,
  and note there is no approve/reject action available to them for it (and the API refuses it too,
  if attempted directly).
- **Finance duplicate acknowledgement and payment** — approve a flagged claim as a manager, then
  sign in as Finance and see payment blocked until the duplicate warning is explicitly
  acknowledged, after which payment succeeds and the claim becomes terminal.

---

## 21. Assignment Deliverables

- **GitHub repository:** https://github.com/Fareed2428/Expense_Claims
- **Live Demo:** TBD
- **Demo Video:** TBD

*(Git hygiene note: `.env`, `node_modules`, build/cache directories, and this project's local
Claude Code session state are all excluded via `.gitignore` — no secrets or credentials are
committed to this repository.)*

---

## 22. License / Assignment Note

This project was built as a take-home assignment submission and is not published under an open-
source license. All rights are retained by the author; please don't reuse this code without
permission.

