import { Suspense } from "react";
import { TabBar, TabLinks } from "./tab-bar";

export default function MyLayout({ children }: LayoutProps<"/my">) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <div className="flex-1 px-4 pt-6 pb-28">{children}</div>
      <Suspense fallback={<TabLinks />}><TabBar /></Suspense>
    </div>
  );
}
