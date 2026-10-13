import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { CONSENT_TEXT, CONSENT_VERSION, consentNeeded } from "@sam/core/modules/privacy/service";
import { acceptConsentAction } from "@/modules/privacy/actions";
import { logout as logoutAction } from "@/app/login/actions";

async function Content({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { next } = await searchParams;
  if (!consentNeeded(user)) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <div className="mx-auto mt-10 w-full max-w-lg card p-6">
      <h1 className="page-title">Your privacy</h1>
      <p className="mt-1 text-sm text-zinc-600">Before you continue, please read how your information is used (version {CONSENT_VERSION}).</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">{CONSENT_TEXT.map((t) => <li key={t}>{t}</li>)}</ul>
      <form action={acceptConsentAction} className="mt-5 flex items-center gap-3"><input type="hidden" name="next" value={next ?? "/"} /><button className="btn btn-primary" type="submit">I understand and agree</button></form>
      <form action={logoutAction} className="mt-3"><button className="text-sm underline" type="submit">I do not agree: sign out</button></form>
    </div>
  );
}

export default function ConsentPage({ searchParams }: PageProps<"/consent">) {
  return <main className="px-4"><Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ next?: string }>} /></Suspense></main>;
}
