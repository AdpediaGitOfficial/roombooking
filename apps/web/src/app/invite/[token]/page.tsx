import { Suspense } from "react";
import Link from "next/link";
import { lookupToken } from "@sam/core/modules/admin/users-service";
import { AcceptInviteForm } from "@/modules/admin/components/forms";

async function Content({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await lookupToken(token);
  if (!user) {
    return (
      <>
        <h1 className="page-title">This link has expired</h1>
        <p className="mt-2 text-sm text-zinc-600">Invite and password links work once and for a limited time. Ask the accommodation office or your administrator for a new one.</p>
        <Link href="/login" className="mt-6 inline-block underline">Go to sign in</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="page-title">{user.tokenPurpose === "RESET" ? "Set a new password" : `Welcome, ${user.name.split(" ")[0]}`}</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-600">{user.username}</p>
      <AcceptInviteForm token={token} />
    </>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3"><span className="brand-mark" aria-hidden="true">S</span><span className="text-lg font-bold tracking-tight">Staff Accommodation</span></div>
      <div className="card p-6">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
      </div>
    </main>
  );
}
