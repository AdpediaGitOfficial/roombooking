import type { WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { describeStatus, isOverdue, type WorkOrderRecord } from "@sam/core/modules/maintenance/rules";

const STATUS_STYLE: Partial<Record<WorkOrderStatus, string>> = {
  NEW: "chip-warning",
  TRIAGED: "chip-warning",
  ASSIGNED: "chip-info",
  IN_PROGRESS: "chip-info",
  WAITING_STAFF: "chip-warning",
  WAITING_PARTS: "chip-warning",
  WAITING_ACCESS: "chip-warning",
  RESOLVED: "chip-success",
  CLOSED: "",
  REOPENED: "chip-danger",
  CANCELLED: "",
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span data-status={status} className={`chip chip-dot ${STATUS_STYLE[status] ?? ""}`}>{describeStatus(status)}</span>;
}

const PRIORITY_STYLE: Record<WorkOrderPriority, string> = {
  LOW: "text-zinc-500",
  MEDIUM: "text-zinc-600",
  HIGH: "text-orange-700 font-semibold",
  URGENT: "text-red-700 font-semibold",
};

export function PriorityLabel({ priority }: { priority: WorkOrderPriority }) {
  return <span data-priority={priority} className={`text-xs uppercase tracking-wide ${PRIORITY_STYLE[priority]}`}>{priority.toLowerCase()}</span>;
}

export function SlaLabel({ wo, now }: { wo: Pick<WorkOrderRecord, "status" | "slaDueAt">; now: Date }) {
  if (!wo.slaDueAt) return null;
  const overdue = isOverdue(wo, now);
  const hours = Math.round((wo.slaDueAt.getTime() - now.getTime()) / 3600000);
  if (!["NEW", "TRIAGED", "ASSIGNED", "IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "REOPENED"].includes(wo.status)) return null;
  return (
    <span data-overdue={overdue ? "true" : "false"} className={overdue ? "chip chip-danger" : hours <= 12 ? "chip chip-warning" : "text-xs text-zinc-500"}>
      {overdue ? `Overdue by ${Math.abs(hours)} h` : `Due in ${hours} h`}
    </span>
  );
}

export function NoteList({ notes, photos }: { notes: WorkOrderRecord["notes"]; photos: Array<{ id: string; fileName: string; createdAt: Date }> }) {
  type Item = { at: Date; kind: "note" | "photo"; title: string; body?: string; internal?: boolean; id: string };
  const items: Item[] = [
    ...notes.map<Item>((n) => ({ at: n.createdAt, kind: "note", id: n.id, title: n.type === "COMMENT" ? n.author.name : n.note, body: n.type === "COMMENT" ? n.note : undefined, internal: n.internal })),
    ...photos.map<Item>((p) => ({ at: p.createdAt, kind: "photo", id: p.id, title: "Photo" })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (items.length === 0) return <p className="text-sm text-zinc-500">No updates yet.</p>;
  const newestFirst = [...items].reverse();
  return (
    <ol className="timeline mt-1">
      {newestFirst.map((i, idx) => (
        <li key={`${i.kind}-${i.id}`} data-note={i.kind} data-internal={i.internal ? "true" : "false"} className={idx === 0 ? "now" : undefined}>
          <b>{i.kind === "photo" ? "Photo added" : i.body ? i.title : i.title}{i.internal ? <span className="chip ml-2">internal</span> : null}</b>
          <small className="tabular-nums">{i.at.toISOString().replace("T", " ").slice(0, 16)}</small>
          {i.body && <div className="note whitespace-pre-line">{i.body}</div>}
          {i.kind === "photo" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/attachments/${i.id}`} alt="Attached photo" className="mt-2 max-h-72 rounded-md border border-zinc-200" loading="lazy" />
          )}
        </li>
      ))}
    </ol>
  );
}
