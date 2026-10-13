import { AppShell } from "@/components/shell/app-shell";

export default function ApprovalsLayout({ children }: LayoutProps<"/approvals">) {
  return <AppShell returnTo="/approvals">{children}</AppShell>;
}
