import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  color,
  className,
  label,
}: {
  /** 0–100 */
  value: number;
  color?: string;
  className?: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}
