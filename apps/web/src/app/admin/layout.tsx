import { AppShell } from "@/components/shell/app-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AppShell returnTo="/admin">{children}</AppShell>;
}
