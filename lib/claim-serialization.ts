/**
 * Converts a claim (as returned by lib/claim-service.ts) into a plain,
 * JSON-safe shape for API responses — Prisma's Decimal fields (amount,
 * receipt.parsedAmount) serialize as strings by default via their own
 * toJSON(), which works but is an awkward shape for a client to consume.
 * This makes them plain numbers instead, once, in one place, so every
 * route returns claims the same way.
 */

import type { ClaimWithRelations } from "@/lib/claim-service";

export function serializeClaim(claim: ClaimWithRelations) {
  return {
    ...claim,
    amount: claim.amount.toNumber(),
    receipt: claim.receipt
      ? { ...claim.receipt, parsedAmount: claim.receipt.parsedAmount?.toNumber() ?? null }
      : null,
    duplicatesFound: claim.duplicatesFound.map((match) => ({
      ...match,
      matchedClaim: { ...match.matchedClaim, amount: match.matchedClaim.amount.toNumber() },
    })),
  };
}

export function serializeClaims(claims: ClaimWithRelations[]) {
  return claims.map(serializeClaim);
}

/**
 * The JSON-safe claim shape, for client components. Note: when a Server
 * Component passes this as props, date fields stay real Date objects
 * (React's RSC payload preserves them); when a Client Component instead
 * fetches /api/claims/** directly, the same fields arrive as ISO strings
 * (plain JSON has no Date type). lib/format.ts's formatDate/formatDateTime
 * accept `string | Date` for exactly this reason, so components don't
 * need to care which case they're in.
 */
export type SerializedClaim = ReturnType<typeof serializeClaim>;
