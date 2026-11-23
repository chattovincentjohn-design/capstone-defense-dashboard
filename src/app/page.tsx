"use client";
import Link from "next/link";
import { CalendarClock, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleSwitcher } from "@/components/defense/role-switcher";
import { useStore } from "@/lib/store";
import { STAGE_LABEL, VERDICT_LABEL } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

export default function Home() {
  const { state, reset, currentUser } = useStore();
  const sessions = state.order.map((id) => state.bundles[id]);
  const mine = sessions.filter((b) =>
    currentUser.role === "admin" ||
    b.assignments.some((a) => a.faculty_id === currentUser.id) ||
    b.session.secretary_id === currentUser.id ||
    b.project.adviser_id === currentUser.id ||
    b.members.some((m) => m.user_id === currentUser.id));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-wider">Capstone Defense Panel Dashboard</h1>
          <p className="text-sm text-muted-foreground">Demo mode · data persists in this browser. Switch identity to test each role.</p>
        </div>
        <RoleSwitcher />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> Defense Schedule</CardTitle>
          <Button size="sm" variant="ghost" onClick={reset}><RotateCcw /> Reset demo data</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No defense sessions assigned to {currentUser.full_name}.</p>}
          {mine.map((b) => (
            <Link key={b.session.id} href={`/defense/${b.session.id}`}
              className="block rounded-md border bg-background/40 p-4 transition-colors hover:border-primary">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{STAGE_LABEL[b.session.stage]}</Badge>
                <span className="font-semibold">{b.project.group_label}: {b.project.title}</span>
                {b.session.verdict
                  ? <Badge variant="success" className="ml-auto">{VERDICT_LABEL[b.session.verdict]}</Badge>
                  : <Badge variant="warning" className="ml-auto">In progress · {b.assignments.filter((a) => a.has_submitted).length}/{b.assignments.length} submitted</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(b.session.scheduled_at)} · {b.session.room_or_link}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
