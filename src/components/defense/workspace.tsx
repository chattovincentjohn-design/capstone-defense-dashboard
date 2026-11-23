"use client";
import Link from "next/link";
import { ClipboardList, FileText, Gavel, MessageSquareText, Mic, Printer, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDefenseSession, useStore } from "@/lib/store";
import { ArtifactsPane } from "./artifacts-pane";
import { CommentLogger } from "./comment-logger";
import { DeliberationMatrix } from "./deliberation-matrix";
import { MinutesRecorder } from "./minutes-recorder";
import { PanelStatusList } from "./panel-status";
import { RevisionTracker } from "./revision-tracker";
import { RubricScorer } from "./rubric-scorer";
import { WorkspaceHeader } from "./workspace-header";
import { allSubmitted } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/types";

export function DefenseWorkspace({ sessionId }: { sessionId: string }) {
  const { bundle, viewer, actions, userById, hydrated, order } = useDefenseSession(sessionId);
  const { currentUser } = useStore();

  if (!hydrated) return <div className="p-10 text-center text-sm text-muted-foreground">Loading defense session…</div>;
  if (!bundle || !viewer) return <div className="p-10 text-center">Defense session not found. <Link className="text-primary underline" href="/">Back</Link></div>;

  const leftDefault = viewer.isSecretary ? "minutes" : "artifacts";
  const rightDefault = viewer.isPanelist
    ? viewer.isChair && allSubmitted(bundle) ? "deliberation" : "rubric"
    : bundle.session.is_locked ? "deliberation" : "comments";

  return (
    <div className="min-h-screen">
      <WorkspaceHeader bundle={bundle} order={order} userById={userById} />

      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Signed in as <span className="text-foreground">{currentUser.full_name}</span> ·{" "}
        {viewer.isChair ? "Defense Chair" : viewer.isPanelist ? "Panel Member" : viewer.isSecretary ? "Defense Secretary" : viewer.isAdviser ? "Adviser (read-only)" : ROLE_LABEL[currentUser.role]}
      </p>

      <main className="grid gap-4 p-4 lg:grid-cols-2" key={currentUser.id}>
        {/* LEFT — Reference & Minutes */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <Tabs defaultValue={leftDefault}>
              <TabsList>
                <TabsTrigger value="artifacts"><FileText /> Project Artifacts</TabsTrigger>
                <TabsTrigger value="minutes"><Mic /> Defense Minutes</TabsTrigger>
              </TabsList>
              <TabsContent value="artifacts"><ArtifactsPane project={bundle.project} /></TabsContent>
              <TabsContent value="minutes">
                <MinutesRecorder bundle={bundle} viewer={viewer} userById={userById} onUpdate={actions.updateMinutes} />
              </TabsContent>
            </Tabs>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-4" /> Revision Checklist</CardTitle></CardHeader>
            <CardContent><RevisionTracker bundle={bundle} viewer={viewer} onResolve={actions.resolveRevision} /></CardContent>
          </Card>
        </div>

        {/* RIGHT — Evaluation & Feedback */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <Tabs defaultValue={rightDefault}>
              <TabsList>
                <TabsTrigger value="rubric"><Scale /> Rubric</TabsTrigger>
                <TabsTrigger value="comments"><MessageSquareText /> Comments</TabsTrigger>
                <TabsTrigger value="deliberation"><Gavel /> Deliberation</TabsTrigger>
              </TabsList>
              <TabsContent value="rubric">
                <RubricScorer bundle={bundle} viewer={viewer} onScore={actions.setScore} onSubmit={actions.submitEvaluation} />
              </TabsContent>
              <TabsContent value="comments">
                <CommentLogger bundle={bundle} viewer={viewer} userById={userById} onAdd={actions.addComment} onDelete={actions.deleteComment} />
              </TabsContent>
              <TabsContent value="deliberation">
                <DeliberationMatrix bundle={bundle} viewer={viewer} userById={userById} onFinalize={actions.finalize} />
              </TabsContent>
            </Tabs>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Panel Status</CardTitle>
              <span className="text-[11px] text-muted-foreground">Live · changes autosave</span>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <PanelStatusList bundle={bundle} userById={userById} />
              <div className="flex flex-col gap-2">
                <Button asChild size="sm" variant="outline"><Link href={`/print/${sessionId}/rating-sheet`} target="_blank"><Printer /> Rating Sheet</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`/print/${sessionId}/minutes`} target="_blank"><Printer /> Minutes of the Defense</Link></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
