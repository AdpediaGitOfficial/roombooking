"use server";

import { requestSelfServiceReset } from "@sam/core/modules/admin/users-service";

export type ForgotState = { sent?: boolean };

/** Public. Always answers the same way so it cannot be used to discover accounts. */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  await requestSelfServiceReset(String(formData.get("username") ?? ""));
  return { sent: true };
}
