import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClaim, updateClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";
import { parseClaimCorrections, readOptionalJsonBody } from "@/lib/claim-request-parsing";

/** GET /api/claims/[id] — authorization enforced in getClaim(), not here. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const claim = await getClaim(user, id);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH /api/claims/[id] — corrects a PARSED draft before its first
 * submission (the review/correct step of the parse → review → submit
 * flow — see updateClaim() in lib/claim-service.ts, which this simply
 * exposes; it was already built in Phase 6 but had no route wired to it
 * until this phase's UI needed one).
 * Body (all optional): { rawReceiptText?, merchant?, amount?, expenseDate?, category?, description? }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    const body = await readOptionalJsonBody(request);
    const corrections = parseClaimCorrections(body);
    const claim = await updateClaim(user, id, corrections);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
