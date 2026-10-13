import { AppShell } from "@/components/shell/app-shell";

export default function ReportsLayout({ children }: LayoutProps<"/reports">) {
  return <AppShell returnTo="/reports">{children}</AppShell>;
}
