"use client";
import * as React from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/** Only allow same-site relative redirects. */
function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured()) {
      window.location.assign("/");
      return;
    }
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setMsg(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
      setBusy(false);
      return;
    }
    window.location.assign(safeNext());
  };

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <Card>
        <CardHeader><CardTitle>Capstone Defense · Sign in</CardTitle></CardHeader>
        <CardContent>
          {!isSupabaseConfigured() ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">This deployment runs in demo mode; no sign-in is needed.</p>
              <Button className="w-full" onClick={() => window.location.assign("/")}>Open the demo</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={busy}><LogIn /> {busy ? "Signing in…" : "Sign in"}</Button>
              {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
              <p className="text-xs text-muted-foreground">Accounts are issued by the Capstone Coordinator.</p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
