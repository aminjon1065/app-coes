import type { ReactNode } from "react";

type MobileLayoutProps = {
  children: ReactNode;
};

export default function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_36%),linear-gradient(180deg,#07101c,#0f172a_42%,#050914)] text-white">
      <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        {children}
      </div>
    </div>
  );
}
