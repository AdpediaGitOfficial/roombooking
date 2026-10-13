import { AppShell } from "@/components/shell/app-shell";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <AppShell returnTo="/dashboard">{children}</AppShell>;
}
