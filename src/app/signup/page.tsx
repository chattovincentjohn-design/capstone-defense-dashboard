"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Eye, EyeOff, KeyRound, UserPlus, XCircle } from "lucide-react";
import { BrandLogo } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FACULTY_SIGNUP_ROLES, facultySignupProblems, MIN_PASSWORD } from "@/lib/admin";
import { useStore } from "@/lib/store";
import { ROLE_LABEL, type FacultySignupInput } from "@/lib/types";

const blank = (): FacultySignupInput => ({ full_name: "", email: "", password: "", role: "panelist", department: "" });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export default function FacultySignupPage() {
  const { ops, state } = useStore();
  const [code, setCode] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [f, setF] = React.useState<FacultySignupInput>(blank);
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<FacultySignupInput | null>(null);

  React.useEffect(() => {
    ops.facultySignupInfo("").then((i) => setClosed(!i.open)).catch(() => setClosed(false));
  }, [ops, state.hydrated]);

  const set = <K extends keyof FacultySignupInput>(k: K, v: FacultySignupInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = facultySignupProblems(f, confirm);

  const checkCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setCodeError(null);
    try {
      const i = await ops.facultySignupInfo(code);
      if (!i.open) { setClosed(true); return; }
      if (!i.valid) { setCodeError("That code is not correct. Ask the Capstone Coordinator for the faculty sign-up code."); return; }
      setVerified(true);
    } catch (err) {
      setCodeError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (problems.length) return;
    setBusy(true);
    setServerError(null);
    try {
      await ops.facultySignup(code, f);
      setDone(f);
    } catch (err) {
      setServerError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="mb-5 flex flex-col items-center gap-2 text-center">
      <BrandLogo size={80} />
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">JHCSC · School of Computing Studies</p>
      <h1 className="text-lg font-bold uppercase tracking-wider">Faculty Sign-up</h1>
      <p className="max-w-md text-sm text-muted-foreground">Create your CDEMS account to serve as panel member, chair, secretary or adviser.</p>
    </div>
  );

  if (done) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardContent className="space-y-3 p-6 text-sm">
            <p className="flex items-center gap-2 text-base font-semibold text-success"><CheckCircle2 className="size-5" /> Your account is ready</p>
            <p><span className="text-muted-foreground">Name:</span> {done.full_name.trim()}</p>
            <p><span className="text-muted-foreground">Sign-in email:</span> {done.email.trim().toLowerCase()}</p>
            <p><span className="text-muted-foreground">Role:</span> {ROLE_LABEL[done.role]}</p>
            <p className="text-muted-foreground">
              You are signed in. Defenses you are assigned to will appear on your dashboard once the Coordinator schedules them.
            </p>
            <Button className="w-full" onClick={() => window.location.assign("/")}>Go to my dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (closed && !verified) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardContent className="space-y-2 p-6 text-center text-sm">
            <p className="font-semibold">Faculty sign-up is closed right now.</p>
            <p className="text-muted-foreground">Ask the Capstone Coordinator to create your account or to open sign-up.</p>
            <Link href="/login" className="text-xs text-primary hover:underline">Already have an account? Sign in</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardHeader><CardTitle>Faculty sign-up code</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={checkCode} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="fac-code">Enter the code from the Capstone Coordinator</Label>
                <Input id="fac-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus placeholder="e.g. FAC-7KQ4-M2XP" />
              </div>
              <Button type="submit" className="w-full" disabled={checking || !code.trim()}>
                <KeyRound /> {checking ? "Checking…" : "Continue"}
              </Button>
              {codeError && <p role="alert" className="text-xs text-destructive">{codeError}</p>}
              <p className="text-center text-xs text-muted-foreground">
                Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto my-10 max-w-xl px-4">
      {header}
      <Card>
        <CardHeader><CardTitle>Your details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="su-name">Full name (as it appears on documents)</Label>
                <Input id="su-name" value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Prof. Juan P. Santos" autoComplete="name" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="su-email">Email (used to sign in)</Label>
                <Input id="su-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="jsantos@jhcsc.edu.ph" autoComplete="email" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="su-role">Role</Label>
                <NativeSelect id="su-role" value={f.role} onChange={(e) => set("role", e.target.value as FacultySignupInput["role"])}>
                  {FACULTY_SIGNUP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="su-dept">Department / section</Label>
                <Input id="su-dept" value={f.department} onChange={(e) => set("department", e.target.value)} placeholder="School of Computing Studies" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="su-pw">Password</Label>
                <div className="relative">
                  <Input id="su-pw" type={showPw ? "text" : "password"} value={f.password} onChange={(e) => set("password", e.target.value)}
                    autoComplete="new-password" className="pr-9" />
                  <button type="button" className="absolute inset-y-0 right-2 flex items-center text-muted-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((v) => !v)}>
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="su-pw2">Confirm password</Label>
                <Input id="su-pw2" type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
            </div>

            {((attempted && problems.length > 0) || serverError) && (
              <ul className="space-y-1 text-xs text-destructive" aria-live="polite">
                {attempted && problems.map((p) => <li key={p} className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{p}</li>)}
                {serverError && <li className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{serverError}</li>}
              </ul>
            )}

            <Button type="submit" className="w-full" disabled={busy || (attempted && problems.length > 0)}>
              <UserPlus /> {busy ? "Creating your account…" : "Create my account"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Coordinator accounts are created by the Super Admin, not here.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
