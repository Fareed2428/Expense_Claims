import { NextResponse, type NextRequest } from "next/server";
import { requireFinance } from "@/lib/auth";
import { payClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";

/**
 * POST /api/claims/[id]/pay — APPROVED → PAID. Finance-only. Payment is
 * simulated — no payment gateway. Rejects a duplicateFlag=true claim
 * with 409 DuplicateAcknowledgementRequired unless
 * /acknowledge-duplicate has already been called for it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFinance(request);
    const { id } = await params;
    const claim = await payClaim(user, id);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
