import { AppShell } from "@/components/shell/app-shell";

export default function FacilitiesLayout({ children }: LayoutProps<"/facilities">) {
  return <AppShell returnTo="/facilities">{children}</AppShell>;
}
