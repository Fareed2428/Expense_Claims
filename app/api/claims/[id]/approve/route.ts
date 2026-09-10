import { NextResponse, type NextRequest } from "next/server";
import { requireManager } from "@/lib/auth";
import { approveClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";

/**
 * POST /api/claims/[id]/approve — SUBMITTED → APPROVED. Manager-only at
 * the auth layer; approveClaim() itself re-checks the role, the
 * assigned-approver match, and — critically — that the actor isn't the
 * claimant, so this rule holds even if this route were ever called with
 * a bypassed/mocked auth layer.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireManager(request);
    const { id } = await params;
    const claim = await approveClaim(user, id);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
