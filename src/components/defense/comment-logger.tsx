"use client";
import * as React from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { canComment, canSeeCommentsOf, type Viewer } from "@/lib/permissions";
import { appendDictation, DictationButton } from "./dictation";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, type CommentCategory, type CommentSeverity, type PanelComment, type SessionBundle, type User,
} from "@/lib/types";
import { fmtTime } from "@/lib/utils";

export function CommentLogger({ bundle, viewer, userById, onAdd, onDelete }: {
  bundle: SessionBundle;
  viewer: Viewer;
  userById: (id: string) => User | undefined;
  onAdd: (c: Pick<PanelComment, "panel_assignment_id" | "category" | "severity" | "comment_text">) => void;
  onDelete: (id: string) => void;
}) {
  const [category, setCategory] = React.useState<CommentCategory>("documentation");
  const [severity, setSeverity] = React.useState<CommentSeverity>("mandatory");
  const [text, setText] = React.useState("");
  const editable = canComment(viewer, bundle);

  const visible = bundle.comments.filter((c) => {
    const a = bundle.assignments.find((x) => x.id === c.panel_assignment_id);
    return a && canSeeCommentsOf(viewer, a, bundle);
  });
  const authorOf = (c: PanelComment) => userById(bundle.assignments.find((a) => a.id === c.panel_assignment_id)?.faculty_id ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewer.assignment || !text.trim()) return;
    onAdd({ panel_assignment_id: viewer.assignment.id, category, severity, comment_text: text.trim() });
    setText("");
  };

  return (
    <div className="space-y-4 p-4">
      {editable ? (
        <form onSubmit={submit} className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cm-cat">Category</Label>
              <NativeSelect id="cm-cat" value={category} onChange={(e) => setCategory(e.target.value as CommentCategory)}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-muted-foreground">Severity</legend>
              <div className="flex gap-1">
                {(Object.keys(SEVERITY_LABEL) as CommentSeverity[]).map((s) => (
                  <button type="button" key={s} onClick={() => setSeverity(s)} aria-pressed={severity === s}
                    className={`h-9 flex-1 rounded-md border px-2 text-xs ${severity === s ? (s === "mandatory" ? "border-destructive bg-destructive/15 text-destructive" : "border-primary bg-primary/15 text-primary") : "hover:bg-accent"}`}>
                    {SEVERITY_LABEL[s]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <Label htmlFor="cm-text" className="sr-only">Comment</Label>
          <DictationButton onText={(spoken) => setText((t) => appendDictation(t, spoken))} />
          <Textarea id="cm-text" rows={3} placeholder="Type your comment here, or click Speak and say it…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" type="submit" disabled={!text.trim()}><MessageSquarePlus /> Log Comment</Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          {bundle.session.is_locked ? "Session locked — comments are frozen." : "Only assigned panel members can log comments."}
        </p>
      )}

      <ul className="space-y-2">
        {visible.length === 0 && <li className="text-sm text-muted-foreground">No comments yet.</li>}
        {visible.map((c) => (
          <li key={c.id} className="rounded-md border bg-background/40 p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={c.severity === "mandatory" ? "destructive" : "default"}>{SEVERITY_LABEL[c.severity]}</Badge>
              <Badge variant="muted">{CATEGORY_LABEL[c.category]}</Badge>
              <span className="text-xs text-muted-foreground">{authorOf(c)?.full_name} · {fmtTime(c.created_at)}</span>
              {editable && c.panel_assignment_id === viewer.assignment?.id && (
                <Button size="icon" variant="ghost" className="ml-auto size-7" onClick={() => onDelete(c.id)} aria-label="Delete comment"><Trash2 /></Button>
              )}
            </div>
            <p>{c.comment_text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
