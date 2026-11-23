"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, FileSignature, Lock, Printer, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { consolidate } from "@/lib/grading";
import { allSubmitted, canFinalize, canOpenDeliberation, type Viewer } from "@/lib/permissions";
import { shortHash } from "@/lib/signature";
import { VERDICT_LABEL, type SessionBundle, type User, type Verdict } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";
import { PanelStatusList } from "./panel-status";

export function DeliberationMatrix({ bundle, viewer, userById, onFinalize }: {
  bundle: SessionBundle;
  viewer: Viewer;
  userById: (id: string) => User | undefined;
  onFinalize: (v: Verdict) => Promise<void>;
}) {
  if (!canOpenDeliberation(viewer, bundle)) {
    const pending = bundle.assignments.filter((a) => !a.has_submitted).length;
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="size-4 text-warning" />
          <span>
            {viewer.isChair
              ? `Consolidated view unlocks when all panelists submit (${pending} pending).`
              : "Consolidated scores are visible only to the Defense Chair until the defense is locked."}
          </span>
        </div>
        <PanelStatusList bundle={bundle} userById={userById} />
      </div>
    );
  }
  return <Matrix bundle={bundle} viewer={viewer} userById={userById} onFinalize={onFinalize} />;
}

function Matrix({ bundle, viewer, userById, onFinalize }: Parameters<typeof DeliberationMatrix>[0]) {
  const c = consolidate(bundle);
  const [verdict, setVerdict] = React.useState<Verdict>(bundle.session.verdict ?? c.suggestedVerdict);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const locked = bundle.session.is_locked;
  const short = (id: string) => userById(id)?.full_name.replace(/^(Dr\.|Prof\.|Engr\.)\s*/, "").split(" ").slice(-1)[0];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={locked ? "success" : "default"}>{locked ? "Locked" : allSubmitted(bundle) ? "All panelists submitted" : ""}</Badge>
        {c.flaggedCount > 0 && (
          <Badge variant="warning"><AlertTriangle className="size-3" /> {c.flaggedCount} high-variance criteria</Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Criterion</th>
              {c.panel.map((p) => (
                <th key={p.assignment.id} className="px-2 py-1.5 text-right font-medium">
                  {short(p.assignment.faculty_id)}{p.assignment.panel_role === "chair" && " (C)"}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Mean</th>
              <th className="px-2 py-1.5 text-right font-medium">Range</th>
            </tr>
          </thead>
          <tbody>
            {c.stats.map((s, i) => {
              const header = i === 0 || c.stats[i - 1].student?.id !== s.student?.id;
              return (
                <React.Fragment key={`${s.criterion.id}-${s.student?.id ?? "g"}`}>
                  {header && (
                    <tr className="border-t bg-muted/40">
                      <td colSpan={c.panel.length + 3} className="px-2 py-1 font-semibold">
                        {s.student ? `Individual — ${s.student.student_name}` : "Group Criteria"}
                      </td>
                    </tr>
                  )}
                  <tr className={cn("border-t", s.flagged && "bg-warning/10")}>
                    <td className="px-2 py-1.5">
                      {s.criterion.criterion_name} <span className="text-muted-foreground">({s.criterion.weight_percentage}%)</span>
                    </td>
                    {c.panel.map((p) => {
                      const v = s.byAssignment[p.assignment.id];
                      const outlier = s.flagged && v !== undefined && Math.abs(v - s.mean) >= s.range / 2;
                      return (
                        <td key={p.assignment.id} className={cn("px-2 py-1.5 text-right tabular-nums", outlier && "font-semibold text-warning")}>
                          {v?.toFixed(1) ?? "—"}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{s.mean.toFixed(2)}</td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", s.flagged && "font-semibold text-warning")}>
                      {s.range.toFixed(1)}{s.flagged && " ⚠"}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Proponent</th>
              <th className="px-2 py-1.5 text-right font-medium">Group %</th>
              <th className="px-2 py-1.5 text-right font-medium">Indiv. %</th>
              <th className="px-2 py-1.5 text-right font-medium">Final %</th>
              <th className="px-2 py-1.5 text-right font-medium">Grade</th>
              <th className="px-2 py-1.5 text-left font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {c.students.map((s) => (
              <tr key={s.member.id} className="border-t">
                <td className="px-2 py-1.5">{s.member.student_name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.groupPercent.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{s.individualPercent.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{s.finalPercent.toFixed(2)}</td>
                <td className={cn("px-2 py-1.5 text-right font-semibold tabular-nums", s.passed ? "text-success" : "text-destructive")}>{s.transmuted.toFixed(2)}</td>
                <td className="px-2 py-1.5">{s.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t px-3 py-2 text-sm font-semibold">
          CONSOLIDATED WEIGHTED SCORE: {c.overallRating.toFixed(2)} / {(bundle.criteria[0]?.max_score ?? 5).toFixed(1)} ({c.overallPercent.toFixed(2)}%)
          <span className="font-normal text-muted-foreground"> · Suggested: {VERDICT_LABEL[c.suggestedVerdict]}</span>
        </p>
      </div>

      {locked ? (
        <div className="space-y-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-success"><ShieldCheck className="size-4" /> Final verdict: {VERDICT_LABEL[bundle.session.verdict!]}</p>
          <p className="text-muted-foreground">Locked {fmtDateTime(bundle.session.locked_at)}</p>
          <p className="font-mono break-all">Chair signature SHA-256 {shortHash(bundle.session.chair_signature_hash)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="outline"><Link href={`/print/${bundle.session.id}/rating-sheet`} target="_blank"><Printer /> Rating Sheet</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/print/${bundle.session.id}/minutes`} target="_blank"><Printer /> Minutes</Link></Button>
          </div>
        </div>
      ) : canFinalize(viewer, bundle) ? (
        <div className="space-y-2 rounded-md border bg-background/40 p-3">
          <Label htmlFor="verdict">Consensus Verdict</Label>
          <NativeSelect id="verdict" value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
            {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
              <option key={v} value={v}>{VERDICT_LABEL[v]}{v === c.suggestedVerdict ? " (suggested)" : ""}</option>
            ))}
          </NativeSelect>
          {confirm ? (
            <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
              <p>This freezes all scores, comments and minutes and records your signature. It cannot be undone.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={busy}
                  onClick={async () => { setBusy(true); await onFinalize(verdict); setBusy(false); setConfirm(false); }}>
                  <FileSignature /> Confirm Finalize & Lock
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={() => setConfirm(true)}><Lock /> Finalize & Lock Defense</Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Awaiting the Chair&apos;s final verdict.</p>
      )}
    </div>
  );
}
