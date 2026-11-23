"use client";
import * as React from "react";
import { CalendarPlus, Check, Copy, ExternalLink, Lock, RotateCcw, Save, Shuffle, Trash2, Unlock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { generateRegistrationCode } from "@/lib/admin";
import { useStore } from "@/lib/store";
import type { GroupRegistration, RegistrationSettings, RegistrationStatus } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

const STATUS_LABEL: Record<RegistrationStatus, string> = { pending: "Pending", scheduled: "Scheduled", rejected: "Rejected" };
const STATUS_VARIANT: Record<RegistrationStatus, "warning" | "success" | "muted"> = { pending: "warning", scheduled: "success", rejected: "muted" };
const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export function RegistrationsManager({ onSchedule }: { onSchedule: (r: GroupRegistration) => void }) {
  const { ops, users, state } = useStore();
  const [regs, setRegs] = React.useState<GroupRegistration[] | null>(null);
  const [settings, setSettings] = React.useState<RegistrationSettings | null>(null);
  const [codeDraft, setCodeDraft] = React.useState("");
  const [filter, setFilter] = React.useState<RegistrationStatus | "all">("pending");
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const [r, s] = await Promise.all([ops.listRegistrations(), ops.getRegistrationSettings()]);
      setRegs(r);
      setSettings(s);
      setCodeDraft(s.access_code);
    } catch (e) {
      setNotice({ ok: false, text: `Could not load registrations: ${errorText(e)}` });
    }
  }, [ops]);
  // Demo data lives in the store, so reload when it changes (e.g. a submission from another tab).
  React.useEffect(() => { void reload(); }, [reload, state.hydrated]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ ok: true, text: ok });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const link = typeof window !== "undefined" ? `${window.location.origin}/register` : "/register";
  const shown = (regs ?? []).filter((r) => filter === "all" || r.status === filter);
  const count = (s: RegistrationStatus) => (regs ?? []).filter((r) => r.status === s).length;
  const adviserName = (r: GroupRegistration) => users.find((u) => u.id === r.adviser_id)?.full_name;
  const codeChanged = settings && codeDraft.trim() !== settings.access_code;
  const [codeCopied, setCodeCopied] = React.useState(false);

  /** New random code, saved right away (the old code stops working). */
  const regenerate = () => {
    if (!settings) return;
    const code = generateRegistrationCode();
    setCodeDraft(code);
    void act(() => ops.saveRegistrationSettings({ ...settings, access_code: code }),
      settings.is_open ? `New code ${code} saved. The old code no longer works; share the new one.` : `New code ${code} saved.`);
  };
  /** Opening without a code creates one automatically. */
  const openRegistration = () => {
    const code = codeDraft.trim().length >= 4 ? codeDraft.trim() : generateRegistrationCode();
    setCodeDraft(code);
    void act(() => ops.saveRegistrationSettings({ is_open: true, access_code: code }),
      `Registration is now open with code ${code}. Share the link and code with group leaders.`);
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p role="status" className={notice.ok ? "text-sm text-success" : "text-sm text-destructive"}>{notice.text}</p>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Group registration page</CardTitle>
          {settings && (settings.is_open
            ? <Badge variant="success"><Unlock className="size-3" /> Open</Badge>
            : <Badge variant="muted"><Lock className="size-3" /> Closed</Badge>)}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Group leaders fill in their project and members on this page. They need the registration code below.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="reg-link">Link to share with students</Label>
              <div className="flex gap-2">
                <Input id="reg-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
                <Button asChild variant="ghost" size="icon" aria-label="Open registration page"><a href="/register" target="_blank" rel="noreferrer"><ExternalLink /></a></Button>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="reg-code">Registration code</Label>
              <div className="flex gap-2">
                <Input id="reg-code" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} placeholder="Click Generate, or type your own" autoComplete="off" className="font-mono" />
                <Button type="button" variant="outline" disabled={!codeDraft.trim()} aria-label="Copy code"
                  onClick={() => void navigator.clipboard?.writeText(codeDraft.trim()).then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); })}>
                  {codeCopied ? <Check /> : <Copy />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Generate makes a random code and saves it. You can also type your own (at least 4 characters) and click Save. Not case-sensitive.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy || !settings} onClick={regenerate}>
                <Shuffle /> Generate code
              </Button>
              {codeChanged && (
                <Button type="button" variant="outline" disabled={busy || !settings}
                  onClick={() => settings && void act(() => ops.saveRegistrationSettings({ ...settings, access_code: codeDraft }), "Registration code saved.")}>
                  <Save /> Save
                </Button>
              )}
            </div>
            {settings?.is_open ? (
              <Button type="button" variant="destructive" disabled={busy}
                onClick={() => void act(() => ops.saveRegistrationSettings({ is_open: false, access_code: codeDraft }), "Registration is now closed.")}>
                <Lock /> Close registration
              </Button>
            ) : (
              <Button type="button" disabled={busy || !settings} onClick={openRegistration}>
                <Unlock /> Open registration
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {regs ? `${count("pending")} pending · ${count("scheduled")} scheduled · ${count("rejected")} rejected` : "Loading…"}
        </p>
        <NativeSelect aria-label="Show registrations" className="h-9 w-44" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="pending">Pending</option>
          <option value="scheduled">Scheduled</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </NativeSelect>
      </div>

      {regs && shown.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {filter === "pending" ? "No registrations waiting. New submissions appear here." : "Nothing to show."}
        </CardContent></Card>
      )}

      {shown.map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="normal-case tracking-normal">{r.group_label}: {r.title}</CardTitle>
              <p className="text-xs text-muted-foreground">
                A.Y. {r.academic_year} · Submitted {fmtDateTime(r.created_at)} · Leader: {r.contact_email}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Adviser: </span>
              {adviserName(r) ?? (r.adviser_name
                ? <>{r.adviser_name} <Badge variant="warning" className="ml-1">No CDEMS account yet</Badge></>
                : "—")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b"><th className="py-1.5 text-left font-medium">Member</th><th className="text-left font-medium">Student No.</th><th className="text-left font-medium">Email</th></tr>
                </thead>
                <tbody>
                  {r.members.map((m) => (
                    <tr key={m.student_number + m.email} className="border-b last:border-0">
                      <td className="py-1.5">{m.student_name}</td><td className="font-mono">{m.student_number}</td><td>{m.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(r.manuscript_url || r.demo_url) && (
              <p className="flex flex-wrap gap-3 text-xs">
                {r.manuscript_url && <a className="text-primary hover:underline" href={r.manuscript_url} target="_blank" rel="noreferrer">Manuscript ↗</a>}
                {r.demo_url && <a className="text-primary hover:underline" href={r.demo_url} target="_blank" rel="noreferrer">Live demo ↗</a>}
              </p>
            )}
            {r.abstract && <p className="whitespace-pre-line rounded-md border bg-background/40 p-2 text-xs text-muted-foreground">{r.abstract}</p>}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {r.status === "pending" && (
                <>
                  <Button size="sm" onClick={() => onSchedule(r)}><CalendarPlus /> Schedule defense</Button>
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void act(() => ops.setRegistrationStatus(r.id, "rejected"), `${r.group_label}'s registration was rejected.`)}><X /> Reject</Button>
                </>
              )}
              {r.status !== "pending" && (
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void act(() => ops.setRegistrationStatus(r.id, "pending"), `${r.group_label} is back in Pending.`)}><RotateCcw /> Move back to pending</Button>
              )}
              {confirmDelete === r.id ? (
                <>
                  <span className="text-xs text-muted-foreground">Delete this submission?</span>
                  <Button size="sm" variant="destructive" disabled={busy}
                    onClick={() => void act(() => ops.deleteRegistration(r.id), "Submission deleted.").then(() => setConfirmDelete(null))}>Delete</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r.id)}><Trash2 /> Delete</Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
