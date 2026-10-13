import type { WorkOrderPriority, WorkOrderStatus } from "@prisma/client";
import { describeStatus, isOverdue, type WorkOrderRecord } from "../service";

const STATUS_STYLE: Partial<Record<WorkOrderStatus, string>> = {
  NEW: "bg-amber-100 text-amber-800",
  TRIAGED: "bg-amber-100 text-amber-800",
  ASSIGNED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  WAITING_STAFF: "bg-orange-100 text-orange-800",
  WAITING_PARTS: "bg-orange-100 text-orange-800",
  WAITING_ACCESS: "bg-orange-100 text-orange-800",
  RESOLVED: "bg-green-100 text-green-800",
  CLOSED: "bg-zinc-200 text-zinc-700",
  REOPENED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-200 text-zinc-700",
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span data-status={status} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}>{describeStatus(status)}</span>;
}

const PRIORITY_STYLE: Record<WorkOrderPriority, string> = {
  LOW: "text-zinc-600",
  MEDIUM: "text-zinc-800",
  HIGH: "text-orange-700 font-medium",
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
    <span data-overdue={overdue ? "true" : "false"} className={`text-xs ${overdue ? "font-medium text-red-700" : "text-zinc-500"}`}>
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
  return (
    <ol className="space-y-2">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`} data-note={i.kind} data-internal={i.internal ? "true" : "false"} className={`rounded-lg border p-3 text-sm ${i.internal ? "border-dashed border-zinc-400" : "border-zinc-200"}`}>
          <div className="flex justify-between gap-3">
            <span className="font-medium">{i.title}{i.internal ? " · internal" : ""}</span>
            <span className="text-xs text-zinc-500 tabular-nums">{i.at.toISOString().replace("T", " ").slice(0, 16)}</span>
          </div>
          {i.body && <p className="mt-1 whitespace-pre-line">{i.body}</p>}
          {i.kind === "photo" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/attachments/${i.id}`} alt="Attached photo" className="mt-2 max-h-72 rounded-md" loading="lazy" />
          )}
        </li>
      ))}
    </ol>
  );
}
