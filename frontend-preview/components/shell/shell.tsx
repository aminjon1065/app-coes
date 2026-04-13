import { TopBar } from "./top-bar";
import { Sidebar } from "./sidebar";

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="min-h-screen bg-coescd-bg">
      <TopBar />
      <Sidebar />
      <div className="pt-[48px] pl-[240px] min-h-screen">
        {children}
      </div>
    </div>
  );
}
