"use client";
import * as React from "react";
import { Play, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { canEditMinutes, canReadMinutes, type Viewer } from "@/lib/permissions";
import type { DefenseMinutes, QAEntry, SessionBundle, User } from "@/lib/types";
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
            {!m.started_at && <Button size="sm" variant="outline" onClick={() => onUpdate((mm) => ({ ...mm, started_at: new Date().toISOString() }))}><Play /> Start</Button>}
            {m.started_at && !m.ended_at && <Button size="sm" variant="outline" onClick={() => onUpdate((mm) => ({ ...mm, ended_at: new Date().toISOString() }))}><Square /> End</Button>}
          </div>
        )}
      </div>

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
