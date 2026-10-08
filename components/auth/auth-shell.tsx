import { Brand } from "@/components/layout/brand";

/** Moldura das telas fora do app (login, cadastro, onboarding): centralizada, sem sidebar. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
        </section>
        {footer && <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p>}
      </div>
    </main>
  );
}
