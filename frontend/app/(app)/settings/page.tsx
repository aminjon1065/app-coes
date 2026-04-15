import { MfaPanel } from "@/components/settings/mfa-panel";
import { loadSecurityWorkspace } from "@/lib/api/security-workspace";

export default async function SettingsPage() {
  const workspace = await loadSecurityWorkspace();

  return (
    <main className="space-y-6 pb-8">
      <MfaPanel workspace={workspace} />
    </main>
  );
}
