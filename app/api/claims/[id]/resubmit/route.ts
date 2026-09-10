import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { resubmitClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";
import { parseClaimCorrections, readOptionalJsonBody } from "@/lib/claim-request-parsing";

/**
 * POST /api/claims/[id]/resubmit — REJECTED → SUBMITTED. Claimant only.
 * Body (all optional): { rawReceiptText?, merchant?, amount?, expenseDate?, category?, description? }
 * A claimant may resubmit as-is with no corrections at all, so an empty
 * body is valid here, unlike most other routes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;

    const body = await readOptionalJsonBody(request);
    const corrections = parseClaimCorrections(body);
    const claim = await resubmitClaim(user, id, corrections);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
