"use server";

import { actorOf, requireUser } from "@/lib/auth/authorize";
import { runDomain, str, type ActionState } from "@/lib/action-state";
import { hardDelete, restoreArchived, type ArchiveKind } from "@sam/core/modules/archive/service";
import { restoreRecord, type Level } from "@sam/core/modules/structure/service";

export async function restoreArchivedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/archive");
  return runDomain(async () => { await restoreArchived(actorOf(user), str(fd, "kind") as ArchiveKind, str(fd, "id")); return "Restored."; }, ["/"]);
}

export async function restoreStructureAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/archive");
  return runDomain(async () => { await restoreRecord(actorOf(user), str(fd, "level") as Level, str(fd, "id")); return "Restored as a draft; activate it to bring it back."; }, ["/"]);
}

export async function hardDeleteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/admin/archive");
  return runDomain(async () => { await hardDelete(actorOf(user), str(fd, "kind") as ArchiveKind, str(fd, "id")); return "Permanently deleted."; }, ["/"]);
}
