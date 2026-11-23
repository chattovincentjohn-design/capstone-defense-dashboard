"use client";
import { UserCog } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { useStore } from "@/lib/store";
import { ROLE_LABEL } from "@/lib/types";

/** Demo-only identity switcher. With Supabase configured, identity comes from auth. */
export function RoleSwitcher() {
  const { users, currentUser, setUser } = useStore();
  return (
    <label className="flex w-full items-center gap-2 text-xs text-muted-foreground sm:w-auto">
      <UserCog className="size-4 text-primary" aria-hidden />
      <span className="hidden sm:inline">Viewing as</span>
      <NativeSelect className="h-8 w-full min-w-0 text-xs sm:w-56" value={currentUser.id} onChange={(e) => setUser(e.target.value)} aria-label="Switch demo user">
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.full_name} — {ROLE_LABEL[u.role]}</option>
        ))}
      </NativeSelect>
    </label>
  );
}
