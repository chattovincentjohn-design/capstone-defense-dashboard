"use client";
import * as React from "react";
import { Check, ListPlus, Play, Plus, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { canEditMinutes, canReadMinutes, type Viewer } from "@/lib/permissions";
import { buildAttendance } from "@/lib/admin";
import { CATEGORY_LABEL, SEVERITY_LABEL, type DefenseMinutes, type PanelComment, type QAEntry, type SessionBundle, type User } from "@/lib/types";
import { fmtTime, uid } from "@/lib/utils";

export function MinutesRecorder({ bundle, viewer, userById, onUpdate }: {
  bundle: SessionBundle;
  viewer: Viewer;
  userById: (id: string) => User | undefined;
  onUpdate: (fn: (m: DefenseMinutes) => DefenseMinutes) => void;
}) {
  if (!canReadMinutes(viewer, bundle)) {
    return <p className="p-6 text-sm text-muted-foreground">Minutes become available to advisers and proponents after the Chair approves them.</p>;
  }
  const m = bundle.minutes;
  const editable = canEditMinutes(viewer, bundle);
  const panel = bundle.assignments.map((a) => userById(a.faculty_id)).filter(Boolean) as User[];
  const users = bundle.assignments.map((a) => userById(a.faculty_id)).filter(Boolean) as User[];
  const extraUsers = [bundle.project.adviser_id].map((id) => (id ? userById(id) : undefined)).filter(Boolean) as User[];
  const attendanceIfEmpty = (mm: DefenseMinutes) => mm.attendance_json.length ? mm.attendance_json : buildAttendance(
    bundle.assignments.map((a) => ({ id: a.faculty_id, role: a.panel_role === "chair" ? "Chair" : "Panel Member" })),
    bundle.project.adviser_id, bundle.members, [...users, ...extraUsers]);

  // Panel members' comments that the Secretary consolidates into the minutes
  const consolidated = new Set(m.qa_entries_json.map((q) => q.comment_id).filter(Boolean));
  const byPanelist = bundle.assignments.map((a) => ({
    assignment: a,
    name: userById(a.faculty_id)?.full_name ?? "Panel member",
    comments: bundle.comments.filter((c) => c.panel_assignment_id === a.id),
  })).filter((g) => g.comments.length > 0);
  const pending = byPanelist.flatMap((g) => g.comments.filter((c) => !consolidated.has(c.id)).map((c) => ({ c, facultyId: g.assignment.faculty_id })));
  const toEntry = (c: PanelComment, facultyId: string): QAEntry => ({
    id: uid("qa"), timestamp: c.created_at ?? new Date().toISOString(), panelist_id: facultyId,
    question: c.comment_text, response: "",
    action_required: `${SEVERITY_LABEL[c.severity]} · ${CATEGORY_LABEL[c.category]}`, comment_id: c.id,
  });
  const consolidate = (items: { c: PanelComment; facultyId: string }[]) =>
    onUpdate((mm) => {
      const have = new Set(mm.qa_entries_json.map((q) => q.comment_id).filter(Boolean));
      const fresh = items.filter(({ c }) => !have.has(c.id)).map(({ c, facultyId }) => toEntry(c, facultyId));
      return { ...mm, qa_entries_json: [...mm.qa_entries_json, ...fresh] };
    });

  const setQA = (id: string, patch: Partial<QAEntry>) =>
    onUpdate((mm) => ({ ...mm, qa_entries_json: mm.qa_entries_json.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Recorder: <span className="text-foreground">{userById(m.recorder_id)?.full_name}</span> · Started {fmtTime(m.started_at)} · Ended {fmtTime(m.ended_at)}
          {m.chair_approved_at && <span className="text-success"> · Approved by Chair</span>}
        </span>
        {editable && (
          <div className="flex gap-1">
            {!m.started_at && <Button size="sm" variant="outline" onClick={() => onUpdate((mm) => ({ ...mm, started_at: new Date().toISOString(), attendance_json: attendanceIfEmpty(mm) }))}><Play /> Start</Button>}
            {m.started_at && !m.ended_at && <Button size="sm" variant="outline" onClick={() => onUpdate((mm) => ({ ...mm, ended_at: new Date().toISOString() }))}><Square /> End</Button>}
          </div>
        )}
      </div>

      {(editable || viewer.isSecretary) && (
        <section className="rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Panel comments to consolidate</h4>
            {editable && pending.length > 0 && (
              <Button size="sm" onClick={() => consolidate(pending)}><ListPlus /> Add all to minutes ({pending.length})</Button>
            )}
          </div>
          {byPanelist.length === 0 ? (
            <p className="text-xs text-muted-foreground">Panel members&apos; questions and recommendations appear here as they log them in Comments.</p>
          ) : (
            <div className="space-y-3">
              {byPanelist.map((g) => (
                <div key={g.assignment.id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.name} {g.assignment.panel_role === "chair" && <span className="normal-case">(Chair)</span>}
                  </p>
                  <ul className="space-y-1.5">
                    {g.comments.map((c) => {
                      const done = consolidated.has(c.id);
                      return (
                        <li key={c.id} className="flex items-start justify-between gap-2 rounded-md border bg-background/40 p-2 text-sm">
                          <div className="min-w-0">
                            <div className="mb-0.5 flex flex-wrap gap-1">
                              <Badge variant={c.severity === "mandatory" ? "warning" : "muted"}>{SEVERITY_LABEL[c.severity]}</Badge>
                              <Badge variant="outline">{CATEGORY_LABEL[c.category]}</Badge>
                            </div>
                            <p className="whitespace-pre-wrap">{c.comment_text}</p>
                          </div>
                          {done ? (
                            <span className="flex shrink-0 items-center gap-1 text-xs text-success"><Check className="size-3.5" /> In minutes</span>
                          ) : editable ? (
                            <Button size="sm" variant="outline" className="shrink-0" onClick={() => consolidate([{ c, facultyId: g.assignment.faculty_id }])}>
                              <Plus /> Add to minutes
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-semibold">Live Q&A Log</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-secondary/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-20 px-2 py-1.5 text-left font-medium">Time</th>
                <th className="px-2 py-1.5 text-left font-medium">Panelist Question → Student Response → Action Required</th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {m.qa_entries_json.length === 0 && (
                <tr><td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">No entries yet.</td></tr>
              )}
              {m.qa_entries_json.map((q) => (
                <tr key={q.id} className="border-t align-top">
                  <td className="px-2 py-2 tabular-nums">{fmtTime(q.timestamp)}</td>
                  <td className="space-y-1.5 px-2 py-2">
                    {editable ? (
                      <>
                        <div className="flex gap-2">
                          <NativeSelect className="h-8 w-44 text-xs" value={q.panelist_id} onChange={(e) => setQA(q.id, { panelist_id: e.target.value })} aria-label="Panelist">
                            {panel.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                          </NativeSelect>
                          <Textarea rows={1} className="min-h-8 text-xs" placeholder="Question" value={q.question} onChange={(e) => setQA(q.id, { question: e.target.value })} aria-label="Question" />
                        </div>
                        <Textarea rows={2} className="text-xs" placeholder="Student Reply" value={q.response} onChange={(e) => setQA(q.id, { response: e.target.value })} aria-label="Student response" />
                        <Textarea rows={1} className="min-h-8 text-xs" placeholder="Action required (optional)" value={q.action_required} onChange={(e) => setQA(q.id, { action_required: e.target.value })} aria-label="Action required" />
                      </>
                    ) : (
                      <>
                        <p><span className="font-medium">{userById(q.panelist_id)?.full_name}:</span> {q.question}</p>
                        <p className="text-muted-foreground">↳ {q.response || <em>No response recorded</em>}</p>
                        {q.action_required && <p className="text-warning">Action: {q.action_required}</p>}
                      </>
                    )}
                  </td>
                  {editable && (
                    <td className="px-1 py-2">
                      <Button size="icon" variant="ghost" className="size-7" aria-label="Delete entry"
                        onClick={() => onUpdate((mm) => ({ ...mm, qa_entries_json: mm.qa_entries_json.filter((x) => x.id !== q.id) }))}><Trash2 /></Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onUpdate((mm) => ({
            ...mm,
            qa_entries_json: [...mm.qa_entries_json, { id: uid("qa"), timestamp: new Date().toISOString(), panelist_id: panel[0]?.id ?? "", question: "", response: "", action_required: "" }],
          }))}><Plus /> Add Q&A Row</Button>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Attendance</h4>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {m.attendance_json.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={a.present} disabled={!editable}
                  onCheckedChange={(v) => onUpdate((mm) => ({ ...mm, attendance_json: mm.attendance_json.map((x) => (x.id === a.id ? { ...x, present: v === true } : x)) }))} />
                <span className={a.present ? "" : "text-muted-foreground line-through"}>{a.name}</span>
                <span className="text-xs text-muted-foreground">({a.role})</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <Label htmlFor="delib">Deliberation & General Notes</Label>
        <Textarea id="delib" rows={4} disabled={!editable} value={m.deliberation_notes}
          placeholder={editable ? "Record deliberation points, consensus, and conditions…" : ""}
          onChange={(e) => onUpdate((mm) => ({ ...mm, deliberation_notes: e.target.value }))} />
      </section>
    </div>
  );
}
