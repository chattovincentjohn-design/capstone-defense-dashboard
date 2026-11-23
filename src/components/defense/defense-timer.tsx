"use client";
import * as React from "react";
import { Clock, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PHASES = [
  { key: "presentation", label: "Presentation", minutes: 20 },
  { key: "qa", label: "Q&A", minutes: 20 },
  { key: "deliberation", label: "Deliberation", minutes: 15 },
] as const;

const fmt = (s: number) => {
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

/** Phase countdown (Presentation → Q&A → Deliberation). Goes negative on overtime. */
export function DefenseTimer({ disabled }: { disabled?: boolean }) {
  const [phase, setPhase] = React.useState(0);
  const [remaining, setRemaining] = React.useState<number>(PHASES[0].minutes * 60);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const next = () => {
    const p = (phase + 1) % PHASES.length;
    setPhase(p);
    setRemaining(PHASES[p].minutes * 60);
  };

  const tone = remaining < 0 ? "text-destructive border-destructive/60" : remaining <= 120 ? "text-warning border-warning/60" : "text-foreground border-primary/50";

  return (
    <div className="flex items-center gap-1" role="timer" aria-label={`${PHASES[phase].label} timer`}>
      <div className={cn("flex items-center gap-2 rounded-md border bg-secondary/50 px-3 py-1.5 text-sm font-semibold tabular-nums", tone)}>
        <Clock className="size-4" aria-hidden />
        <span>TIMER {fmt(remaining)}</span>
        <span className="text-xs font-normal text-muted-foreground">({PHASES[phase].label})</span>
      </div>
      <Button size="icon" variant="ghost" className="size-8" disabled={disabled} onClick={() => setRunning((r) => !r)} aria-label={running ? "Pause timer" : "Start timer"}>
        {running ? <Pause /> : <Play />}
      </Button>
      <Button size="icon" variant="ghost" className="size-8" disabled={disabled} onClick={next} aria-label="Next phase">
        <SkipForward />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" disabled={disabled} onClick={() => { setRunning(false); setRemaining(PHASES[phase].minutes * 60); }} aria-label="Reset phase">
        <RotateCcw />
      </Button>
    </div>
  );
}
