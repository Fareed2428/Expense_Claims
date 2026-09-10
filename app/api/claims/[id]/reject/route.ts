import { NextResponse, type NextRequest } from "next/server";
import { requireManager } from "@/lib/auth";
import { rejectClaim } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";
import { InvalidClaimDataError } from "@/lib/claim-errors";

/**
 * POST /api/claims/[id]/reject — SUBMITTED → REJECTED.
 * Body: { note: string } — required; rejectClaim() enforces this too.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireManager(request);
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const note = (body as { note?: unknown } | null)?.note;
    if (typeof note !== "string") {
      throw new InvalidClaimDataError("note is required and must be a string.");
    }

    const claim = await rejectClaim(user, id, note);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
