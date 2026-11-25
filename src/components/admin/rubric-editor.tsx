"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, CheckCircle2, GitBranch, PieChart, Plus, RotateCcw, Save, Scale, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  activeRubric, blendFor, blendProblems, isRubricSyncable, rubricProblems, sessionUsesBlend, weightTotals,
  type RubricSaveReport,
} from "@/lib/admin";
import { useStore } from "@/lib/store";
import { STAGE_LABEL, type DefenseStage, type RubricCriterion, type RubricScope, type StageBlend } from "@/lib/types";
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
          const problems = [...blendProblems(blendFor(state, s)), ...rubricProblems(activeRubric(state.rubric, s))];
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
  const { state, ops } = useStore();
  const [saving, setSaving] = React.useState(false);
  const resync = React.useRef(false);
  const saved = React.useMemo(() => activeRubric(state.rubric, stage), [state.rubric, stage]);
  const [drafts, setDrafts] = React.useState<RubricCriterion[]>(saved);
  const [report, setReport] = React.useState<RubricSaveReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const bundles = Object.values(state.bundles).filter((b) => b.session.stage === stage);
  // Only scored/locked sessions pin a criterion; unscored ones are re-synced on save.
  const usage = (id: string) => bundles.filter((b) => !isRubricSyncable(b) && b.criteria.some((c) => c.id === id)).length;
  const syncable = bundles.filter(isRubricSyncable);
  const frozen = bundles.filter((b) => !isRubricSyncable(b));
  const savedBlend = blendFor(state, stage);
  const [blend, setBlend] = React.useState<StageBlend>(savedBlend);
  const blendDirty = blend.groupWeight !== savedBlend.groupWeight || blend.individualWeight !== savedBlend.individualWeight;
  const problems = [...blendProblems(blend), ...rubricProblems(drafts)];
  const dirty = blendDirty || JSON.stringify(drafts) !== JSON.stringify(saved);
  const hasIndividual = drafts.some((d) => d.scope === "individual");
  // Frozen sessions whose blend will differ from the new template once saved
  const keepOldBlend = frozen.filter((b) => !sessionUsesBlend(blend, b.session));
  const setGroupShare = (g: number) => {
    setReport(null);
    setBlend({ groupWeight: g, individualWeight: Number.isFinite(g) ? round(100 - g, 2) : NaN });
  };
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

  // After a save, reload drafts from the store: versioned/new criteria get new ids.
  React.useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setDrafts(saved);
    setBlend(savedBlend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, savedBlend.groupWeight, savedBlend.individualWeight]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await ops.saveRubric(stage, drafts, blend);
      resync.current = true;
      setReport(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PieChart className="size-4" /> Final Grade Blend</CardTitle>
          <Badge variant={blendProblems(blend).length ? "destructive" : "success"}>
            {Number.isFinite(blend.groupWeight) ? blend.groupWeight : "–"} / {Number.isFinite(blend.individualWeight) ? blend.individualWeight : "–"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Each proponent&apos;s final % = <span className="font-semibold text-primary">Group score × {Number.isFinite(blend.groupWeight) ? blend.groupWeight : "–"}%</span>
            {" "}+ <span className="font-semibold text-primary">Individual score × {Number.isFinite(blend.individualWeight) ? blend.individualWeight : "–"}%</span>
          </p>
          <div className="grid items-end gap-3 sm:grid-cols-[7rem_1fr_7rem]">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Group share %</span>
              <Input type="number" inputMode="decimal" min={0} max={100} step={5} className="text-right tabular-nums" aria-label="Group share percent"
                value={Number.isFinite(blend.groupWeight) ? blend.groupWeight : ""} onChange={(e) => setGroupShare(e.target.valueAsNumber)} />
            </label>
            <div className="space-y-1.5 pb-2">
              <Slider min={0} max={100} step={5} value={[Number.isFinite(blend.groupWeight) ? blend.groupWeight : 0]}
                onValueChange={([v]) => setGroupShare(v)} aria-label="Group versus individual share" />
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>All individual</span><span>All group</span></div>
            </div>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Individual share %</span>
              <Input type="number" inputMode="decimal" min={0} max={100} step={5} className="text-right tabular-nums" aria-label="Individual share percent"
                value={Number.isFinite(blend.individualWeight) ? blend.individualWeight : ""}
                onChange={(e) => setGroupShare(Number.isFinite(e.target.valueAsNumber) ? round(100 - e.target.valueAsNumber, 2) : NaN)} />
            </label>
          </div>
          {!hasIndividual && (
            <p className="text-xs text-warning">This stage has no individual criteria, so proponents receive the group score and the blend has no effect.</p>
          )}
          {hasIndividual && blend.individualWeight === 0 && (
            <p className="text-xs text-warning">Individual criteria are scored but count for 0% of the final grade.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">Criterion weights within each section must total 100%.</p>

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
              {scope === "group" && (
                <p className="text-xs text-muted-foreground">
                  Criteria with a maximum of <b>5</b> use the JHCSC rating scale: 5 = 96–100 (counted 98), 4 = 91–95 (93), 3 = 87–90 (88.5),
                  2 = 84–86 (85), 1 = below 84 (80). Any other maximum is plain points, e.g. 8 out of 10 = 80%.
                </p>
              )}
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
                    <label className="space-y-1" title="Max score 5 = the 1–5 rating sheet scale (5 = 96–100 … 1 = below 84). Any other maximum is plain points (e.g. 8/10 = 80%).">
                      <span className="text-[11px] text-muted-foreground">{c.max_score === 5 ? "Rating 1–5" : "Max points"}</span>
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
            {blendDirty && keepOldBlend.length > 0 && (
              <> {keepOldBlend.map((b) => `${b.project.group_label} stays at ${b.session.group_weight ?? 60}/${b.session.individual_weight ?? 40}`).join("; ")}.</>
            )}
          </p>
          {problems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p} className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{p}</li>)}</ul>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {report && !dirty && (
            <p role="status" className="text-xs text-success">
              Saved: {report.updated} updated, {report.versioned} versioned, {report.added} added, {report.retired} retired.
              {report.blendChanged && ` Blend set to ${savedBlend.groupWeight}/${savedBlend.individualWeight}.`}
              {" "}Applied to {report.synced.length} session{report.synced.length === 1 ? "" : "s"}; {report.frozen.length} kept their snapshot.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => { setDrafts(saved); setBlend(savedBlend); setError(null); }}><RotateCcw /> Discard</Button>
            <Button size="sm" disabled={saving || !dirty || problems.length > 0} onClick={() => void save()}><Save /> Save {STAGE_LABEL[stage]} rubric</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
