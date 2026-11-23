"use client";
import { BrandLogo } from "@/components/app/brand";
import * as React from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/redirect";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import Link from "next/link";

const safeNext = () => safeNextPath(new URLSearchParams(window.location.search).get("next"));

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
      setMsg(
        error.message === "Invalid login credentials" ? "Incorrect email or password."
          : /banned/i.test(error.message) ? "This account is disabled. Contact the Capstone Coordinator."
          : error.message,
      );
      setBusy(false);
      return;
    }
    window.location.assign(safeNext());
  };

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <BrandLogo size={96} />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">JHCSC · School of Computing Studies</p>
      </div>
      <Card>
        <CardHeader><CardTitle>CDEMS · Sign in</CardTitle></CardHeader>
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
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
                </div>
                <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={busy}><LogIn /> {busy ? "Signing in…" : "Sign in"}</Button>
              {msg && <p role="alert" className="text-xs text-destructive">{msg}</p>}
              <p className="text-xs text-muted-foreground">Accounts are issued by the Capstone Coordinator.</p>
              <p className="text-xs text-muted-foreground">
                Group leader? <Link href="/register" className="text-primary hover:underline">Register your capstone group</Link>
              </p>
              <p className="text-xs text-muted-foreground">
                Faculty without an account? <Link href="/signup" className="text-primary hover:underline">Create your faculty account</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
