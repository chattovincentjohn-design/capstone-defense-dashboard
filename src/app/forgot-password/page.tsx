"use client";
import { BrandLogo } from "@/components/app/brand";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMAIL_RE } from "@/lib/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const RESEND_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });
    setBusy(false);
    const status = (err as { status?: number } | null)?.status ?? 0;
    if (err && (status === 429 || /rate limit/i.test(err.message))) {
      return setError("Too many reset emails were requested. Please wait a few minutes and try again.");
    }
    if (err && (status >= 500 || status === 0)) {
      return setError("We couldn't send the email right now. Try again later, or ask the Capstone Coordinator to reset your password.");
    }
    // Same response whether or not the account exists, so addresses can't be probed.
    setSentTo(address);
    setCooldown(RESEND_SECONDS);
  };

  return (
    <div className="mx-auto mt-24 max-w-sm space-y-3 px-4">
      <Button asChild variant="ghost" size="sm"><Link href="/login"><ArrowLeft /> Back to sign in</Link></Button>
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <BrandLogo size={96} />
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-gray">JHCSC · School of Computing Studies</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Reset your password</CardTitle></CardHeader>
        <CardContent>
          {!isSupabaseConfigured() ? (
            <p className="text-sm text-muted-foreground">This deployment runs in demo mode; there are no passwords to reset.</p>
          ) : (
            <form onSubmit={submit} className="space-y-3" noValidate>
              {sentTo ? (
                <div role="status" className="flex gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
                  <MailCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <p>If <span className="font-medium">{sentTo}</span> has an account, a reset link is on its way. It expires in one hour.
                    Check spam if it doesn&apos;t arrive in a few minutes.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</p>
              )}
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={busy || cooldown > 0}>
                <Send /> {busy ? "Sending…" : cooldown > 0 ? `Send again in ${cooldown}s` : sentTo ? "Send again" : "Send reset link"}
              </Button>
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <p className="text-xs text-muted-foreground">No email? The Capstone Coordinator can also issue you a new temporary password.</p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
