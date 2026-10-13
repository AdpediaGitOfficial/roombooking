import { AppShell } from "@/components/shell/app-shell";

export default function SecurityLayout({ children }: LayoutProps<"/security">) {
  return <AppShell returnTo="/security">{children}</AppShell>;
}
