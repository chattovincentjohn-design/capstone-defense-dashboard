"use client";
import * as React from "react";
import { AlertTriangle, CalendarPlus, Save, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  assignmentHasScores, FACULTY_ROLES, fromManilaInput, sessionHasScores, listProjects, parseMembers, toManilaInput, validateSchedule, type ScheduleDraft,
} from "@/lib/admin";
import type { State } from "@/lib/store";
import { ROLE_LABEL, STAGE_LABEL, type DefenseStage, type SessionBundle, type User } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FormState {
  projectId: string;
  title: string;
  groupLabel: string;
  adviserId: string;
  academicYear: string;
  membersText: string;
  manuscriptUrl: string;
  demoUrl: string;
  abstract: string;
  stage: DefenseStage;
  when: string; // datetime-local, Manila time
  room: string;
  secretaryId: string;
  chairId: string;
  memberIds: string[];
}

function initialForm(editing: SessionBundle | undefined, projects: ReturnType<typeof listProjects>): FormState {
  if (editing) {
    return {
      projectId: editing.project.id, title: "", groupLabel: "", adviserId: "", academicYear: editing.project.academic_year,
      membersText: "", manuscriptUrl: "", demoUrl: "", abstract: "",
      stage: editing.session.stage, when: toManilaInput(editing.session.scheduled_at), room: editing.session.room_or_link ?? "",
      secretaryId: editing.session.secretary_id ?? "",
      chairId: editing.assignments.find((a) => a.panel_role === "chair")?.faculty_id ?? "",
      memberIds: editing.assignments.filter((a) => a.panel_role === "member").map((a) => a.faculty_id),
    };
  }
  return {
    projectId: projects[0]?.project.id ?? "new", title: "", groupLabel: "", adviserId: "", academicYear: "2026-2027",
    membersText: "", manuscriptUrl: "", demoUrl: "", abstract: "",
    stage: "final", when: "", room: "", secretaryId: "", chairId: "", memberIds: [],
  };
}

export function ScheduleForm({ state, users, editing, busy = false, onSubmit, onCancel }: {
  state: State;
  users: User[];
  editing?: SessionBundle;
  busy?: boolean;
  onSubmit: (d: ScheduleDraft) => Promise<string | null>; // resolves to an error message or null
  onCancel: () => void;
}) {
  const projects = React.useMemo(() => listProjects(state), [state]);
  const [f, setF] = React.useState<FormState>(() => initialForm(editing, projects));
  const [attempted, setAttempted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const faculty = users.filter((u) => FACULTY_ROLES.includes(u.role));
  const staff = users.filter((u) => u.role === "secretary" || u.role === "admin");
  const advisers = users.filter((u) => u.role === "adviser" || u.role === "chair" || u.role === "panelist");
  const selectedProject = projects.find((p) => p.project.id === f.projectId);
  const adviserId = f.projectId === "new" ? f.adviserId || null : selectedProject?.project.adviser_id ?? null;
  // Faculty whose seat is locked because they've started scoring (works under blind grading too).
  const scored = new Set(editing?.assignments.filter((a) => assignmentHasScores(editing, a.id)).map((a) => a.faculty_id));

  const draft: ScheduleDraft = {
    sessionId: editing?.session.id,
    projectId: f.projectId,
    newProject: f.projectId === "new" ? {
      title: f.title, group_label: f.groupLabel, adviser_id: f.adviserId || null, academic_year: f.academicYear,
      manuscript_url: f.manuscriptUrl, demo_url: f.demoUrl, abstract: f.abstract, members: parseMembers(f.membersText),
    } : undefined,
    stage: f.stage,
    scheduledAt: f.when ? fromManilaInput(f.when) : "",
    room: f.room,
    secretaryId: f.secretaryId || null,
    chairId: f.chairId,
    memberIds: f.memberIds,
  };
  const issues = validateSchedule(draft, state, users);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (errors.length) return;
    void onSubmit(draft).then(setSubmitError);
  };

  const facultyOption = (u: User) => (
    <option key={u.id} value={u.id} disabled={u.id === adviserId}>
      {u.full_name}{u.id === adviserId ? " — project adviser" : ""}
    </option>
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {/* Project */}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">1 · Project</legend>
        <div className="space-y-1">
          <Label htmlFor="sf-project">Capstone project</Label>
          <NativeSelect id="sf-project" value={f.projectId} disabled={!!editing} onChange={(e) => set("projectId", e.target.value)}>
            {projects.map((p) => <option key={p.project.id} value={p.project.id}>{p.project.group_label}: {p.project.title}</option>)}
            <option value="new">+ Register a new project…</option>
          </NativeSelect>
          {selectedProject && (
            <p className="text-xs text-muted-foreground">
              Proponents: {selectedProject.members.map((m) => m.student_name).join(", ")} · Adviser: {users.find((u) => u.id === selectedProject.project.adviser_id)?.full_name ?? "—"}
            </p>
          )}
        </div>

        {f.projectId === "new" && (
          <div className="grid gap-3 rounded-md border bg-background/40 p-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-title">Project title</Label>
              <Input id="sf-title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Barangay Health Records System" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-group">Group label</Label>
              <Input id="sf-group" value={f.groupLabel} onChange={(e) => set("groupLabel", e.target.value)} placeholder="Group 9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-ay">Academic year</Label>
              <Input id="sf-ay" value={f.academicYear} onChange={(e) => set("academicYear", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-adviser">Adviser</Label>
              <NativeSelect id="sf-adviser" value={f.adviserId} onChange={(e) => set("adviserId", e.target.value)}>
                <option value="">— None —</option>
                {advisers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-members">Proponents — one per line: <span className="font-mono">Name, Student No.</span></Label>
              <Textarea id="sf-members" rows={3} value={f.membersText} onChange={(e) => set("membersText", e.target.value)}
                placeholder={"Ana Cruz, 2022-00811\nBen Ramos, 2022-00812"} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-ms">Manuscript URL (PDF)</Label>
              <Input id="sf-ms" type="url" value={f.manuscriptUrl} onChange={(e) => set("manuscriptUrl", e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sf-demo">Live demo URL</Label>
              <Input id="sf-demo" type="url" value={f.demoUrl} onChange={(e) => set("demoUrl", e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="sf-abs">Abstract</Label>
              <Textarea id="sf-abs" rows={2} value={f.abstract} onChange={(e) => set("abstract", e.target.value)} />
            </div>
          </div>
        )}
      </fieldset>

      {/* When & where */}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">2 · Schedule</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="sf-stage">Defense stage</Label>
            <NativeSelect id="sf-stage" value={f.stage} onChange={(e) => set("stage", e.target.value as DefenseStage)}
              disabled={!!editing && sessionHasScores(editing)}>
              {(Object.keys(STAGE_LABEL) as DefenseStage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-when">Date & time (PHT)</Label>
            <Input id="sf-when" type="datetime-local" value={f.when} onChange={(e) => set("when", e.target.value)} className="[color-scheme:dark]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-room">Room or meeting link</Label>
            <Input id="sf-room" value={f.room} onChange={(e) => set("room", e.target.value)} placeholder="CCS AVR 2" />
          </div>
        </div>
      </fieldset>

      {/* Panel */}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">3 · Panel & recorder</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sf-chair">Defense Chair</Label>
            <NativeSelect id="sf-chair" value={f.chairId} disabled={scored.has(f.chairId)}
              onChange={(e) => setF((x) => ({ ...x, chairId: e.target.value, memberIds: x.memberIds.filter((m) => m !== e.target.value) }))}>
              <option value="">— Select —</option>
              {faculty.map(facultyOption)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-sec">Secretary / Recorder</Label>
            <NativeSelect id="sf-sec" value={f.secretaryId} onChange={(e) => set("secretaryId", e.target.value)}>
              <option value="">— Unassigned —</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({ROLE_LABEL[u.role]})</option>)}
            </NativeSelect>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Panel members</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {faculty.filter((u) => u.id !== f.chairId).map((u) => {
              const isAdviser = u.id === adviserId;
              const locked = scored.has(u.id);
              return (
                <li key={u.id}>
                  <label className={cn("flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm", isAdviser && "opacity-50")}>
                    <Checkbox checked={f.memberIds.includes(u.id)} disabled={isAdviser || locked}
                      onCheckedChange={(v) => set("memberIds", v === true ? [...f.memberIds, u.id] : f.memberIds.filter((m) => m !== u.id))} />
                    <span className="flex-1">{u.full_name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {isAdviser ? "adviser" : locked ? "has scores" : u.department?.replace("College of ", "")}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </fieldset>

      {/* Validation */}
      {(warnings.length > 0 || (attempted && errors.length > 0) || submitError) && (
        <ul className="space-y-1 rounded-md border bg-background/40 p-3 text-xs" aria-live="polite">
          {attempted && errors.map((i) => (
            <li key={i.message} className="flex gap-1.5 text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{i.message}</li>
          ))}
          {submitError && <li className="flex gap-1.5 text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{submitError}</li>}
          {warnings.map((i) => (
            <li key={i.message} className="flex gap-1.5 text-warning"><AlertTriangle className="mt-px size-3.5 shrink-0" />{i.message}</li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}><X /> Cancel</Button>
        <Button type="submit" disabled={busy || (attempted && errors.length > 0)}>
          {editing ? <><Save /> Save changes</> : <><CalendarPlus /> Schedule defense</>}
        </Button>
      </div>
    </form>
  );
}
