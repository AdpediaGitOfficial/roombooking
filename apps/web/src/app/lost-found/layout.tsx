import { AppShell } from "@/components/shell/app-shell";

export default function LostFoundLayout({ children }: LayoutProps<"/lost-found">) {
  return <AppShell returnTo="/lost-found">{children}</AppShell>;
}
