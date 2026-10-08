import { Construction } from "lucide-react";
import { Card } from "./card";
import { EmptyState } from "./empty-state";

/** Placeholder das telas do MVP que ainda serão implementadas. */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card>
        <EmptyState icon={Construction} title="Tela em construção" description="Esta área será a próxima etapa do desenvolvimento." />
      </Card>
    </div>
  );
}
