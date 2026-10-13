import Link from "next/link";
import { holderLabel, keysForRoom } from "../service";
import { staffOptions } from "../context";
import { KeyStatusBadge } from "./views";
import { IssueKeyForm, ReturnKeyForm } from "./forms";

/** Handover panel for an allocation: keys of the resident's room (KEY-05). */
export async function RoomKeysPanel({ roomId, staffId, canOperate, returnPath }: { roomId: string; staffId: string; canOperate: boolean; returnPath: string }) {
  const rows = await keysForRoom(roomId);
  if (rows.length === 0) return null;
  const staff = canOperate ? await staffOptions() : [];
  return (
    <div className="card p-4" data-room-keys>
      <h3 className="font-medium">Room keys</h3>
      <ul className="mt-2 space-y-3">
        {rows.map(({ key, issue }) => (
          <li key={key.id} data-room-key={key.code} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/keys/${key.id}`} className="font-medium underline">{key.code}</Link>
              <KeyStatusBadge status={key.status} />
              {issue && <span className="text-xs text-zinc-500">held by {holderLabel(issue)}{issue.holderId === staffId ? " (this resident)" : ""}</span>}
            </div>
            {canOperate && key.status === "AVAILABLE" && <div className="mt-2"><IssueKeyForm keyId={key.id} staff={staff} defaultStaffId={staffId} returnPath={returnPath} compact /></div>}
            {canOperate && key.status === "ISSUED" && issue?.holderId === staffId && <div className="mt-2"><ReturnKeyForm keyId={key.id} returnPath={returnPath} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
