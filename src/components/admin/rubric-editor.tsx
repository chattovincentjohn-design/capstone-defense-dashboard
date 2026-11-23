"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, CheckCircle2, GitBranch, Plus, RotateCcw, Save, Scale, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  activeRubric, isRubricSyncable, rubricProblems, saveStageRubric, weightTotals, type RubricSaveReport,
} from "@/lib/admin";
import { DEFAULT_GRADING_CONFIG } from "@/lib/grading";
import { useStore } from "@/lib/store";
import { STAGE_LABEL, type DefenseStage, type RubricCriterion, type RubricScope } from "@/lib/types";
import { cn, round } from "@/lib/utils";

const STAGES = Object.keys(STAGE_LABEL) as DefenseStage[];

export function RubricEditor() {
  const { state } = useStore();
  const [stage, setStage] = React.useState<DefenseStage>("final");
  const [dirty, setDirty] = React.useState(false);

  const switchStage = (s: DefenseStage) => {
    if (s === stage) return;
    if (dirty && !window.confirm("Discard unsaved rubric changes?")) return;
    setStage(s);
    setDirty(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Defense stage">
        {STAGES.map((s) => {
          const problems = rubricProblems(activeRubric(state.rubric, s));
          return (
            <button key={s} role="tab" aria-selected={s === stage} onClick={() => switchStage(s)}
              className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                s === stage ? "border-primary bg-primary/15 text-primary" : "hover:bg-accent")}>
              {STAGE_LABEL[s]}
              {problems.length ? <XCircle className="size-3.5 text-destructive" aria-label="Has problems" /> : <CheckCircle2 className="size-3.5 text-success" aria-label="Valid" />}
            </button>
          );
        })}
      </div>
      <StageEditor key={stage} stage={stage} onDirty={setDirty} />
    </div>
  );
}

function StageEditor({ stage, onDirty }: { stage: DefenseStage; onDirty: (d: boolean) => void }) {
  const { state, patchState } = useStore();
  const saved = React.useMemo(() => activeRubric(state.rubric, stage), [state.rubric, stage]);
  const [drafts, setDrafts] = React.useState<RubricCriterion[]>(saved);
  const [report, setReport] = React.useState<RubricSaveReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const bundles = Object.values(state.bundles).filter((b) => b.session.stage === stage);
  // Only scored/locked sessions pin a criterion; unscored ones are re-synced on save.
  const usage = (id: string) => bundles.filter((b) => !isRubricSyncable(b) && b.criteria.some((c) => c.id === id)).length;
  const syncable = bundles.filter(isRubricSyncable);
  const frozen = bundles.filter((b) => !isRubricSyncable(b));
  const problems = rubricProblems(drafts);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const update = (id: string, patch: Partial<RubricCriterion>) => {
    setReport(null);
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };
  const scoped = (scope: RubricScope) => drafts.filter((d) => d.scope === scope).sort((a, b) => a.sort_order - b.sort_order);

  const move = (scope: RubricScope, id: string, dir: -1 | 1) => {
    const list = scoped(scope);
    const i = list.findIndex((d) => d.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const order = new Map(list.map((d, k) => [d.id, k + 1]));
    setDrafts((ds) => ds.map((d) => (order.has(d.id) ? { ...d, sort_order: order.get(d.id)! } : d)));
  };
  const add = (scope: RubricScope) => {
    const n = scoped(scope).length;
    setDrafts((ds) => [...ds, {
      id: `new-${Math.random().toString(36).slice(2, 8)}`, stage, scope, criterion_name: "", description: "",
      weight_percentage: 0, max_score: 5, sort_order: n + 1, is_active: true,
    }]);
  };
  const remove = (id: string) => setDrafts((ds) => ds.filter((d) => d.id !== id));
  const distribute = (scope: RubricScope) => {
    const list = scoped(scope);
    if (!list.length) return;
    const base = Math.floor((100 / list.length) * 100) / 100;
    const ids = list.map((d) => d.id);
    setDrafts((ds) => ds.map((d) => {
      const k = ids.indexOf(d.id);
      if (k < 0) return d;
      return { ...d, weight_percentage: k === ids.length - 1 ? round(100 - base * (ids.length - 1), 2) : base };
    }));
  };

  const save = () => {
    try {
      const { state: next, report: r } = saveStageRubric(state, stage, drafts);
      patchState(() => next);
      setDrafts(activeRubric(next.rubric, stage)); // versioned/new criteria get new ids
      setReport(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Final grade = Group criteria × {DEFAULT_GRADING_CONFIG.groupWeight}% + Individual criteria × {DEFAULT_GRADING_CONFIG.individualWeight}%.
        Weights within each section must total 100%.
      </p>

      {(["group", "individual"] as RubricScope[]).map((scope) => {
        const list = scoped(scope);
        const t = weightTotals(drafts)[scope];
        const ok = scope === "individual" && t.count === 0 ? true : t.total === 100;
        return (
          <Card key={scope}>
            <CardHeader>
              <CardTitle>{scope === "group" ? "Group Criteria" : "Individual Criteria (per proponent)"}</CardTitle>
              <Badge variant={ok ? "success" : "destructive"} aria-live="polite">Total {t.total}%{ok ? "" : " — must be 100%"}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.length === 0 && <p className="text-sm text-muted-foreground">No {scope} criteria. {scope === "individual" && "Students will receive the group score only."}</p>}
              {list.map((c, i) => {
                const used = c.id.startsWith("new-") ? 0 : usage(c.id);
                const original = saved.find((s) => s.id === c.id);
                const willVersion = used > 0 && original && (original.criterion_name !== c.criterion_name || original.weight_percentage !== c.weight_percentage || original.max_score !== c.max_score);
                return (
                  <div key={c.id} className="grid gap-2 rounded-md border bg-background/40 p-2.5 sm:grid-cols-[auto_1fr_6rem_5.5rem_auto] sm:items-start">
                    <div className="flex gap-0.5 sm:flex-col">
                      <Button size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => move(scope, c.id, -1)} aria-label="Move up"><ArrowUp /></Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={i === list.length - 1} onClick={() => move(scope, c.id, 1)} aria-label="Move down"><ArrowDown /></Button>
                    </div>
                    <div className="space-y-1.5">
                      <Input aria-label="Criterion name" placeholder="Criterion name" value={c.criterion_name}
                        onChange={(e) => update(c.id, { criterion_name: e.target.value })} />
                      <Input aria-label="Description" placeholder="Description shown to panelists" className="h-8 text-xs" value={c.description ?? ""}
                        onChange={(e) => update(c.id, { description: e.target.value })} />
                      <div className="flex flex-wrap gap-1.5">
                        {c.id.startsWith("new-") && <Badge variant="default">New</Badge>}
                        {used > 0 && <Badge variant="muted">Graded in {used} session{used > 1 ? "s" : ""}</Badge>}
                        {willVersion && <Badge variant="warning"><GitBranch className="size-3" /> Saves as new version</Badge>}
                      </div>
                    </div>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Weight %</span>
                      <Input type="number" inputMode="decimal" min={0} max={100} step={0.5} className="text-right tabular-nums"
                        value={Number.isNaN(c.weight_percentage) ? "" : c.weight_percentage}
                        onChange={(e) => update(c.id, { weight_percentage: e.target.valueAsNumber })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Max score</span>
                      <Input type="number" inputMode="decimal" min={1} step={1} className="text-right tabular-nums"
                        value={Number.isNaN(c.max_score) ? "" : c.max_score}
                        onChange={(e) => update(c.id, { max_score: e.target.valueAsNumber })} />
                    </label>
                    <Button size="icon" variant="ghost" className="size-8 self-center" onClick={() => remove(c.id)}
                      aria-label={`Remove ${c.criterion_name || "criterion"}`} title={used ? "Retires it; sessions already using it keep it" : "Remove"}><Trash2 /></Button>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => add(scope)}><Plus /> Add criterion</Button>
                <Button size="sm" variant="ghost" onClick={() => distribute(scope)} disabled={list.length === 0}><Scale /> Distribute evenly</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card className="sticky bottom-3 border-primary/40 bg-card shadow-lg">
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Saving applies to <span className="text-foreground">{syncable.length}</span> unscored {STAGE_LABEL[stage].toLowerCase()} session{syncable.length === 1 ? "" : "s"}
            {syncable.length > 0 && ` (${syncable.map((b) => b.project.group_label).join(", ")})`}.{" "}
            {frozen.length > 0 && <>{frozen.length} in-progress or locked session{frozen.length === 1 ? " keeps its" : "s keep their"} original rubric ({frozen.map((b) => b.project.group_label).join(", ")}).</>}
          </p>
          {problems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p} className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{p}</li>)}</ul>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {report && !dirty && (
            <p role="status" className="text-xs text-success">
              Saved: {report.updated} updated, {report.versioned} versioned, {report.added} added, {report.retired} retired.
              {" "}Applied to {report.synced.length} session{report.synced.length === 1 ? "" : "s"}; {report.frozen.length} kept their snapshot.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => { setDrafts(saved); setError(null); }}><RotateCcw /> Discard</Button>
            <Button size="sm" disabled={!dirty || problems.length > 0} onClick={save}><Save /> Save {STAGE_LABEL[stage]} rubric</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
