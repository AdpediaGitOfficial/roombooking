import Link from "next/link";

const NAV = [
  ["/my", "Home"],
  ["/my/stay", "My stay"],
  ["/my/requests", "Requests"],
  ["/my/maintenance", "Maintenance"],
  ["/my/profile", "Profile"],
] as const;

export default function MyLayout({ children }: LayoutProps<"/my">) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex-1 px-4 pt-6 pb-24">{children}</div>
      <nav aria-label="Staff navigation" className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <ul className="mx-auto flex max-w-md">
          {NAV.map(([href, label]) => (
            <li key={href} className="flex-1">
              <Link href={href} className="block px-2 py-3 text-center text-sm font-medium">{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
