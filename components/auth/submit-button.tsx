"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Botão de envio que se desabilita e mostra progresso enquanto a Server Action roda. */
export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${error ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}
    >
      {error ?? message}
    </p>
  );
}
