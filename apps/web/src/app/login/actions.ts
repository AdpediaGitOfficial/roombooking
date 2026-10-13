"use server";

import { redirect } from "next/navigation";
import { ApiError } from "@sam/contract/index";
import { api } from "@/lib/api";
import { destroyCurrentSession, setSessionCookie } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/authorize";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturnPath(String(formData.get("next") ?? ""));

  if (!email || !password) return { error: "Enter your email and password." };

  try {
    const session = await api.auth.login({ email, password });
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 503) return { error: "Sign-in is temporarily unavailable. Try again in a moment." };
      if (error.status < 500) return { error: error.message };
    }
    throw error;
  }
  redirect(returnTo);
}

export async function logout() {
  await destroyCurrentSession();
  redirect("/login");
}
