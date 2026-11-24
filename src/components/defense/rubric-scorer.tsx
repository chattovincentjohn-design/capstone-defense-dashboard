"use client";
import * as React from "react";
import { CheckCircle2, EyeOff, PenLine, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configFor, evaluatePanelist, scoreLookup, splitCriteria, suggestVerdict, transmute, type WeightedResult } from "@/lib/grading";
import { canScore, isStarted, type Viewer } from "@/lib/permissions";
import { shortHash } from "@/lib/signature";
import type { RubricCriterion, SessionBundle } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/types";
import { cn, fmtDateTime, round } from "@/lib/utils";

interface Props {
  bundle: SessionBundle;
  viewer: Viewer;
  onScore: (assignmentId: string, criterionId: string, studentId: string | null, score: number) => void;
  onSubmit: (assignmentId: string) => Promise<void>;
}

export function RubricScorer({ bundle, viewer, onScore, onSubmit }: Props) {
  const assignment = viewer.assignment;
  if (!assignment) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <EyeOff className="size-6" />
        <p>Rubric scoring is restricted to assigned panel members.</p>
        <p className="text-xs">Individual panel scores remain hidden until the Chair locks the defense.</p>
      </div>
    );
  }

  return <Scorer bundle={bundle} viewer={viewer} onScore={onScore} onSubmit={onSubmit} />;
}

function Scorer({ bundle, viewer, onScore, onSubmit }: Props) {
  const assignment = viewer.assignment!;
  const editable = canScore(viewer, bundle);
  const { group, individual } = splitCriteria(bundle.criteria);
  const evaluation = evaluatePanelist(bundle, assignment);
  const cfg = configFor(bundle);
  const [student, setStudent] = React.useState(bundle.members[0]?.id ?? "");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const groupLookup = scoreLookup(bundle.scores, assignment.id, null);
  const studentLookup = scoreLookup(bundle.scores, assignment.id, student);
  // Provisional rating only from proponents you've fully scored (avoids treating blanks as zeros).
  const doneIds = bundle.members.filter((m) => evaluation.group.complete && evaluation.individuals[m.id]?.complete).map((m) => m.id);
  const avgFinal = doneIds.length ? round(doneIds.reduce((a, id) => a + evaluation.finals[id], 0) / doneIds.length, 2) : null;

  return (
    <div className="flex flex-col">
      {!isStarted(bundle) && (
        <p className="border-b bg-warning/10 px-4 py-2 text-xs text-warning">
          Rating is locked until the Defense Chair or the Coordinator starts the defense.
        </p>
      )}
      <Tabs defaultValue="group">
        <TabsList>
          <TabsTrigger value="group">Group Grading ({cfg.groupWeight}%)</TabsTrigger>
          <TabsTrigger value="individual" disabled={individual.length === 0}>Individual Grading ({cfg.individualWeight}%)</TabsTrigger>
        </TabsList>

        <TabsContent value="group" className="space-y-1 p-4">
          {group.map((c, i) => (
            <CriterionRow key={c.id} index={i + 1} criterion={c} value={groupLookup(c)} disabled={!editable}
              onChange={(v) => onScore(assignment.id, c.id, null, v)} />
          ))}
          <ScoreLine label="Group weighted score" result={evaluation.group} />
        </TabsContent>

        <TabsContent value="individual" className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Proponent">
            {bundle.members.map((m) => {
              const r = evaluation.individuals[m.id];
              return (
                <button key={m.id} role="tab" aria-selected={student === m.id} onClick={() => setStudent(m.id)}
                  className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors",
                    student === m.id ? "border-primary bg-primary/15 text-primary" : "hover:bg-accent")}>
                  {m.student_name}
                  {r?.complete && <CheckCircle2 className="ml-1 inline size-3 text-success" />}
                </button>
              );
            })}
          </div>
          {individual.map((c, i) => (
            <CriterionRow key={`${student}-${c.id}`} index={i + 1} criterion={c} value={studentLookup(c)} disabled={!editable}
              onChange={(v) => onScore(assignment.id, c.id, student, v)} />
          ))}
          {evaluation.individuals[student] && <ScoreLine label="Individual weighted score" result={evaluation.individuals[student]} />}
        </TabsContent>
      </Tabs>

      {/* Live computation summary */}
      <div className="mx-4 mb-4 rounded-md border bg-background/40">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-1.5 text-left font-medium">Proponent</th>
              <th className="px-2 py-1.5 text-right font-medium">Group</th>
              <th className="px-2 py-1.5 text-right font-medium">Indiv.</th>
              <th className="px-2 py-1.5 text-right font-medium">Final %</th>
              <th className="px-3 py-1.5 text-right font-medium">Grade</th>
            </tr>
          </thead>
          <tbody>
            {bundle.members.map((m) => {
              const ind = evaluation.individuals[m.id];
              const done = doneIds.includes(m.id);
              const fin = evaluation.finals[m.id];
              const t = transmute(fin);
              return (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{m.student_name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{evaluation.group.percent.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{ind?.scored ? ind.percent.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{done ? fin.toFixed(2) : "—"}</td>
                  <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", !done ? "text-muted-foreground" : t.grade <= 3 ? "text-success" : "text-destructive")}>{done ? t.grade.toFixed(2) : "pending"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t px-3 py-2 text-sm font-semibold">
          CALCULATED WEIGHTED SCORE:{" "}
          {avgFinal === null ? (
            <span className="font-normal text-muted-foreground">available once a proponent is fully scored</span>
          ) : (
            <>
              {round((avgFinal / 100) * (bundle.criteria[0]?.max_score ?? 5), 2).toFixed(2)} / {(bundle.criteria[0]?.max_score ?? 5).toFixed(1)}{" "}
              <span className="font-normal text-success">({VERDICT_LABEL[suggestVerdict(avgFinal)]} — your provisional rating)</span>
            </>
          )}
        </p>
      </div>

      {/* Submit & sign */}
      <div className="mx-4 mb-4">
        {assignment.has_submitted ? (
          <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <div>
              <p className="font-semibold text-success">Evaluation submitted & digitally signed</p>
              <p className="text-muted-foreground">{fmtDateTime(assignment.submitted_at)}</p>
              <p className="font-mono break-all" title={assignment.signature_hash ?? ""}>SHA-256 {shortHash(assignment.signature_hash)}</p>
            </div>
          </div>
        ) : bundle.session.is_locked ? (
          <p className="text-xs text-muted-foreground">Session is locked.</p>
        ) : confirming ? (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-xs">
            <p>Submitting signs and freezes your scores. You will not be able to edit them. Continue?</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); await onSubmit(assignment.id); setBusy(false); setConfirming(false); }}>
                <PenLine /> Sign & Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {evaluation.complete ? "All criteria scored." : `Incomplete: score every criterion for all ${bundle.members.length} proponents.`}
            </span>
            <Button size="sm" disabled={!evaluation.complete} onClick={() => setConfirming(true)}>
              <PenLine /> Submit Ratings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreLine({ label, result }: { label: string; result: WeightedResult }) {
  return (
    <div className="flex items-center justify-between border-t pt-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">
        {result.rating.toFixed(2)} / {result.scaleMax.toFixed(1)} · {result.percent.toFixed(2)}%
        {!result.complete && <Badge variant="warning" className="ml-2">{result.scored}/{result.total}</Badge>}
      </span>
    </div>
  );
}

function CriterionRow({ index, criterion, value, disabled, onChange }: {
  index: number; criterion: RubricCriterion; value: number | undefined; disabled: boolean; onChange: (v: number) => void;
}) {
  const [draft, setDraft] = React.useState(value?.toFixed(1) ?? "");
  React.useEffect(() => setDraft(value?.toFixed(1) ?? ""), [value]);
  const id = `crit-${criterion.id}`;
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) return setDraft(value?.toFixed(1) ?? "");
    onChange(round(Math.min(criterion.max_score, Math.max(0, n)), 1));
  };

  return (
    <div className="grid grid-cols-[1fr_4rem] items-center gap-x-3 py-1.5">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium" title={criterion.description ?? ""}>
            {index}. {criterion.criterion_name} ({criterion.weight_percentage}%)
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">{value !== undefined ? value.toFixed(1) : "—"}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-muted-foreground">Rating: {value !== undefined ? value.toFixed(1) : "–"} / {criterion.max_score.toFixed(1)}</span>
          <Slider min={0} max={criterion.max_score} step={0.1} value={[value ?? 0]} disabled={disabled}
            onValueChange={([v]) => onChange(round(v, 1))} aria-label={`${criterion.criterion_name} slider`}
            className={cn(value === undefined && "opacity-50")} />
        </div>
      </div>
      <Input id={id} inputMode="decimal" className="h-9 text-center tabular-nums" value={draft} disabled={disabled} placeholder="–"
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)} />
    </div>
  );
}
