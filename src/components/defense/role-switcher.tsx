"use client";
import { LogOut, UserCog, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useStore } from "@/lib/store";
import { ROLE_LABEL } from "@/lib/types";

/** Demo: switch between the sample cast. Supabase: show who is signed in, with sign-out. */
export function RoleSwitcher() {
  const { mode, users, currentUser, setUser, signOut } = useStore();
  if (mode === "supabase") {
    return (
      <div className="flex w-full items-center justify-end gap-2 text-xs sm:w-auto">
        <UserRound className="size-4 text-primary" aria-hidden />
        <span className="truncate">
          <span className="font-medium">{currentUser.full_name}</span>
          <span className="text-muted-foreground"> · {ROLE_LABEL[currentUser.role]}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => void signOut()}><LogOut /> Sign out</Button>
      </div>
    );
  }
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
