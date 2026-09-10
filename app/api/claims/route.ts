import { NextResponse, type NextRequest } from "next/server";
import type { ClaimStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { createClaim, listClaims } from "@/lib/claim-service";
import { serializeClaim, serializeClaims } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";
import { InvalidClaimDataError } from "@/lib/claim-errors";

const VALID_STATUSES: readonly ClaimStatus[] = ["PARSED", "SUBMITTED", "APPROVED", "REJECTED", "PAID"];

/**
 * GET /api/claims — list claims visible to the caller (scoped by role;
 * see lib/claim-service.ts's listClaims). Optional ?status= filter.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const statusParam = request.nextUrl.searchParams.get("status");
    if (statusParam && !VALID_STATUSES.includes(statusParam as ClaimStatus)) {
      return NextResponse.json({ error: `Invalid status filter: ${statusParam}` }, { status: 400 });
    }
    const claims = await listClaims(
      user,
      statusParam ? { status: statusParam as ClaimStatus } : {}
    );
    return NextResponse.json({ claims: serializeClaims(claims) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/claims — creates a new PARSED claim from pasted receipt text.
 * Body: { rawReceiptText: string }
 * The authenticated user is always the claimant; nothing else in the
 * body is trusted (see createClaim's own comment).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const rawReceiptText = (body as { rawReceiptText?: unknown } | null)?.rawReceiptText;
    if (typeof rawReceiptText !== "string") {
      throw new InvalidClaimDataError("rawReceiptText is required and must be a string.");
    }

    const claim = await createClaim(user, { rawReceiptText });
    return NextResponse.json({ claim: serializeClaim(claim) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
