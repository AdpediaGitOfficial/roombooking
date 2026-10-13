import { Suspense } from "react";
import Link from "next/link";
import { requireResident } from "@/modules/self-service/context";
import { userCanAccess } from "@/lib/auth/authorize";

async function Content() {
  const { user } = await requireResident("/my/more");
  const links: Array<[string, string, string, boolean]> = [
    ["/my/visitors", "Visitors", "Register a visitor and confirm walk-ins", true],
    ["/my/parcels", "Parcels", "Parcels waiting for you", userCanAccess(user, "sec.parcels")],
    ["/my/announcements", "Notices", "Announcements for your site", true],
    ["/my/lost-found", "Lost & found", "Report or claim an item", true],
    ["/my/charges", "Charges", "Charges against you", userCanAccess(user, "charges.own")],
    ["/my/sos", "Help / SOS", "Call for help in an emergency", userCanAccess(user, "sec.sos_raise")],
    ["/my/profile", "Profile", "Your details, consent and password", true],
  ];
  return <ul className="mt-4 divide-y divide-zinc-200 card">{links.filter((l) => l[3]).map(([href, label, hint]) => <li key={href}><Link href={href} className="flex items-center justify-between p-4"><span><b className="block">{label}</b><span className="text-xs text-zinc-500">{hint}</span></span><span aria-hidden="true">›</span></Link></li>)}</ul>;
}

export default function MorePage() {
  return <main><h1 className="page-title">More</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
