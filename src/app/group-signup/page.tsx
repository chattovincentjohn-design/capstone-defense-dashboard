"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Search, UserPlus, XCircle } from "lucide-react";
import { BrandLogo } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMAIL_RE, MIN_PASSWORD } from "@/lib/admin";
import { useStore } from "@/lib/store";
import type { GroupSignupMatch } from "@/lib/types";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export default function GroupSignupPage() {
  const { ops, state } = useStore();
  const [step, setStep] = React.useState<"code" | "identify" | "password" | "done">("code");
  const [closed, setClosed] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [studentNumber, setStudentNumber] = React.useState("");
  const [match, setMatch] = React.useState<GroupSignupMatch | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    ops.groupSignupInfo("").then((i) => setClosed(!i.open)).catch(() => setClosed(false));
  }, [ops, state.hydrated]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const pwProblem = password.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters.`
    : password.length > 72 ? "Password must be at most 72 characters."
    : password !== confirm ? "The two passwords do not match." : null;

  const header = (
    <div className="mb-5 flex flex-col items-center gap-2 text-center">
      <BrandLogo size={80} />
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">JHCSC · School of Computing Studies</p>
      <h1 className="text-lg font-bold uppercase tracking-wider">Group Account Sign-up</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Create your capstone group&apos;s CDEMS account. Each group has one account, used by one authorized member.
      </p>
    </div>
  );
  const errorLine = error && (
    <p role="alert" className="flex gap-1.5 text-xs text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{error}</p>
  );

  if (closed && step === "code") {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardContent className="space-y-2 p-6 text-center text-sm">
            <p className="font-semibold">Group account sign-up is closed right now.</p>
            <p className="text-muted-foreground">Ask your Capstone Coordinator when it opens, or ask them to create your group account.</p>
            <Link href="/login" className="text-xs text-primary hover:underline">Already have an account? Sign in</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto my-10 max-w-md px-4">
      {header}
      {step === "code" && (
        <Card>
          <CardHeader><CardTitle>Step 1 of 3 · Sign-up code</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const i = await ops.groupSignupInfo(code);
                if (!i.open) { setClosed(true); return; }
                if (!i.valid) throw new Error("That code is not correct. Ask your Capstone Coordinator for the group account sign-up code.");
                setStep("identify");
              });
            }}>
              <div className="space-y-1">
                <Label htmlFor="gs-code">Enter the code from your Capstone Coordinator</Label>
                <Input id="gs-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus placeholder="e.g. GRP-7KQ4-M2XP" />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !code.trim()}><KeyRound /> {busy ? "Checking…" : "Continue"}</Button>
              {errorLine}
              <p className="text-center text-xs text-muted-foreground">
                Not registered yet? <Link href="/register" className="text-primary hover:underline">Register your group</Link> instead.
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      {step === "identify" && (
        <Card>
          <CardHeader><CardTitle>Step 2 of 3 · Who are you?</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setMatch(await ops.groupSignupLookup(code, email, studentNumber));
                setStep("password");
              });
            }}>
              <p className="text-xs text-muted-foreground">
                Enter your email and student number exactly as your group gave them to the Coordinator. You become the group&apos;s
                authorized member and sign in with this email.
              </p>
              <div className="space-y-1">
                <Label htmlFor="gs-email">Your email</Label>
                <Input id="gs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="acruz@jhcsc.edu.ph" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gs-num">Your student number</Label>
                <Input id="gs-num" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} autoComplete="off" placeholder="2022-00811" />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !EMAIL_RE.test(email.trim()) || !studentNumber.trim()}>
                <Search /> {busy ? "Finding your group…" : "Find my group"}
              </Button>
              {errorLine}
            </form>
          </CardContent>
        </Card>
      )}

      {step === "password" && match && (
        <Card>
          <CardHeader><CardTitle>Step 3 of 3 · Set the group password</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              if (pwProblem) { setError(pwProblem); return; }
              void run(async () => {
                await ops.groupSignup(code, { email, student_number: studentNumber, password });
                setStep("done");
              });
            }}>
              <div className="rounded-md border bg-background/40 p-3 text-sm">
                <p><span className="text-muted-foreground">Group:</span> <b>{match.group_label}</b></p>
                <p className="text-xs text-muted-foreground">{match.title}</p>
                <p className="mt-1"><span className="text-muted-foreground">Authorized member:</span> {match.student_name}</p>
                <p><span className="text-muted-foreground">Sign-in email:</span> {email.trim().toLowerCase()}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gs-pw">Password</Label>
                <div className="relative">
                  <Input id="gs-pw" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password" className="pr-9" />
                  <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((v) => !v)}>
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">At least {MIN_PASSWORD} characters. Keep it within your group.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gs-pw2">Confirm password</Label>
                <Input id="gs-pw2" type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" disabled={busy}><UserPlus /> {busy ? "Creating the group account…" : "Create group account"}</Button>
              {errorLine}
              <Button type="button" variant="ghost" size="sm" onClick={() => { setStep("identify"); setError(null); }}><ArrowLeft /> Not your group?</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === "done" && match && (
        <Card>
          <CardContent className="space-y-3 p-6 text-sm">
            <p className="flex items-center gap-2 text-base font-semibold text-success"><CheckCircle2 className="size-5" /> Group account ready</p>
            <p><span className="text-muted-foreground">Group:</span> {match.group_label} · {match.title}</p>
            <p><span className="text-muted-foreground">Sign-in email:</span> {email.trim().toLowerCase()}</p>
            <p className="text-muted-foreground">
              You are signed in. After the defense is locked you will see the verdict, comments, minutes and every member&apos;s grade.
            </p>
            <Button className="w-full" onClick={() => window.location.assign("/")}>Go to our dashboard</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
