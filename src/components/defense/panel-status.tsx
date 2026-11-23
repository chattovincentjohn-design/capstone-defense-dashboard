"use client";
import { Badge } from "@/components/ui/badge";
import type { PanelAssignment, RubricScore, User } from "@/lib/types";

export function panelState(a: PanelAssignment, scores: RubricScore[]) {
  if (a.has_submitted) return { label: "Submitted", variant: "success" as const };
  if (scores.some((s) => s.panel_assignment_id === a.id)) return { label: "Grading", variant: "warning" as const };
  return { label: "Ready", variant: "default" as const };
}

/** Submission status only — never scores (blind grading). */
export function PanelStatusList({ assignments, scores, userById }: {
  assignments: PanelAssignment[]; scores: RubricScore[]; userById: (id: string) => User | undefined;
}) {
  return (
    <ul className="space-y-1.5">
      {assignments.map((a) => {
        const s = panelState(a, scores);
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
