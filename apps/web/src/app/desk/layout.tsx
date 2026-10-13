import { AppShell } from "@/components/shell/app-shell";

export default function DeskLayout({ children }: LayoutProps<"/desk">) {
  return <AppShell returnTo="/desk">{children}</AppShell>;
}
