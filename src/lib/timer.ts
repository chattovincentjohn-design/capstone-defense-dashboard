/**
 * Shared defense timer (mirrors timer_action() in the database).
 * Remaining time = phases[phase].minutes × 60 − (elapsed + (running ? now − started_at : 0)).
 */
export interface TimerPhase { label: string; minutes: number }
export interface TimerState {
  phases: TimerPhase[];
  phase: number;
  running: boolean;
  started_at: string | null;
  elapsed: number;
}
export type TimerAction = "start" | "pause" | "next" | "reset" | "configure";

export const DEFAULT_PHASES: TimerPhase[] = [
  { label: "Presentation", minutes: 20 },
  { label: "Q&A", minutes: 20 },
  { label: "Deliberation", minutes: 15 },
];
export const defaultTimer = (): TimerState => ({ phases: DEFAULT_PHASES, phase: 0, running: false, started_at: null, elapsed: 0 });

const usedSeconds = (t: TimerState, now: number) =>
  t.elapsed + (t.running && t.started_at ? Math.max(0, (now - Date.parse(t.started_at)) / 1000) : 0);

/** Whole seconds left in the current part (negative = overtime). */
export function remainingSeconds(t: TimerState, now = Date.now()): number {
  const p = t.phases[t.phase] ?? t.phases[0];
  return Math.round(p.minutes * 60 - usedSeconds(t, now));
}

/** Problems with a set of parts, or [] if they are fine. */
export function timerPhaseProblems(phases: TimerPhase[]): string[] {
  const p: string[] = [];
  if (phases.length < 1 || phases.length > 6) p.push("Set 1 to 6 parts.");
  phases.forEach((ph, i) => {
    if (!ph.label.trim() || ph.label.length > 40) p.push(`Part ${i + 1} needs a name (up to 40 characters).`);
    if (!Number.isInteger(ph.minutes) || ph.minutes < 1 || ph.minutes > 180) p.push(`Part ${i + 1}: minutes must be a whole number from 1 to 180.`);
  });
  return p;
}

export function applyTimerAction(t0: TimerState | null | undefined, action: TimerAction, now = Date.now(), phases?: TimerPhase[]): TimerState {
  const t = t0 ?? defaultTimer();
  const stopped = { running: false, started_at: null };
  switch (action) {
    case "start": return { ...t, running: true, started_at: new Date(now).toISOString() };
    case "pause": return { ...t, ...stopped, elapsed: Math.round(usedSeconds(t, now)) };
    case "next": return { ...t, ...stopped, phase: (t.phase + 1) % t.phases.length, elapsed: 0 };
    case "reset": return { ...t, ...stopped, elapsed: 0 };
    case "configure": {
      const ph = (phases ?? t.phases).map((x) => ({ label: x.label.trim(), minutes: x.minutes }));
      const problems = timerPhaseProblems(ph);
      if (problems.length) throw new Error(problems.join(" "));
      return { ...t, ...stopped, phases: ph, phase: Math.min(t.phase, ph.length - 1), elapsed: 0 };
    }
  }
}

export const fmtClock = (s: number) => {
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};
