import { AppShell } from "@/components/shell/app-shell";

export default function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  return <AppShell returnTo="/inventory">{children}</AppShell>;
}
