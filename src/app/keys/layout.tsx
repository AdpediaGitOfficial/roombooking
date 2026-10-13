import { AppShell } from "@/components/shell/app-shell";

export default function KeysLayout({ children }: LayoutProps<"/keys">) {
  return <AppShell returnTo="/keys">{children}</AppShell>;
}
