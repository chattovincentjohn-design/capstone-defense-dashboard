"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, FileText, Loader2, Send, Upload, XCircle } from "lucide-react";
import { BrandLogo } from "@/components/app/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  defenseRequestChecklist, defenseRequestReady, FACULTY_ROLES, fromManilaInput, MAX_MANUSCRIPT_MB, MIN_ABSTRACT, manuscriptFileProblem,
} from "@/lib/admin";
import { useStore } from "@/lib/store";
import { STAGE_LABEL, type DefenseRequest, type DefenseRequestInput, type DefenseStage } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const STAGES: DefenseStage[] = ["title", "proposal", "final"];
const STATUS: Record<DefenseRequest["status"], { label: string; variant: "warning" | "success" | "muted" }> = {
  pending: { label: "Waiting for the Coordinator", variant: "warning" },
  scheduled: { label: "Scheduled", variant: "success" },
  rejected: { label: "Not approved", variant: "muted" },
  cancelled: { label: "Cancelled", variant: "muted" },
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export default function RequestDefensePage() {
  const { state, users, currentUser, ops } = useStore();
  const bundles = Object.values(state.bundles).filter((b) => b.members.some((m) => m.user_id === currentUser.id));
  const project = bundles[0]?.project;
  // Suggest the stage after the group's latest one (a group past its final defense re-requests the final).
  const latest = Math.max(-1, ...bundles.map((b) => STAGES.indexOf(b.session.stage)));
  const nextStage: DefenseStage = STAGES[Math.min(latest + 1, STAGES.length - 1)];

  const [requests, setRequests] = React.useState<DefenseRequest[] | null>(null);
  const [f, setF] = React.useState<DefenseRequestInput | null>(null);
  const [when, setWhen] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try { setRequests(await ops.listDefenseRequests()); } catch (e) { setError(errorText(e)); }
  }, [ops]);
  React.useEffect(() => { if (state.hydrated) void reload(); }, [reload, state.hydrated]);
  React.useEffect(() => {
    if (project && !f) {
      setF({ project_id: project.id, stage: nextStage, preferred_at: null, chair_id: "", member_ids: [], manuscript_path: "", abstract: project.abstract ?? "", note: "" });
    }
  }, [project, f, nextStage]);

  const header = (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <BrandLogo size={48} />
        <div>
          <h1 className="text-lg font-bold uppercase tracking-wider">Request a Defense</h1>
          <p className="text-xs text-muted-foreground">{project ? `${project.group_label} · ${project.title}` : "Your capstone group"}</p>
        </div>
      </div>
      <Button asChild size="sm" variant="ghost"><Link href="/"><ArrowLeft /> Back to dashboard</Link></Button>
    </header>
  );

  if (!state.hydrated) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;
  if (currentUser.role !== "student" || !project) {
    return (
      <div className="mx-auto my-10 max-w-xl px-4">
        {header}
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Only a capstone group&apos;s account can request a defense, and the group must already be in CDEMS.
        </CardContent></Card>
      </div>
    );
  }

  const pending = requests?.find((r) => r.status === "pending");
  const faculty = users.filter((u) => FACULTY_ROLES.includes(u.role) && u.id !== project.adviser_id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const name = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? "—";
  const checklist = f ? defenseRequestChecklist(f, project.adviser_id) : [];
  const ready = !!f && defenseRequestReady(f, project.adviser_id) && !uploading;

  const upload = async (file: File | undefined) => {
    if (!file || !f) return;
    setError(null);
    const problem = manuscriptFileProblem(file);
    if (problem) { setError(problem); return; }
    setUploading(true);
    try {
      const path = await ops.uploadManuscript(project.id, file);
      setF({ ...f, manuscript_path: path });
      setFileName(file.name);
    } catch (e) {
      setError(`Upload failed: ${errorText(e)}`);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await ops.submitDefenseRequest({ ...f, preferred_at: when ? fromManilaInput(when) : null });
      setNotice("Request sent. The Coordinator will confirm the panel and schedule your defense; you will see it on your dashboard.");
      setF(null);
      setWhen("");
      setFileName("");
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto my-8 max-w-3xl space-y-4 px-4">
      {header}
      {notice && <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}

      {requests && requests.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Your requests</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <span>
                  <b>{STAGE_LABEL[r.stage]}</b>
                  <span className="text-xs text-muted-foreground"> · sent {fmtDateTime(r.created_at)}
                    {r.preferred_at ? ` · preferred ${fmtDateTime(r.preferred_at)}` : ""} · Chair: {name(r.chair_id)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  {r.status === "pending" && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void ops.cancelDefenseRequest(r.id).then(reload).catch((e) => setError(errorText(e)))}>Cancel</Button>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {pending ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Your {STAGE_LABEL[pending.stage].toLowerCase()} request is waiting for the Coordinator. You can send a new one after it is scheduled, or cancel it above.
        </CardContent></Card>
      ) : f && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Card>
            <CardHeader><CardTitle>1 · Defense</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rq-stage">Defense stage</Label>
                <NativeSelect id="rq-stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as DefenseStage })}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rq-when">Preferred date &amp; time (optional)</Label>
                <Input id="rq-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>2 · Proposed panel</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">The Coordinator confirms or changes the panel when scheduling. Your adviser is not listed.</p>
              <div className="space-y-1">
                <Label htmlFor="rq-chair">Defense Chair</Label>
                <NativeSelect id="rq-chair" value={f.chair_id}
                  onChange={(e) => setF({ ...f, chair_id: e.target.value, member_ids: f.member_ids.filter((m) => m !== e.target.value) })}>
                  <option value="">— Choose the Chair —</option>
                  {faculty.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </NativeSelect>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Panel members (choose at least two)</p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {faculty.filter((u) => u.id !== f.chair_id).map((u) => {
                    const on = f.member_ids.includes(u.id);
                    return (
                      <li key={u.id}>
                        <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", on && "border-primary bg-primary/10")}>
                          <Checkbox checked={on} onCheckedChange={(v) => setF({ ...f, member_ids: v ? [...f.member_ids, u.id] : f.member_ids.filter((x) => x !== u.id) })} />
                          {u.full_name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>3 · Required documents</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="rq-file">Manuscript (PDF, up to {MAX_MANUSCRIPT_MB} MB) <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input id="rq-file" type="file" accept="application/pdf,.pdf" className="max-w-sm cursor-pointer"
                    disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} />
                  {uploading && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Uploading…</span>}
                  {!uploading && f.manuscript_path && (
                    <span className="flex items-center gap-1 text-xs text-success"><FileText className="size-3.5" /> {fileName || "Manuscript"} uploaded</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rq-abs">Abstract <span className="text-destructive">*</span></Label>
                <Textarea id="rq-abs" rows={6} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })}
                  placeholder="Summary of the study: problem, objectives, method and expected results." />
                <p className={cn("text-[11px]", f.abstract.trim().length >= MIN_ABSTRACT ? "text-muted-foreground" : "text-warning")}>
                  {f.abstract.trim().length} characters{f.abstract.trim().length < MIN_ABSTRACT ? ` · at least ${MIN_ABSTRACT} needed` : ""}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rq-note">Note to the Coordinator (optional)</Label>
                <Input id="rq-note" value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before you can submit</p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {checklist.map((c) => (
                  <li key={c.label} className={cn("flex items-center gap-2", c.ok ? "text-success" : "text-muted-foreground")}>
                    {c.ok ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />} {c.label}
                  </li>
                ))}
              </ul>
              {error && <p role="alert" className="flex gap-1.5 text-xs text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{error}</p>}
              <Button type="submit" className="w-full" disabled={!ready || busy}
                title={!ready ? "Complete every item above first" : undefined}>
                {uploading ? <Upload /> : <Send />} {busy ? "Sending…" : ready ? "Submit defense request" : "Complete the required items to submit"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
