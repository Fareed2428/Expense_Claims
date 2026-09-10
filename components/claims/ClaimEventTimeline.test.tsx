// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimEventTimeline } from "./ClaimEventTimeline";

describe("ClaimEventTimeline", () => {
  it("shows a placeholder when there is no history", () => {
    render(<ClaimEventTimeline events={[]} />);
    expect(screen.getByText("No history yet.")).toBeInTheDocument();
  });

  it("renders events with a human-readable label, actor, and note, in the order given", () => {
    const events = [
      {
        id: "e1",
        claimId: "c1",
        actorId: "staff-1",
        eventType: "CREATED",
        fromStatus: null,
        toStatus: "PARSED",
        note: null,
        createdAt: "2026-09-01T09:00:00.000Z",
        actor: { id: "staff-1", name: "Rohan Gupta", role: "STAFF" },
      },
      {
        id: "e2",
        claimId: "c1",
        actorId: "manager-1",
        eventType: "REJECTED",
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
        note: "Missing itemised bill, please resubmit with details.",
        createdAt: "2026-09-02T09:00:00.000Z",
        actor: { id: "manager-1", name: "Priya Nair", role: "MANAGER" },
      },
    ] as never;

    render(<ClaimEventTimeline events={events} />);

    expect(screen.getByText("Claim created")).toBeInTheDocument();
    expect(screen.getByText("Rohan Gupta")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Missing itemised bill, please resubmit with details.")).toBeInTheDocument();
  });

  it("shows 'System' for events with no actor (e.g. automatic duplicate flagging)", () => {
    const events = [
      {
        id: "e1",
        claimId: "c1",
        actorId: null,
        eventType: "DUPLICATE_FLAGGED",
        fromStatus: null,
        toStatus: null,
        note: "Flagged as a possible duplicate (score 0.90).",
        createdAt: "2026-09-01T09:00:00.000Z",
        actor: null,
      },
    ] as never;

    render(<ClaimEventTimeline events={events} />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });
});
