import { AppShell } from "@/components/shell/app-shell";

export default function AccommodationLayout({ children }: LayoutProps<"/accommodation">) {
  return <AppShell returnTo="/accommodation">{children}</AppShell>;
}
