"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABEL } from "@/lib/types";

const MIN_LENGTH = 10;

export default function AccountPage() {
  const { mode, currentUser, state } = useStore();
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const problem = pw.length < MIN_LENGTH ? `Use at least ${MIN_LENGTH} characters.` : pw !== confirm ? "Passwords do not match." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw(""); setConfirm("");
    setMsg({ ok: true, text: "Password changed. Use the new one next time you sign in." });
  };

  return (
    <div className="mx-auto mt-16 max-w-md space-y-4 px-4">
      <Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft /> Back to dashboard</Link></Button>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Change password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {state.hydrated && (
            <p className="text-sm"><span className="font-medium">{currentUser.full_name}</span>
              <span className="text-muted-foreground"> · {currentUser.email} · {ROLE_LABEL[currentUser.role]}</span></p>
          )}
          {mode === "demo" ? (
            <p className="text-sm text-muted-foreground">Demo mode has no passwords.</p>
          ) : (
            <form onSubmit={submit} className="space-y-3" noValidate>
              <div className="space-y-1">
                <Label htmlFor="new-pw">New password</Label>
                <Input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-pw">Confirm new password</Label>
                <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
              {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"}>{msg.text}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
