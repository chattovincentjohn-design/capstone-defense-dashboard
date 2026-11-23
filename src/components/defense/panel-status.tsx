"use client";
import { Badge } from "@/components/ui/badge";
import { assignmentHasScores } from "@/lib/admin";
import type { PanelAssignment, SessionBundle, User } from "@/lib/types";

type ScoreInfo = Pick<SessionBundle, "scores" | "scored_assignment_ids">;

export function panelState(a: PanelAssignment, bundle: ScoreInfo) {
  if (a.has_submitted) return { label: "Submitted", variant: "success" as const };
  if (assignmentHasScores(bundle, a.id)) return { label: "Grading", variant: "warning" as const };
  return { label: "Ready", variant: "default" as const };
}

/** Submission status only — never scores (blind grading). */
export function PanelStatusList({ bundle, userById }: {
  bundle: Pick<SessionBundle, "assignments" | "scores" | "scored_assignment_ids">; userById: (id: string) => User | undefined;
}) {
  return (
    <ul className="space-y-1.5">
      {bundle.assignments.map((a) => {
        const s = panelState(a, bundle);
        return (
          <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              {userById(a.faculty_id)?.full_name}
              {a.panel_role === "chair" && <span className="text-muted-foreground"> (Chair)</span>}
            </span>
            <Badge variant={s.variant}>{s.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
