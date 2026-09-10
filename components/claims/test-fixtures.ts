/**
 * Shared fixture builder for component tests — produces a plain object
 * matching the SerializedClaim shape (what the API/Server Components
 * actually hand to these components), so each test file doesn't need to
 * hand-roll the same two dozen fields. Not itself a test file.
 */
import type { SerializedClaim } from "@/lib/claim-serialization";

export function makeSerializedClaim(overrides: Partial<SerializedClaim> = {}): SerializedClaim {
  return {
    id: "claim-1",
    claimantId: "staff-1",
    approverId: "manager-1",
    status: "SUBMITTED",
    category: "TAXI",
    merchant: "Ola",
    amount: 180,
    currency: "INR",
    expenseDate: "2026-09-01T00:00:00.000Z",
    description: "Auto ride",
    rawReceiptText: "Ola auto MG Road to office Rs 180",
    duplicateFlag: false,
    duplicateScore: null,
    duplicateAcknowledgedAt: null,
    duplicateAcknowledgedById: null,
    submittedAt: "2026-09-01T10:00:00.000Z",
    decidedAt: null,
    decisionNote: null,
    paidAt: null,
    paidById: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    claimant: { id: "staff-1", name: "Rohan Gupta", email: "rohan@x.invalid", role: "STAFF", managerId: "manager-1" },
    approver: { id: "manager-1", name: "Arjun Mehta", email: "arjun@x.invalid", role: "MANAGER" },
    paidBy: null,
    duplicateAcknowledgedBy: null,
    receipt: {
      id: "receipt-1",
      claimId: "claim-1",
      sourceType: "PASTED_TEXT",
      rawText: "Ola auto MG Road to office Rs 180",
      normalizedText: "ola auto mg road to office rs 180",
      textHash: "hash-1",
      parsedMerchant: "Ola",
      parsedDate: "2026-09-01T00:00:00.000Z",
      parsedAmount: 180,
      parsedCategory: "TAXI",
      parseConfidence: 0.9,
      parseWarnings: [],
      imageUrl: null,
      createdAt: "2026-09-01T09:00:00.000Z",
    },
    events: [],
    duplicatesFound: [],
    ...overrides,
  } as unknown as SerializedClaim;
}
