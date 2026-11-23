"use client";
import { BrandLogo } from "@/components/app/brand";
import Link from "next/link";
import { ArrowLeft, CalendarDays, GraduationCap, ListChecks, ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoleSwitcher } from "@/components/defense/role-switcher";
import { useStore } from "@/lib/store";
import { AccountsManager } from "./accounts-manager";
import { GroupsManager } from "./groups-manager";
import { RubricEditor } from "./rubric-editor";
import { ScheduleManager } from "./schedule-manager";

export type ConsoleTab = "schedule" | "groups" | "rubric" | "accounts";
const TAB_PATH: Record<ConsoleTab, string> = { schedule: "/admin", groups: "/admin/groups", rubric: "/admin/rubric", accounts: "/admin/accounts" };

export function AdminConsole({ initialTab = "schedule" }: { initialTab?: ConsoleTab }) {
  const { currentUser, state } = useStore();

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="ghost" aria-label="Back to dashboard"><Link href="/"><ArrowLeft /></Link></Button>
          <BrandLogo size={40} />
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider text-primary sm:text-lg">{currentUser.role === "superadmin" ? "Super Admin Console" : "Coordinator Console"}</h1>
            <p className="text-xs text-muted-foreground">Defense scheduling · Groups · Rubric configuration · Accounts</p>
          </div>
        </div>
        <RoleSwitcher />
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {!state.hydrated ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : currentUser.role !== "admin" && currentUser.role !== "superadmin" ? (
          <Card className="mx-auto mt-10 max-w-md">
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <ShieldAlert className="size-8 text-warning" />
              <p className="font-semibold">Capstone Coordinator access only</p>
              <p className="text-sm text-muted-foreground">
                {currentUser.full_name} cannot manage schedules or rubrics. Switch to the Coordinator above to continue.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue={initialTab} className="space-y-4"
            onValueChange={(v) => window.history.replaceState(null, "", TAB_PATH[v as ConsoleTab])}>
            <Card className="overflow-hidden">
              <TabsList className="border-0">
                <TabsTrigger value="schedule"><CalendarDays /> Defense Schedule</TabsTrigger>
                <TabsTrigger value="groups"><GraduationCap /> Groups</TabsTrigger>
                <TabsTrigger value="rubric"><ListChecks /> Rubric Configuration</TabsTrigger>
                <TabsTrigger value="accounts"><Users /> Faculty Accounts</TabsTrigger>
              </TabsList>
            </Card>
            <TabsContent value="schedule"><ScheduleManager /></TabsContent>
            <TabsContent value="groups"><GroupsManager /></TabsContent>
            <TabsContent value="rubric"><RubricEditor /></TabsContent>
            <TabsContent value="accounts"><AccountsManager /></TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
