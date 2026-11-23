"use client";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ListChecks, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoleSwitcher } from "@/components/defense/role-switcher";
import { useStore } from "@/lib/store";
import { RubricEditor } from "./rubric-editor";
import { ScheduleManager } from "./schedule-manager";

export function AdminConsole() {
  const { currentUser, state } = useStore();

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="ghost" aria-label="Back to dashboard"><Link href="/"><ArrowLeft /></Link></Button>
          <div>
            <h1 className="text-base font-bold uppercase tracking-wider sm:text-lg">Coordinator Console</h1>
            <p className="text-xs text-muted-foreground">Defense scheduling · Panel assignment · Rubric configuration</p>
          </div>
        </div>
        <RoleSwitcher />
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {!state.hydrated ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : currentUser.role !== "admin" ? (
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
          <Tabs defaultValue="schedule" className="space-y-4">
            <Card className="overflow-hidden">
              <TabsList className="border-0">
                <TabsTrigger value="schedule"><CalendarDays /> Defense Schedule</TabsTrigger>
                <TabsTrigger value="rubric"><ListChecks /> Rubric Configuration</TabsTrigger>
              </TabsList>
            </Card>
            <TabsContent value="schedule"><ScheduleManager /></TabsContent>
            <TabsContent value="rubric"><RubricEditor /></TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
