"use client";
import * as React from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const MIN_LENGTH = 10;

/** Reached from the emailed link (via /auth/confirm, which signs the person in for this purpose). */
export default function ResetPasswordPage() {
  const [status, setStatus] = React.useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isSupabaseConfigured()) return setStatus("invalid");
    if (new URLSearchParams(window.location.search).get("error")) return setStatus("invalid");
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) { setEmail(data.user.email ?? ""); setStatus("ready"); } else setStatus("invalid");
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (pw !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    const sb = createClient();
    const { error: err } = await sb.auth.updateUser({ password: pw });
    if (err) {
      setBusy(false);
      return setError(/same/i.test(err.message) ? "Choose a password different from your current one." : err.message);
    }
    await sb.auth.signOut({ scope: "others" }); // end sessions on other devices
    setBusy(false);
    setStatus("done");
  };

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Choose a new password</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status === "checking" && <p className="text-muted-foreground">Checking your reset link…</p>}
          {status === "invalid" && (
            <>
              <p role="alert">This reset link is invalid or has expired. Links work once and last one hour.</p>
              <Button asChild className="w-full"><Link href="/forgot-password">Request a new link</Link></Button>
            </>
          )}
          {status === "done" && (
            <>
              <p role="status" className="text-success">Your password has been changed and other devices were signed out.</p>
              <Button className="w-full" onClick={() => window.location.assign("/")}>Continue to the dashboard</Button>
            </>
          )}
          {status === "ready" && (
            <form onSubmit={submit} className="space-y-3" noValidate>
              <p className="text-muted-foreground">Account: <span className="text-foreground">{email}</span></p>
              <div className="space-y-1">
                <Label htmlFor="new-pw">New password</Label>
                <Input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-pw">Confirm new password</Label>
                <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
