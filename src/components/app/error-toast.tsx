"use client";
import { AlertTriangle, X } from "lucide-react";
import { useStore } from "@/lib/store";

export function ErrorToast() {
  const { error, clearError } = useStore();
  if (!error) return null;
  return (
    <div role="alert" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-lg items-start gap-2 rounded-md border border-destructive/50 bg-card px-3 py-2.5 text-sm shadow-lg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="flex-1">{error}</p>
      <button onClick={clearError} aria-label="Dismiss" className="rounded p-0.5 hover:bg-accent"><X className="size-4" /></button>
    </div>
  );
}
