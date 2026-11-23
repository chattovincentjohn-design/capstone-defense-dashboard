"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, CalendarDays, GraduationCap, ListChecks, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoleSwitcher } from "@/components/defense/role-switcher";
import { isAnyAdmin } from "@/lib/admin";
import { useStore } from "@/lib/store";
import { AccountsManager } from "./accounts-manager";
import { CoursesManager } from "./courses-manager";
import { GroupsManager } from "./groups-manager";
import { RubricEditor } from "./rubric-editor";
import { ScheduleManager } from "./schedule-manager";

export type ConsoleTab = "schedule" | "groups" | "rubric" | "accounts" | "courses";
const TAB_PATH: Record<ConsoleTab, string> = {
  schedule: "/admin", groups: "/admin/groups", rubric: "/admin/rubric", accounts: "/admin/accounts", courses: "/admin/courses",
};
const PICK_KEY = "cdms-admin-course";

export function AdminConsole({ initialTab = "schedule" }: { initialTab?: ConsoleTab }) {
  const { currentUser, state } = useStore();
  const isSuper = currentUser.role === "superadmin";
  const programs = state.programs;

  // Coordinators are fixed to their course; super admins pick one (remembered on this device).
  const [picked, setPicked] = React.useState<string | null>(null);
  React.useEffect(() => {
    try { setPicked(localStorage.getItem(PICK_KEY)); } catch { /* storage unavailable */ }
  }, []);
  const programId = isSuper
    ? (programs.some((p) => p.id === picked) ? picked! : programs[0]?.id ?? "")
    : currentUser.program_id ?? "";
  const program = programs.find((p) => p.id === programId);
  const choose = (id: string) => {
    setPicked(id);
    try { localStorage.setItem(PICK_KEY, id); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="ghost" aria-label="Back to dashboard"><Link href="/"><ArrowLeft /></Link></Button>
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider sm:text-lg">{isSuper ? "Super Admin Console" : "Coordinator Console"}</h1>
            <p className="text-xs text-muted-foreground">Defense scheduling · Groups · Rubric configuration · Accounts</p>
          </div>
        </div>
        <RoleSwitcher />
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {!state.hydrated ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !isAnyAdmin(currentUser) ? (
          <Card className="mx-auto mt-10 max-w-md">
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <ShieldAlert className="size-8 text-warning" />
              <p className="font-semibold">Coordinators and super admins only</p>
              <p className="text-sm text-muted-foreground">
                {currentUser.full_name} cannot manage schedules or rubrics.
              </p>
            </CardContent>
          </Card>
        ) : !program && !isSuper ? (
          <Card className="mx-auto mt-10 max-w-md">
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <ShieldAlert className="size-8 text-warning" />
              <p className="font-semibold">No course assigned</p>
              <p className="text-sm text-muted-foreground">Ask the super admin to assign you to a course.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <BookOpen className="size-4 text-primary" aria-hidden />
              <span className="text-muted-foreground">Course:</span>
              {isSuper ? (
                <NativeSelect className="h-9 w-80" aria-label="Course" value={programId} onChange={(e) => choose(e.target.value)}>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </NativeSelect>
              ) : (
                <Badge variant="outline" className="text-xs normal-case">{program?.code} — {program?.name}</Badge>
              )}
              {program && <span className="text-xs text-muted-foreground">({program.project_term} defenses)</span>}
            </div>

            <Tabs key={programId} defaultValue={initialTab === "courses" && !isSuper ? "schedule" : initialTab} className="space-y-4"
              onValueChange={(v) => window.history.replaceState(null, "", TAB_PATH[v as ConsoleTab])}>
              <Card className="overflow-hidden">
                <TabsList className="border-0">
                  <TabsTrigger value="schedule"><CalendarDays /> Defense Schedule</TabsTrigger>
                  <TabsTrigger value="groups"><GraduationCap /> Groups</TabsTrigger>
                  <TabsTrigger value="rubric"><ListChecks /> Rubric</TabsTrigger>
                  <TabsTrigger value="accounts"><Users /> Accounts</TabsTrigger>
                  {isSuper && <TabsTrigger value="courses"><BookOpen /> Courses</TabsTrigger>}
                </TabsList>
              </Card>
              <TabsContent value="schedule"><ScheduleManager programId={programId} /></TabsContent>
              <TabsContent value="groups"><GroupsManager programId={programId} /></TabsContent>
              <TabsContent value="rubric"><RubricEditor programId={programId} /></TabsContent>
              <TabsContent value="accounts"><AccountsManager programId={programId} /></TabsContent>
              {isSuper && <TabsContent value="courses"><CoursesManager onPick={choose} /></TabsContent>}
            </Tabs>
          </div>
        )}
      </main>
    </div>
  );
}
