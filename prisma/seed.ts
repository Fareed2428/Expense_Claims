/**
 * Realistic synthetic/demo data for the Expense Claims app.
 *
 * Run with: npm run seed
 *
 * Idempotent by design: every run wipes the existing demo dataset (in FK
 * dependency order) and recreates it from scratch, rather than trying to
 * diff/upsert against whatever's already there. For a demo database this
 * is simpler and more reliable than incremental seeding, and it means
 * "run it again" always produces the exact same, known-good dataset.
 *
 * Dates are computed relative to the day the seed is run (see the date
 * helpers below), not hardcoded — so "current month" and "previous month"
 * claims stay meaningful no matter when this is run, instead of quietly
 * becoming stale.
 *
 * This phase does NOT implement receipt parsing or duplicate detection.
 * Receipt.normalizedText/textHash are still populated (the schema
 * requires them, and Phase 5's detector needs real input to work
 * against), using a small local normalize+hash helper — not the actual
 * detector. Receipt.parsedMerchant/parsedDate/parsedAmount/parsedCategory
 * are filled in as "what a parser would plausibly have produced" (mostly
 * matching the claim, with lower parseConfidence on the deliberately
 * messy receipts) — again just seed data, not parsing logic.
 */

import { createHash } from "node:crypto";
import {
  PrismaClient,
  type ExpenseCategory,
  type ClaimStatus,
  type User,
} from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Date helpers — everything is computed relative to "today" (seed run time),
// never hardcoded, and never allowed to land in the future.
// ---------------------------------------------------------------------------

const today = new Date();
today.setHours(12, 0, 0, 0); // noon, to dodge timezone/DST edge cases

function daysAgo(n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
}

/** A day in the current calendar month — clamped so it's never after today. */
function currentMonthDay(day: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), Math.min(day, today.getDate()));
  d.setHours(12, 0, 0, 0);
  return d;
}

/** A day in the previous calendar month (capped at 28 to dodge month-length issues). */
function previousMonthDay(day: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(day, 28));
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * Advances a lifecycle chain by `deltaMs` from `previous`, but never past
 * "today" and never *before* `previous` — i.e. always monotonically
 * non-decreasing. This matters close to the start of a month: computing
 * every step independently from its own unclamped "base + delta" (as an
 * earlier version of this helper did) could clamp a later step to a
 * timestamp *earlier* than an already-passed unclamped one, producing an
 * impossible (out-of-order) event history once expenseDate lands close to
 * today. Chaining every step through the previous one's already-clamped
 * value rules that out entirely.
 */
function advance(previous: Date, deltaMs: number): Date {
  const candidate = new Date(previous.getTime() + deltaMs);
  if (candidate > today) return new Date(today);
  if (candidate < previous) return new Date(previous);
  return candidate;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const advanceDays = (previous: Date, days: number) => advance(previous, days * ONE_DAY_MS);
const advanceMinutes = (previous: Date, minutes: number) => advance(previous, minutes * 60_000);

// ---------------------------------------------------------------------------
// Receipt text helpers (normalize + hash) — deliberately simple. This is
// seed data preparation, not the Phase 5 duplicate detector.
// ---------------------------------------------------------------------------

function normalizeReceiptText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashReceiptText(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// Reset — deterministic re-seeding. Delete in FK-dependency order.
// ---------------------------------------------------------------------------

async function resetDemoData() {
  await prisma.claimEvent.deleteMany();
  await prisma.duplicateMatch.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.user.deleteMany();
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function seedUsers() {
  const kavya = await prisma.user.create({
    data: {
      name: "Kavya Reddy",
      email: "kavya.reddy@meridianworks.in",
      role: "FINANCE",
      monthlyLimit: "0.00", // Finance doesn't file claims in this model — see CLAUDE.md's role table.
    },
  });

  // Arjun is the top of the (small) management chain here — no manager of
  // his own. His own claims are approved by Priya instead (see the
  // manager-self-approval scenario below): CLAUDE.md's open question on
  // "who approves a manager's own claim" explicitly allows "another
  // manager," and that's the sensible choice once you're at the top with
  // no manager to escalate to.
  const arjun = await prisma.user.create({
    data: {
      name: "Arjun Mehta",
      email: "arjun.mehta@meridianworks.in",
      role: "MANAGER",
      monthlyLimit: "25000.00",
    },
  });

  const priya = await prisma.user.create({
    data: {
      name: "Priya Nair",
      email: "priya.nair@meridianworks.in",
      role: "MANAGER",
      managerId: arjun.id,
      monthlyLimit: "25000.00",
    },
  });

  const rohan = await prisma.user.create({
    data: {
      name: "Rohan Gupta",
      email: "rohan.gupta@meridianworks.in",
      role: "STAFF",
      managerId: arjun.id,
      monthlyLimit: "15000.00",
    },
  });

  const sneha = await prisma.user.create({
    data: {
      name: "Sneha Iyer",
      email: "sneha.iyer@meridianworks.in",
      role: "STAFF",
      managerId: arjun.id,
      monthlyLimit: "15000.00", // near-limit scenario — see claims below
    },
  });

  const vikram = await prisma.user.create({
    data: {
      name: "Vikram Singh",
      email: "vikram.singh@meridianworks.in",
      role: "STAFF",
      managerId: priya.id,
      monthlyLimit: "15000.00",
    },
  });

  const ananya = await prisma.user.create({
    data: {
      name: "Ananya Joshi",
      email: "ananya.joshi@meridianworks.in",
      role: "STAFF",
      managerId: priya.id,
      monthlyLimit: "15000.00",
    },
  });

  const meera = await prisma.user.create({
    data: {
      name: "Meera Krishnan",
      email: "meera.krishnan@meridianworks.in",
      role: "STAFF",
      managerId: priya.id,
      monthlyLimit: "15000.00",
    },
  });

  return { kavya, arjun, priya, rohan, sneha, vikram, ananya, meera };
}

// ---------------------------------------------------------------------------
// Claims — a declarative list of specs, run through one helper that
// creates the Claim + Receipt + a believable ClaimEvent history together.
// ---------------------------------------------------------------------------

interface ClaimSpec {
  label: string; // for the summary printout only
  claimant: User;
  approver?: User; // required once status is past PARSED
  payer?: User; // required for PAID
  status: ClaimStatus;
  category: ExpenseCategory;
  merchant: string;
  amount: string;
  expenseDate: Date;
  description: string;
  rawReceiptText: string;
  decisionNote?: string;
  messy?: boolean; // lower parse confidence, for the deliberately badly-written receipts
  edited?: boolean; // insert an EDITED event (user corrected the parsed draft)
}

async function seedClaim(spec: ClaimSpec) {
  if (spec.status !== "PARSED" && !spec.approver) {
    throw new Error(`Claim spec "${spec.label}" needs an approver for status ${spec.status}`);
  }
  if (spec.approver && spec.approver.id === spec.claimant.id) {
    // Belt-and-braces: the seed data itself must never assign a claimant
    // as their own approver, reinforcing the business rule even before
    // Phase 6's service layer exists to enforce it in code.
    throw new Error(`Claim spec "${spec.label}" assigns ${spec.claimant.name} as their own approver`);
  }
  if (spec.status === "PAID" && !spec.payer) {
    throw new Error(`Claim spec "${spec.label}" needs a payer for status PAID`);
  }

  // --- timestamps, chained forward from the expense date, each step
  // derived from the previous (already-clamped) one so the sequence can
  // never run backward or past "today" — see advance()'s comment above.
  const createdAt = advanceDays(spec.expenseDate, 1);
  const parsedAt = advanceMinutes(createdAt, 5);
  const editedAt = spec.edited ? advanceMinutes(parsedAt, 20) : null;
  const submittedAt =
    spec.status === "PARSED" ? null : advanceDays(editedAt ?? parsedAt, 1);
  const decidedAt =
    spec.status === "APPROVED" || spec.status === "REJECTED" || spec.status === "PAID"
      ? advanceDays(submittedAt!, 2)
      : null;
  const paidAt = spec.status === "PAID" ? advanceDays(decidedAt!, 3) : null;

  const updatedAt = paidAt ?? decidedAt ?? submittedAt ?? editedAt ?? parsedAt;

  const normalizedText = normalizeReceiptText(spec.rawReceiptText);
  const textHash = hashReceiptText(normalizedText);

  const claim = await prisma.claim.create({
    data: {
      claimantId: spec.claimant.id,
      approverId: spec.status === "PARSED" ? null : spec.approver!.id,
      status: spec.status,
      category: spec.category,
      merchant: spec.merchant,
      amount: spec.amount,
      currency: "INR",
      expenseDate: spec.expenseDate,
      description: spec.description,
      rawReceiptText: spec.rawReceiptText,
      submittedAt,
      decidedAt,
      decisionNote: spec.decisionNote ?? null,
      paidAt,
      paidById: spec.status === "PAID" ? spec.payer!.id : null,
      createdAt,
      updatedAt,
    },
  });

  await prisma.receipt.create({
    data: {
      claimId: claim.id,
      sourceType: "PASTED_TEXT",
      rawText: spec.rawReceiptText,
      normalizedText,
      textHash,
      parsedMerchant: spec.merchant,
      parsedDate: spec.expenseDate,
      parsedAmount: spec.amount,
      parsedCategory: spec.category,
      parseConfidence: spec.messy ? 0.55 : 0.9,
      createdAt: parsedAt,
    },
  });

  const events: {
    actorId: string | null;
    eventType:
      | "CREATED"
      | "PARSED"
      | "EDITED"
      | "SUBMITTED"
      | "APPROVED"
      | "REJECTED"
      | "PAID";
    fromStatus: ClaimStatus | null;
    toStatus: ClaimStatus | null;
    note: string | null;
    createdAt: Date;
  }[] = [
    {
      actorId: spec.claimant.id,
      eventType: "CREATED",
      fromStatus: null,
      toStatus: "PARSED",
      note: null,
      createdAt,
    },
    {
      actorId: spec.claimant.id,
      eventType: "PARSED",
      fromStatus: "PARSED",
      toStatus: "PARSED",
      note: "Receipt text parsed into a draft claim.",
      createdAt: parsedAt,
    },
  ];

  if (spec.edited && editedAt) {
    events.push({
      actorId: spec.claimant.id,
      eventType: "EDITED",
      fromStatus: "PARSED",
      toStatus: "PARSED",
      note: "Corrected the parsed details before submitting.",
      createdAt: editedAt,
    });
  }

  if (submittedAt) {
    events.push({
      actorId: spec.claimant.id,
      eventType: "SUBMITTED",
      fromStatus: "PARSED",
      toStatus: "SUBMITTED",
      note: null,
      createdAt: submittedAt,
    });
  }

  if (spec.status === "APPROVED" || spec.status === "PAID") {
    events.push({
      actorId: spec.approver!.id,
      eventType: "APPROVED",
      fromStatus: "SUBMITTED",
      toStatus: "APPROVED",
      note: null,
      createdAt: decidedAt!,
    });
  }

  if (spec.status === "REJECTED") {
    events.push({
      actorId: spec.approver!.id,
      eventType: "REJECTED",
      fromStatus: "SUBMITTED",
      toStatus: "REJECTED",
      note: spec.decisionNote ?? null,
      createdAt: decidedAt!,
    });
  }

  if (spec.status === "PAID") {
    events.push({
      actorId: spec.payer!.id,
      eventType: "PAID",
      fromStatus: "APPROVED",
      toStatus: "PAID",
      note: null,
      createdAt: paidAt!,
    });
  }

  // Consecutive events can legitimately share the same clamped timestamp
  // (e.g. everything landing on "today" for a very recent expense). A tiny
  // strictly-increasing per-event offset guarantees a real chronological
  // order in the stored data — instead of leaving same-timestamp events'
  // order to be however Postgres happens to return them — without
  // meaningfully changing how "recent" any of them look.
  await prisma.claimEvent.createMany({
    data: events.map((e, index) => ({
      claimId: claim.id,
      ...e,
      createdAt: new Date(e.createdAt.getTime() + index * 1000),
    })),
  });

  return { claim, eventCount: events.length };
}

function buildClaimSpecs(users: Awaited<ReturnType<typeof seedUsers>>): ClaimSpec[] {
  const { kavya, arjun, priya, rohan, sneha, vikram, ananya, meera } = users;

  return [
    // ---- Rohan Gupta (reports to Arjun) --------------------------------
    {
      label: "Rohan / IRCTC train (paid, previous month, messy)",
      claimant: rohan,
      approver: arjun,
      payer: kavya,
      status: "PAID",
      category: "TRAVEL",
      merchant: "IRCTC",
      amount: "1850.00",
      expenseDate: previousMonthDay(28),
      description: "Train ticket, Chennai to Bangalore",
      rawReceiptText: "IRCTC chennai blr 28/08 INR 1850",
      messy: true,
    },
    {
      label: "Rohan / team lunch (approved)",
      claimant: rohan,
      approver: arjun,
      status: "APPROVED",
      category: "MEALS",
      merchant: "The Bombay Canteen",
      amount: "1200.00",
      expenseDate: currentMonthDay(6),
      description: "Team lunch with visiting client",
      rawReceiptText: "Business Lunch - The Bombay Canteen\nAmount: Rs 1,200\nParty size: 4",
    },
    {
      label: "Rohan / office supplies (submitted)",
      claimant: rohan,
      approver: arjun,
      status: "SUBMITTED",
      category: "SUPPLIES",
      merchant: "Reliance Digital",
      amount: "2150.00",
      expenseDate: currentMonthDay(14),
      description: "USB-C hub and HDMI cable for client demo",
      rawReceiptText: "Reliance Digital - USB-C hub, HDMI cable\nTotal: Rs 2,150\nInvoice #RD-88213",
    },
    {
      label: "Rohan / auto ride (parsed, not yet submitted, messy)",
      claimant: rohan,
      status: "PARSED",
      category: "TAXI",
      merchant: "Uber",
      amount: "220.00",
      expenseDate: currentMonthDay(3),
      description: "Auto ride to client office",
      rawReceiptText: "uber auto chennai 3 sept 220",
      messy: true,
    },

    // ---- Sneha Iyer (reports to Arjun) — the near-limit scenario -------
    {
      label: "Sneha / flight (paid, near-limit contributor #1)",
      claimant: sneha,
      approver: arjun,
      payer: kavya,
      status: "PAID",
      category: "TRAVEL",
      merchant: "IndiGo Airlines",
      amount: "7300.00",
      expenseDate: currentMonthDay(5),
      description: "Flight, Chennai to Mumbai for client workshop",
      rawReceiptText: "IndiGo Airlines - Chennai to Mumbai\nBooking ref: 6E-2291\nFare: Rs 7,300",
    },
    {
      label: "Sneha / client dinner (approved, near-limit contributor #2)",
      claimant: sneha,
      approver: arjun,
      status: "APPROVED",
      category: "MEALS",
      merchant: "Mainland China",
      amount: "6200.00",
      expenseDate: currentMonthDay(10),
      description: "Client dinner, 5 guests",
      rawReceiptText: "Mainland China restaurant - client dinner\nAmount: Rs 6,200\nCovers: 5 guests",
    },
    {
      label: "Sneha / printer supplies (submitted — would push her over limit if approved)",
      claimant: sneha,
      approver: arjun,
      status: "SUBMITTED",
      category: "SUPPLIES",
      merchant: "Staples",
      amount: "2400.00",
      expenseDate: currentMonthDay(18),
      description: "Printer cartridges and paper for the team",
      rawReceiptText: "Staples - printer cartridges and paper\nTotal: Rs 2,400",
    },

    // ---- Vikram Singh (reports to Priya) -------------------------------
    {
      label: "Vikram / Ola cab (paid, previous month, messy)",
      claimant: vikram,
      approver: priya,
      payer: kavya,
      status: "PAID",
      category: "TAXI",
      merchant: "Ola",
      amount: "187.00",
      expenseDate: previousMonthDay(9),
      description: "Cab to client site",
      rawReceiptText: "OLA CAB TRIP 09/09 fare 187 gst incl",
      messy: true,
    },
    {
      label: "Vikram / stationery (rejected — missing itemised bill)",
      claimant: vikram,
      approver: priya,
      status: "REJECTED",
      category: "SUPPLIES",
      merchant: "Local stationery vendor",
      amount: "950.00",
      expenseDate: currentMonthDay(12),
      description: "Stationery items for the team",
      rawReceiptText: "stationery items rs 950 no bill breakdown",
      decisionNote: "Missing itemised bill, please resubmit with details.",
      messy: true,
    },
    {
      label: "Vikram / cafe order (approved, previous month, messy)",
      claimant: vikram,
      approver: priya,
      status: "APPROVED",
      category: "MEALS",
      merchant: "Cafe Coffee Day",
      amount: "340.00",
      expenseDate: previousMonthDay(15),
      description: "Coffee and snacks, informal client catch-up",
      rawReceiptText: "cafe coffee day 2 cappuccino 1 sandwich total rs 340/-",
      messy: true,
    },

    // ---- Ananya Joshi (reports to Priya) — the duplicate-receipt pair --
    {
      label: "Ananya / Ola auto (paid, previous month — duplicate pair, first)",
      claimant: ananya,
      approver: priya,
      payer: kavya,
      status: "PAID",
      category: "TAXI",
      merchant: "Ola",
      amount: "180.00",
      expenseDate: daysAgo(24),
      description: "Auto ride, MG Road to office",
      rawReceiptText: "Ola auto MG Road to office Rs 180",
    },
    {
      label: "Ananya / Ola auto (submitted, ~3 weeks later, reworded — duplicate pair, second)",
      claimant: ananya,
      approver: priya,
      status: "SUBMITTED",
      category: "TAXI",
      merchant: "Ola",
      amount: "180.00",
      expenseDate: daysAgo(3),
      description: "Auto ride, MG Road to office",
      rawReceiptText: "OLA - MG ROAD TO OFFICE - INR 180.00",
      // Same claimant, same merchant/amount/route as the claim above,
      // three weeks apart, worded differently — deliberately NOT flagged
      // here (duplicateFlag/DuplicateMatch stay unset). Phase 5's
      // detector is what should catch this pair later.
    },
    {
      label: "Ananya / intercity bus (submitted)",
      claimant: ananya,
      approver: priya,
      status: "SUBMITTED",
      category: "TRAVEL",
      merchant: "MakeMyTrip",
      amount: "3400.00",
      expenseDate: currentMonthDay(16),
      description: "Bus ticket, Chennai to Bangalore",
      rawReceiptText: "MakeMyTrip - Chennai to Bangalore bus ticket\nAmount: Rs 3,400",
    },
    {
      label: "Ananya / courier (parsed, not yet submitted, messy)",
      claimant: ananya,
      status: "PARSED",
      category: "OTHER",
      merchant: "Local courier service",
      amount: "450.00",
      expenseDate: currentMonthDay(22),
      description: "Courier charges for client documents",
      rawReceiptText: "courier charges for client documents 450",
      messy: true,
    },

    // ---- Meera Krishnan (reports to Priya) -----------------------------
    {
      label: "Meera / flight (approved, previous month)",
      claimant: meera,
      approver: priya,
      status: "APPROVED",
      category: "TRAVEL",
      merchant: "SpiceJet",
      amount: "5400.00",
      expenseDate: previousMonthDay(12),
      description: "Flight, Bangalore to Delhi for training",
      rawReceiptText: "SpiceJet - Bangalore to Delhi\nBooking ref: SG-7742\nFare: Rs 5,400",
    },
    {
      label: "Meera / laptop bag (paid)",
      claimant: meera,
      approver: priya,
      payer: kavya,
      status: "PAID",
      category: "SUPPLIES",
      merchant: "Amazon Business",
      amount: "1350.00",
      expenseDate: currentMonthDay(8),
      description: "Laptop bag and accessories",
      rawReceiptText: "Amazon Business - laptop bag and accessories\nOrder total: Rs 1,350",
    },
    {
      label: "Meera / business lunch (parsed, not yet submitted, multi-line messy)",
      claimant: meera,
      status: "PARSED",
      category: "MEALS",
      merchant: "Spice Route",
      amount: "1450.00",
      expenseDate: currentMonthDay(24),
      description: "Business lunch with client",
      rawReceiptText: "Business lunch with client\nRestaurant: Spice Route\nAmount: Rs 1450\nGST included",
      messy: true,
      edited: true,
    },

    // ---- Arjun Mehta (Manager, also a claimant — no manager of his own,
    //      so Priya reviews his claims: see the note in seedUsers()) -----
    {
      label: "Arjun / conference travel (submitted, reviewed by Priya)",
      claimant: arjun,
      approver: priya,
      status: "SUBMITTED",
      category: "TRAVEL",
      merchant: "Multiple (flight + cab)",
      amount: "8900.00",
      expenseDate: currentMonthDay(20),
      description: "Conference travel, Bangalore",
      rawReceiptText: "Conference travel - Bangalore\nFlight + cab\nTotal: Rs 8,900",
    },
    {
      label: "Arjun / team dinner (paid, previous month, reviewed by Priya)",
      claimant: arjun,
      approver: priya,
      payer: kavya,
      status: "PAID",
      category: "MEALS",
      merchant: "Toit Brewpub",
      amount: "4200.00",
      expenseDate: previousMonthDay(20),
      description: "Team dinner",
      rawReceiptText: "Team dinner - Toit Brewpub\nAmount: Rs 4,200",
    },

    // ---- Priya Nair (Manager, also a claimant — reports to Arjun) ------
    {
      label: "Priya / client visit cab (approved, reviewed by Arjun)",
      claimant: priya,
      approver: arjun,
      status: "APPROVED",
      category: "TAXI",
      merchant: "Ola",
      amount: "610.00",
      expenseDate: currentMonthDay(15),
      description: "Cab to client site visit",
      rawReceiptText: "Ola cab - client site visit\nFare: Rs 610",
    },
    {
      label: "Priya / chai and snacks (parsed, not yet submitted, messy)",
      claimant: priya,
      status: "PARSED",
      category: "MEALS",
      merchant: "Office canteen",
      amount: "220.00",
      expenseDate: currentMonthDay(26),
      description: "Chai and snacks during client meeting",
      rawReceiptText: "chai n snacks meeting client 220rs",
      messy: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await resetDemoData();

  const users = await seedUsers();
  const specs = buildClaimSpecs(users);

  let claimCount = 0;
  let eventCount = 0;
  for (const spec of specs) {
    const { eventCount: n } = await seedClaim(spec);
    claimCount += 1;
    eventCount += n;
  }

  const receiptCount = claimCount; // one receipt per claim, always created above

  const statusCounts = await prisma.claim.groupBy({ by: ["status"], _count: true });
  const categoryCounts = await prisma.claim.groupBy({ by: ["category"], _count: true });

  console.log("Seed complete.\n");
  console.log(`Users: ${Object.keys(users).length}`);
  console.log(`Claims: ${claimCount}`);
  console.log(`Receipts: ${receiptCount}`);
  console.log(`Claim events: ${eventCount}\n`);

  console.log("Status distribution:");
  for (const row of statusCounts) {
    console.log(`  ${row.status}: ${row._count}`);
  }
  console.log("\nCategory distribution:");
  for (const row of categoryCounts) {
    console.log(`  ${row.category}: ${row._count}`);
  }

  console.log("\nDemo scenarios:");
  console.log("✓ Duplicate receipt pair (Ananya Joshi — Ola auto, MG Road, ~3 weeks apart)");
  console.log("✓ Near-limit employee (Sneha Iyer — ₹13,500 of ₹15,000 this month, plus a pending claim that would tip her over)");
  console.log("✓ Rejected claim with decision note (Vikram Singh)");
  console.log("✓ Manager claims, never self-approved (Arjun ↔ Priya review each other)");
  console.log("✓ Claims across all five statuses");
  console.log("✓ Claims across all five categories");
  console.log("✓ Badly-written receipt text for the parser to work against later");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
