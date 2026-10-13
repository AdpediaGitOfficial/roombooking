import { revalidatePath } from "next/cache";

export type ActionState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

export const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
export const opt = (fd: FormData, k: string) => str(fd, k) || null;
export const num = (fd: FormData, k: string) => { const v = str(fd, k); return v === "" ? null : Number(v); };
export const list = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

/**
 * Runs a domain call for a form action. Domain errors (PeopleError, StructureError, ...) carry a `code` and become
 * form feedback; framework control-flow errors (redirect, notFound) and unexpected failures propagate.
 */
export async function runDomain(fn: () => Promise<string | void>, paths: string[] = ["/"]): Promise<ActionState> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p, "layout");
    return { message: message || "Saved." };
  } catch (error) {
    const e = error as { digest?: string; code?: unknown; fieldErrors?: Record<string, string>; message?: string };
    if (e && typeof e === "object" && !e.digest && typeof e.code === "string" && error instanceof Error) {
      return { error: e.message, fieldErrors: e.fieldErrors };
    }
    throw error;
  }
}
