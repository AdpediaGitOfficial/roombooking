const modules = [
  ["Accommodation", "Sites, buildings, rooms, beds, allocations, check-in/out"],
  ["Staff self-service", "My stay, profile, requests"],
  ["Maintenance", "Work orders, assignment, contractor access"],
  ["Forms & approvals", "Room change, visitor, family, exit clearance"],
  ["Facility booking", "Shared facilities and calendars"],
  ["Keys", "Issue, return, lost and damaged keys"],
  ["Inventory", "Stock and serialised assets"],
  ["Lost & found", "Items, claims and handover"],
  ["Notifications", "In-app, email and WhatsApp"],
  ["Reports", "Occupancy, movements, maintenance, utilisation"],
  ["Administration", "Users, roles, audit, configuration"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Staff Accommodation Management</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Foundation build. Modules below map to the Scope of Work; see{" "}
        <code>docs/requirements-analysis.md</code> for the release plan.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {modules.map(([name, desc]) => (
          <li key={name} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="font-medium">{name}</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{desc}</div>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm">
        Health check: <a className="underline" href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
