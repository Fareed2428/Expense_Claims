import { EVENT_LABEL, formatDateTime } from "@/lib/format";
import type { SerializedClaim } from "@/lib/claim-serialization";

/** Read-only, chronological audit trail — exactly the ClaimEvent rows the server recorded, nothing computed or inferred here. */
export function ClaimEventTimeline({ events }: { events: SerializedClaim["events"] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No history yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-medium text-slate-900">{EVENT_LABEL[event.eventType] ?? event.eventType}</p>
              <p className="text-xs text-slate-400">{formatDateTime(event.createdAt)}</p>
            </div>
            <p className="text-xs text-slate-500">
              {event.actor ? event.actor.name : "System"}
            </p>
            {event.note && <p className="mt-0.5 text-slate-600">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
