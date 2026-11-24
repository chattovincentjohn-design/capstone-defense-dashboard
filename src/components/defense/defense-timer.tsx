"use client";
import * as React from "react";
import { Clock, Minus, Pause, Play, Plus, RotateCcw, Settings2, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  defaultTimer, fmtClock, remainingSeconds, timerPhaseProblems, type TimerAction, type TimerPhase, type TimerState,
} from "@/lib/timer";
import { cn } from "@/lib/utils";

/**
 * Shared phase countdown for the whole panel. Only the Defense Chair (or the Coordinator)
 * controls it; everyone else sees the same time live. Goes negative on overtime.
 */
export function DefenseTimer({ timer, canControl, locked, onAction }: {
  timer: TimerState | null | undefined;
  canControl: boolean;
  locked: boolean;
  onAction: (action: TimerAction, phases?: TimerPhase[]) => Promise<void> | void;
}) {
  const t = timer ?? defaultTimer();
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!t.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [t.running]);
  React.useEffect(() => setNow(Date.now()), [timer]);

  const remaining = remainingSeconds(t, now);
  const phase = t.phases[t.phase] ?? t.phases[0];
  const nextLabel = t.phases[(t.phase + 1) % t.phases.length]?.label;
  const tone = remaining < 0 ? "text-destructive border-destructive/60" : remaining <= 120 ? "text-warning border-warning/60" : "text-foreground border-primary/50";
  const act = async (a: TimerAction, phases?: TimerPhase[]) => {
    setBusy(true);
    try { await onAction(a, phases); } finally { setBusy(false); }
  };
  const controls = canControl && !locked;

  return (
    <div className="relative flex items-center gap-1" role="timer" aria-label={`${phase.label} timer`}>
      <div className={cn("flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-1.5 text-sm font-semibold tabular-nums", tone)}
        title={controls ? "Shared timer: everyone on this defense sees it" : "Shared timer, controlled by the Defense Chair"}>
        <Clock className="size-4" aria-hidden />
        <span>TIMER {fmtClock(remaining)}</span>
        <span className="text-xs font-normal text-muted-foreground">
          ({phase.label} · {t.phase + 1}/{t.phases.length}){t.running ? "" : " · paused"}
        </span>
      </div>
      {controls && (
        <>
          <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => void act(t.running ? "pause" : "start")}
            aria-label={t.running ? "Pause timer" : "Start timer"}>
            {t.running ? <Pause /> : <Play />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => void act("next")}
            aria-label={`Next part: ${nextLabel}`} title={`Next part: ${nextLabel}`}>
            <SkipForward />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => void act("reset")} aria-label="Restart this part" title="Restart this part">
            <RotateCcw />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => setEditing((v) => !v)} aria-label="Timer settings" title="Timer settings">
            <Settings2 />
          </Button>
        </>
      )}
      {editing && controls && (
        <TimerSettings phases={t.phases} onClose={() => setEditing(false)}
          onSave={async (phases) => { await act("configure", phases); setEditing(false); }} />
      )}
    </div>
  );
}

function TimerSettings({ phases, onSave, onClose }: {
  phases: TimerPhase[]; onSave: (p: TimerPhase[]) => Promise<void>; onClose: () => void;
}) {
  const [rows, setRows] = React.useState<TimerPhase[]>(phases.map((p) => ({ ...p })));
  const [busy, setBusy] = React.useState(false);
  const problems = timerPhaseProblems(rows);
  const set = (i: number, patch: Partial<TimerPhase>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-[min(92vw,380px)] space-y-3 rounded-lg border bg-card p-4 text-sm shadow-xl">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Timer settings</p>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Close timer settings" onClick={onClose}><X /></Button>
      </div>
      <p className="text-xs text-muted-foreground">Parts of this defense, in order. Saving restarts the current part.</p>
      <ul className="space-y-2">
        {rows.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input aria-label={`Part ${i + 1} name`} className="h-8 flex-1 text-xs" value={p.label} maxLength={40}
              onChange={(e) => set(i, { label: e.target.value })} />
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Less time for part ${i + 1}`}
                onClick={() => set(i, { minutes: Math.max(1, p.minutes - 1) })}><Minus /></Button>
              <Input aria-label={`Part ${i + 1} minutes`} className="h-8 w-14 text-center text-xs" inputMode="numeric" value={String(p.minutes)}
                onChange={(e) => set(i, { minutes: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`More time for part ${i + 1}`}
                onClick={() => set(i, { minutes: Math.min(180, p.minutes + 1) })}><Plus /></Button>
              <span className="text-xs text-muted-foreground">min</span>
            </div>
            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Remove part ${i + 1}`} disabled={rows.length === 1}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><X /></Button>
          </li>
        ))}
      </ul>
      <Button type="button" size="sm" variant="outline" disabled={rows.length >= 6}
        onClick={() => setRows((r) => [...r, { label: "Open forum", minutes: 10 }])}><Plus /> Add part</Button>
      {problems.length > 0 && <ul className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" size="sm" disabled={busy || problems.length > 0}
          onClick={async () => { setBusy(true); try { await onSave(rows); } finally { setBusy(false); } }}>Save</Button>
      </div>
    </div>
  );
}
