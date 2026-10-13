import { Suspense } from "react";
import Link from "next/link";
import { lookupToken } from "@/modules/admin/users-service";
import { AcceptInviteForm } from "@/modules/admin/components/forms";

async function Content({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await lookupToken(token);
  if (!user) {
    return (
      <>
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Invite and password links work once and for a limited time. Ask the accommodation office or your administrator for a new one.</p>
        <Link href="/login" className="mt-6 inline-block underline">Go to sign in</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">{user.tokenPurpose === "RESET" ? "Set a new password" : `Welcome, ${user.name.split(" ")[0]}`}</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
      <AcceptInviteForm token={token} />
    </>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}
