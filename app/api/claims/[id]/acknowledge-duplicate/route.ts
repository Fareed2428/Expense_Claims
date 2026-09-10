import { NextResponse, type NextRequest } from "next/server";
import { requireFinance } from "@/lib/auth";
import { acknowledgeDuplicate } from "@/lib/claim-service";
import { serializeClaim } from "@/lib/claim-serialization";
import { handleApiError } from "@/lib/api-error-response";

/**
 * POST /api/claims/[id]/acknowledge-duplicate — Finance-only. Records
 * that Finance has seen and acknowledged a duplicate-flag warning; does
 * not change the claim's status. payClaim() requires this to have
 * happened first for any duplicateFlag=true claim. No Finance UI for
 * this yet (Phase 7) — this is the backend groundwork only, per the
 * Phase 6 brief.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFinance(request);
    const { id } = await params;
    const claim = await acknowledgeDuplicate(user, id);
    return NextResponse.json({ claim: serializeClaim(claim) });
  } catch (err) {
    return handleApiError(err);
  }
}
