"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, KeyRound, Plus, Send, Trash2, XCircle } from "lucide-react";
import { BrandLogo } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_GROUP_MEMBERS, registrationProblems } from "@/lib/admin";
import { useStore } from "@/lib/store";
import type { MemberInput, RegistrationFormInfo, RegistrationInput } from "@/lib/types";

const NOT_LISTED = "__not_listed__";
const blankMember = (): MemberInput => ({ student_name: "", student_number: "", email: "" });
const currentAy = () => {
  const now = new Date();
  const start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1; // school year starts mid-year
  return `${start}-${start + 1}`;
};
const blank = (): RegistrationInput => ({
  group_label: "", title: "", academic_year: currentAy(), adviser_id: null, adviser_name: "",
  members: [blankMember(), blankMember(), blankMember()], manuscript_url: "", demo_url: "", abstract: "", contact_email: "",
});
const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export default function RegisterPage() {
  const { ops, state } = useStore();
  const [code, setCode] = React.useState("");
  const [info, setInfo] = React.useState<RegistrationFormInfo | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [f, setF] = React.useState<RegistrationInput>(blank);
  const [adviserChoice, setAdviserChoice] = React.useState("");
  const [attempted, setAttempted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<RegistrationInput | null>(null);

  // Show "closed" before asking for a code.
  const [closed, setClosed] = React.useState(false);
  React.useEffect(() => {
    // The check works signed out; re-run once demo data has loaded from the browser.
    ops.registrationInfo("").then((i) => setClosed(!i.open)).catch(() => setClosed(false));
  }, [ops, state.hydrated]);

  const set = <K extends keyof RegistrationInput>(k: K, v: RegistrationInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setMember = (i: number, k: keyof MemberInput, v: string) =>
    setF((x) => ({ ...x, members: x.members.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));

  // Ignore rows the group left completely empty.
  const filled = { ...f, members: f.members.filter((m) => m.student_name.trim() || m.student_number.trim() || m.email.trim()) };
  const problems = registrationProblems(filled);

  const checkCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setCodeError(null);
    try {
      const i = await ops.registrationInfo(code);
      if (!i.open) { setClosed(true); return; }
      if (!i.valid) { setCodeError("That code is not correct. Ask your Capstone Coordinator for the group registration code."); return; }
      setInfo(i);
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
      await ops.submitRegistration(code, filled);
      setDone(filled);
      window.scrollTo({ top: 0, behavior: "smooth" });
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
      <h1 className="text-lg font-bold uppercase tracking-wider">Group Registration</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Register your capstone group for CDEMS. One submission per group, filled in by the group leader.
      </p>
    </div>
  );

  if (done) {
    return (
      <div className="mx-auto my-10 max-w-xl px-4">
        {header}
        <Card>
          <CardContent className="space-y-3 p-6 text-sm">
            <p className="flex items-center gap-2 text-base font-semibold text-success"><CheckCircle2 className="size-5" /> Registration received</p>
            <p><span className="text-muted-foreground">Group:</span> {done.group_label} · {done.title}</p>
            <p><span className="text-muted-foreground">Members:</span> {done.members.map((m) => m.student_name).join(", ")}</p>
            <p className="text-muted-foreground">
              The Capstone Coordinator will review it and schedule your defense. Each member will receive their own CDEMS
              sign-in details privately. If you made a mistake, contact the Coordinator instead of submitting again.
            </p>
            <Button variant="outline" onClick={() => { setDone(null); setF(blank()); setAdviserChoice(""); setAttempted(false); }}>
              Register another group
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (closed && !info) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardContent className="space-y-2 p-6 text-center text-sm">
            <p className="font-semibold">Group registration is closed right now.</p>
            <p className="text-muted-foreground">Ask your Capstone Coordinator when it opens.</p>
            <Link href="/login" className="text-xs text-primary hover:underline">Faculty and students: sign in</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        {header}
        <Card>
          <CardHeader><CardTitle>Registration code</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={checkCode} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="reg-code">Enter the code from your Capstone Coordinator</Label>
                <Input id="reg-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus placeholder="e.g. SCS-2026" />
              </div>
              <Button type="submit" className="w-full" disabled={checking || !code.trim()}>
                <KeyRound /> {checking ? "Checking…" : "Continue"}
              </Button>
              {codeError && <p role="alert" className="text-xs text-destructive">{codeError}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto my-10 max-w-3xl px-4">
      {header}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card>
          <CardHeader><CardTitle>1 · Project</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="r-title">Project title</Label>
              <Input id="r-title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Complete title, exactly as on your manuscript" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-group">Group name</Label>
              <Input id="r-group" value={f.group_label} onChange={(e) => set("group_label", e.target.value)} placeholder="As assigned, e.g. Group 9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-ay">Academic year</Label>
              <Input id="r-ay" value={f.academic_year} onChange={(e) => set("academic_year", e.target.value)} placeholder="2026-2027" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="r-adviser">Adviser</Label>
              <NativeSelect id="r-adviser" value={adviserChoice} onChange={(e) => {
                const v = e.target.value;
                setAdviserChoice(v);
                setF((x) => ({ ...x, adviser_id: v && v !== NOT_LISTED ? v : null }));
              }}>
                <option value="">— Choose your adviser —</option>
                {info.advisers.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                <option value={NOT_LISTED}>My adviser is not listed…</option>
              </NativeSelect>
              {adviserChoice === NOT_LISTED && (
                <Input aria-label="Adviser's full name" className="mt-2" value={f.adviser_name} onChange={(e) => set("adviser_name", e.target.value)}
                  placeholder="Adviser's full name with title, e.g. Engr. Paolo D. Reyes" />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-ms">Manuscript link (PDF)</Label>
              <Input id="r-ms" type="url" value={f.manuscript_url} onChange={(e) => set("manuscript_url", e.target.value)} placeholder="https://drive.google.com/…" />
              <p className="text-[11px] text-muted-foreground">Optional. Set sharing to &quot;Anyone at JHCSC with the link can view&quot;.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-demo">Live demo link</Label>
              <Input id="r-demo" type="url" value={f.demo_url} onChange={(e) => set("demo_url", e.target.value)} placeholder="https://…" />
              <p className="text-[11px] text-muted-foreground">Optional.</p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="r-abs">Abstract</Label>
              <Textarea id="r-abs" rows={4} value={f.abstract} onChange={(e) => set("abstract", e.target.value)} placeholder="Short summary of the project (about 150–250 words)" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>2 · Members</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Each member gets their own CDEMS account to see their grade, so use an email each member can open.
            </p>
            <div className="space-y-2">
              {f.members.map((m, i) => (
                <div key={i} className="grid gap-2 rounded-md border bg-background/40 p-2 sm:grid-cols-[1.4fr_1fr_1.4fr_auto] sm:items-center">
                  <Input aria-label={`Member ${i + 1} full name`} value={m.student_name} onChange={(e) => setMember(i, "student_name", e.target.value)} placeholder={`Member ${i + 1}: full name`} />
                  <Input aria-label={`Member ${i + 1} student number`} value={m.student_number} onChange={(e) => setMember(i, "student_number", e.target.value)} placeholder="Student No., e.g. 2022-00811" />
                  <Input aria-label={`Member ${i + 1} email`} type="email" value={m.email} onChange={(e) => setMember(i, "email", e.target.value)} placeholder="Email" />
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove member ${i + 1}`} disabled={f.members.length === 1}
                    onClick={() => setF((x) => ({ ...x, members: x.members.filter((_, j) => j !== i) }))}><Trash2 /></Button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" disabled={f.members.length >= MAX_GROUP_MEMBERS}
              onClick={() => setF((x) => ({ ...x, members: [...x.members, blankMember()] }))}><Plus /> Add member</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>3 · Group leader</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <Label htmlFor="r-contact">Contact email</Label>
            <Input id="r-contact" type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} placeholder="Where the Coordinator can reach your group" />
          </CardContent>
        </Card>

        {((attempted && problems.length > 0) || serverError) && (
          <Card className="border-destructive/60">
            <CardContent className="p-4">
              <ul className="space-y-1 text-xs text-destructive" aria-live="polite">
                {attempted && problems.map((p) => <li key={p} className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{p}</li>)}
                {serverError && <li className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{serverError}</li>}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Check every name and student number. They appear on official documents.</p>
          <Button type="submit" disabled={busy || (attempted && problems.length > 0)}>
            <Send /> {busy ? "Submitting…" : "Submit registration"} {!busy && <ArrowRight />}
          </Button>
        </div>
      </form>
    </div>
  );
}
