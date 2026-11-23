"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured()) return setMsg("Supabase is not configured — the app is running in demo mode.");
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${next}` } });
    setMsg(error ? error.message : "Check your inbox for the sign-in link.");
  };

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <Card>
        <CardHeader><CardTitle>Faculty Sign-in</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={send} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Institutional email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button className="w-full" type="submit">Send magic link</Button>
            {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
