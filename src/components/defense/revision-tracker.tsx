"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { canResolveRevisions, canSeeCommentsOf, type Viewer } from "@/lib/permissions";
import { CATEGORY_LABEL, type PanelComment, type SessionBundle } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

/** Mandatory revisions → compliance checklist (populated automatically from panel comments). */
export function RevisionTracker({ bundle, viewer, onResolve }: {
  bundle: SessionBundle;
  viewer: Viewer;
  onResolve: (id: string, resolved: boolean, note: string, reference: string) => void;
}) {
  const items = bundle.comments.filter((c) => {
    const a = bundle.assignments.find((x) => x.id === c.panel_assignment_id);
    return c.severity === "mandatory" && a && canSeeCommentsOf(viewer, a, bundle);
  });
  const editable = canResolveRevisions(viewer, bundle);
  const done = items.filter((i) => i.is_resolved).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{bundle.session.is_locked ? "Post-defense compliance" : "Populates automatically from Mandatory Revision comments"}</span>
        <Badge variant={done === items.length && items.length ? "success" : "warning"}>{done}/{items.length} resolved</Badge>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">No mandatory revisions visible.</p>}
      <ul className="space-y-2">
        {items.map((c) => <RevisionItem key={c.id} c={c} editable={editable} onResolve={onResolve} />)}
      </ul>
    </div>
  );
}

function RevisionItem({ c, editable, onResolve }: { c: PanelComment; editable: boolean; onResolve: (id: string, r: boolean, n: string, ref: string) => void }) {
  const [note, setNote] = React.useState(c.resolution_note ?? "");
  const [ref, setRef] = React.useState(c.resolution_reference ?? "");
  return (
    <li className="rounded-md border bg-background/40 p-2.5 text-sm">
      <label className="flex items-start gap-2">
        <Checkbox className="mt-0.5" checked={c.is_resolved} disabled={!editable}
          onCheckedChange={(v) => onResolve(c.id, v === true, note, ref)} aria-label="Mark resolved" />
        <span className={c.is_resolved ? "text-muted-foreground line-through" : ""}>
          {c.comment_text} <span className="text-xs text-muted-foreground">({CATEGORY_LABEL[c.category]})</span>
        </span>
      </label>
      {editable && (
        <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-[1fr_10rem]">
          <Input className="h-8 text-xs" placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={() => c.is_resolved && onResolve(c.id, true, note, ref)} />
          <Input className="h-8 text-xs" placeholder="Page / commit ref" value={ref} onChange={(e) => setRef(e.target.value)}
            onBlur={() => c.is_resolved && onResolve(c.id, true, note, ref)} />
        </div>
      )}
      {!editable && c.is_resolved && (
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          {c.resolution_note} {c.resolution_reference && <>· ref {c.resolution_reference}</>} · {fmtDateTime(c.resolved_at)}
        </p>
      )}
    </li>
  );
}
