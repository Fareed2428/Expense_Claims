import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { submitClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";

/** POST /api/claims/[id]/submit — PARSED → SUBMITTED. Claimant only; see submitClaim(). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const claim = await submitClaim(user, id);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
