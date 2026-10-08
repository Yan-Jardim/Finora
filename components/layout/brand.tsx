import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        F
      </span>
      <span className="text-base font-semibold tracking-tight">Finora</span>
    </Link>
  );
}
