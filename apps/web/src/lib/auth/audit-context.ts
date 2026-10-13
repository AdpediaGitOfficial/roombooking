import "server-only";
import { headers } from "next/headers";
import { setAuditContextProvider } from "@sam/core/lib/audit";

/** Records the device address and user agent on every audit entry written during a web request. */
setAuditContextProvider(async () => {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
});
