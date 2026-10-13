import { AppShell } from "@/components/shell/app-shell";

export default function PeopleLayout({ children }: LayoutProps<"/people">) {
  return <AppShell returnTo="/people">{children}</AppShell>;
}
