"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefenseTimer } from "./defense-timer";
import { panelState } from "./panel-status";
import { RoleSwitcher } from "./role-switcher";
import { STAGE_LABEL, VERDICT_LABEL, type SessionBundle, type User } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

export function WorkspaceHeader({ bundle, order, userById }: {
  bundle: SessionBundle; order: string[]; userById: (id: string) => User | undefined;
}) {
  const { session, project, members, assignments } = bundle;
  const idx = order.indexOf(session.id);
  const prev = order[(idx - 1 + order.length) % order.length];
  const next = order[(idx + 1) % order.length];

  return (
    <header className="border-b bg-card/80 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button asChild size="icon" variant="ghost" aria-label="All sessions"><Link href="/"><Menu /></Link></Button>
        <h1 className="flex-1 text-center text-sm font-bold uppercase tracking-wider sm:text-lg">Capstone Defense Panel Dashboard</h1>
        <RoleSwitcher />
      </div>

      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Proponents: </span>{members.map((m) => m.student_name).join(", ")}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Panel:</span>
            {assignments.map((a) => {
              const st = panelState(a, bundle);
              const name = userById(a.faculty_id)?.full_name.split(" ").slice(-1)[0];
              return (
                <Badge key={a.id} variant={st.variant} title={userById(a.faculty_id)?.full_name}>
                  {a.panel_role === "chair" ? "Chair" : "Panel"} {name}: {st.label}
                </Badge>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="outline">{STAGE_LABEL[session.stage]}</Badge>
            <h2 className="text-center text-base font-semibold">{project.group_label}: {project.title}</h2>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <DefenseTimer disabled={session.is_locked} />
            <div className="rounded-md border border-primary/40 bg-secondary/50 px-3 py-1.5 text-sm">
              <span className="font-semibold">VERDICT: </span>
              {session.verdict ? (
                <span className="text-success">{VERDICT_LABEL[session.verdict]}</span>
              ) : (
                <span className="text-warning">(Draft Pending)</span>
              )}
              {session.is_locked && <Lock className="ml-1.5 inline size-3.5 text-success" aria-label="Locked" />}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <span className="hidden text-xs text-muted-foreground xl:inline">{fmtDateTime(session.scheduled_at)} · {session.room_or_link}</span>
          <Button asChild variant="outline" size="sm"><Link href={`/defense/${prev}`}><ChevronLeft /> Prev</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/defense/${next}`}>Next <ChevronRight /></Link></Button>
        </div>
      </div>
    </header>
  );
}
