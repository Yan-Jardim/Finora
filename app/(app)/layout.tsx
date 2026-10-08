import { requireHousehold } from "@/lib/auth/session";
import { DATA_SOURCE } from "@/lib/config/data-source";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { ToastProvider } from "@/components/providers/toast-provider";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";

/** Shell autenticado: exige sessão válida e household (senão, login/onboarding). */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Defesa em profundidade: além do proxy, o servidor confere sessão e household antes de renderizar.
  const session = await requireHousehold();

  return (
    <ToastProvider>
      <WorkspaceProvider
        config={{
          mode: DATA_SOURCE,
          householdId: session.householdId,
          currentProfileId: session.currentProfileId,
          timezone: session.householdTimezone,
        }}
      >
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header user={{ name: session.displayName, email: session.email, householdName: session.householdName }} />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
          </div>
        </div>
      </WorkspaceProvider>
    </ToastProvider>
  );
}
