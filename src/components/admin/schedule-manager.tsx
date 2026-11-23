"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarPlus, Download, ExternalLink, Lock, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteScheduledSession, gradesCsv, scheduleSession, updateScheduledSession, type ScheduleDraft,
} from "@/lib/admin";
import { useStore } from "@/lib/store";
import { STAGE_LABEL, VERDICT_LABEL, type SessionBundle } from "@/lib/types";
import { TIME_ZONE } from "@/lib/utils";
import { ScheduleForm } from "./schedule-form";

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: TIME_ZONE });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });

export function ScheduleManager() {
  const { state, users, patchState } = useStore();
  const [mode, setMode] = React.useState<{ kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string }>({ kind: "closed" });
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLDivElement>(null);

  const sessions = state.order.map((id) => state.bundles[id]).filter(Boolean);
  const byDay = new Map<string, SessionBundle[]>();
  sessions.forEach((b) => byDay.set(dayKey(b.session.scheduled_at), [...(byDay.get(dayKey(b.session.scheduled_at)) ?? []), b]));
  const locked = sessions.filter((b) => b.session.is_locked);
  const name = (id: string | null | undefined) => users.find((u) => u.id === id)?.full_name ?? "—";
  const surname = (id: string) => name(id).split(" ").slice(-1)[0];

  const open = (m: typeof mode) => {
    setMode(m);
    setNotice(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  /** Applies a state transform; returns an error message for the form or null on success. */
  const run = (fn: () => string): string | null => {
    try {
      setNotice(fn());
      setMode({ kind: "closed" });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const submit = (d: ScheduleDraft) => run(() => {
    if (d.sessionId) {
      const next = updateScheduledSession(state, d, users);
      patchState(() => next);
      return "Session updated.";
    }
    const { state: next } = scheduleSession(state, d, users);
    patchState(() => next);
    return "Defense scheduled. The panel can now open it from their dashboard.";
  });

  const exportCsv = () => {
    const blob = new Blob(["﻿" + gradesCsv(locked, users)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `consolidated-grades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const editing = mode.kind === "edit" ? state.bundles[mode.id] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sessions.length} defenses · {sessions.filter((b) => !b.session.is_locked).length} open · {locked.length} locked
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={locked.length === 0}
            title={locked.length ? "Download grades for all locked defenses" : "No locked defenses yet"}>
            <Download /> Export grades (CSV)
          </Button>
          <Button size="sm" onClick={() => open({ kind: "new" })}><CalendarPlus /> Schedule defense</Button>
        </div>
      </div>

      {notice && <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}

      {[...byDay].map(([day, list]) => (
        <Card key={day}>
          <CardHeader><CardTitle className="normal-case tracking-normal">{day}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-2 py-2 text-left font-medium">Project</th>
                  <th className="px-2 py-2 text-left font-medium">Venue</th>
                  <th className="px-2 py-2 text-left font-medium">Panel</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => {
                  const chair = b.assignments.find((a) => a.panel_role === "chair");
                  const submitted = b.assignments.filter((a) => a.has_submitted).length;
                  const hasScores = b.scores.length > 0;
                  return (
                    <tr key={b.session.id} className="border-b align-top last:border-0">
                      <td className="px-4 py-2.5 tabular-nums">{timeOf(b.session.scheduled_at)}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">{STAGE_LABEL[b.session.stage]}</Badge>
                          <span className="font-medium">{b.project.group_label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{b.project.title}</p>
                      </td>
                      <td className="max-w-40 break-words px-2 py-2.5 text-xs">{b.session.room_or_link}</td>
                      <td className="px-2 py-2.5 text-xs">
                        <p><span className="text-muted-foreground">Chair:</span> {chair ? name(chair.faculty_id) : "—"}</p>
                        <p><span className="text-muted-foreground">Members:</span> {b.assignments.filter((a) => a.panel_role === "member").map((a) => surname(a.faculty_id)).join(", ") || "—"}</p>
                        <p><span className="text-muted-foreground">Secretary:</span> {name(b.session.secretary_id)}</p>
                      </td>
                      <td className="px-2 py-2.5">
                        {b.session.is_locked ? (
                          <Badge variant="success"><Lock className="size-3" /> {VERDICT_LABEL[b.session.verdict!]}</Badge>
                        ) : hasScores ? (
                          <Badge variant="warning">In progress · {submitted}/{b.assignments.length}</Badge>
                        ) : (
                          <Badge variant="muted">Scheduled</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button asChild size="icon" variant="ghost" className="size-8" aria-label={`Open ${b.project.group_label} workspace`}>
                            <Link href={`/defense/${b.session.id}`}><ExternalLink /></Link>
                          </Button>
                          <Button size="icon" variant="ghost" className="size-8" disabled={b.session.is_locked}
                            aria-label={`Edit ${b.project.group_label}`} onClick={() => open({ kind: "edit", id: b.session.id })}><Pencil /></Button>
                          {confirmDelete === b.session.id ? (
                            <span className="flex items-center gap-1">
                              <Button size="sm" variant="destructive" onClick={() => {
                                setConfirmDelete(null);
                                run(() => { const next = deleteScheduledSession(state, b.session.id); patchState(() => next); return "Session removed from the schedule."; });
                              }}>Delete</Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                            </span>
                          ) : (
                            <Button size="icon" variant="ghost" className="size-8" disabled={hasScores}
                              title={hasScores ? "Sessions with recorded scores cannot be deleted" : "Delete"}
                              aria-label={`Delete ${b.project.group_label}`} onClick={() => setConfirmDelete(b.session.id)}><Trash2 /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
      {sessions.length === 0 && <p className="text-sm text-muted-foreground">No defenses scheduled.</p>}

      <div ref={formRef} className="scroll-mt-4">
        {mode.kind !== "closed" && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? `Edit — ${editing.project.group_label}: ${editing.project.title}` : "Schedule a Defense"}</CardTitle>
            </CardHeader>
            <CardContent>
              {editing && editing.scores.length > 0 && (
                <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Scoring has started. You can reschedule or add panelists, but the stage and the seats of panelists who already scored are locked.
                </p>
              )}
              <ScheduleForm key={mode.kind === "edit" ? mode.id : "new"} state={state} users={users} editing={editing}
                onSubmit={submit} onCancel={() => setMode({ kind: "closed" })} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
