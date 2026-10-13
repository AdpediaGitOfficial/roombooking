import { AppShell } from "@/components/shell/app-shell";

export default function MaintenanceLayout({ children }: LayoutProps<"/maintenance">) {
  return <AppShell returnTo="/maintenance">{children}</AppShell>;
}
