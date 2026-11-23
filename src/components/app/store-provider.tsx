"use client";
import { DemoStoreProvider } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { SupabaseStoreProvider } from "@/lib/supabase/store";
import { ErrorToast } from "./error-toast";

/** Real backend when Supabase env vars are present at build time; otherwise the in-browser demo. */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const Provider = isSupabaseConfigured() ? SupabaseStoreProvider : DemoStoreProvider;
  return (
    <Provider>
      {children}
      <ErrorToast />
    </Provider>
  );
}
