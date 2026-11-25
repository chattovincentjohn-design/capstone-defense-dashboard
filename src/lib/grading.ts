/**
 * Grade computation engine.
 *
 *  criterion %   = 1–5 rating → the rating sheet's percentage (RATING_SCALE: 5=98, 4=93, 3=88.5, 2=85, 1=80)
 *                  any other maximum (e.g. /10 points) → score / max_score
 *  group %       = Σ(criterion% × weight) / Σweight × 100       (group criteria)
 *  individual %  = same, per student                              (individual criteria)
 *  student final = group% × groupWeight + individual% × indivWeight   (per session; default 30/70 per the JHCSC rating sheet)
 *  consolidated  = mean of each submitted panelist's student final
 *  transmuted    = percentage → 1.00–5.00 college scale (table below)
 */
import type {
  DefenseSession, PanelAssignment, ProjectMember, RubricCriterion, RubricScore, SessionBundle, Verdict,
} from "./types";
import { round } from "./utils";

export interface GradingConfig {
  groupWeight: number;       // percent of final grade from group criteria
  individualWeight: number;  // percent from individual criteria
  passingPercent: number;
  /** Range (max−min, on the criterion's own scale) at/above which panel disagreement is flagged. */
  varianceThreshold: number;
}

export const DEFAULT_GRADING_CONFIG: GradingConfig = {
  groupWeight: 30,
  individualWeight: 70,
  passingPercent: 75,
  varianceThreshold: 1.0,
};

/** The blend a session was scheduled with; legacy sessions without one use the default. */
export function configFor(bundle?: { session?: Partial<Pick<DefenseSession, "group_weight" | "individual_weight">> }): GradingConfig {
  const s = bundle?.session;
  if (s?.group_weight == null || s?.individual_weight == null) return DEFAULT_GRADING_CONFIG;
  return { ...DEFAULT_GRADING_CONFIG, groupWeight: Number(s.group_weight), individualWeight: Number(s.individual_weight) };
}

/** Standard Philippine HEI transmutation (percentage → grade point). */
export const TRANSMUTATION_TABLE: { min: number; grade: number; remark: string }[] = [
  { min: 97, grade: 1.0, remark: "Excellent" },
  { min: 94, grade: 1.25, remark: "Excellent" },
  { min: 91, grade: 1.5, remark: "Very Good" },
  { min: 88, grade: 1.75, remark: "Very Good" },
  { min: 85, grade: 2.0, remark: "Good" },
  { min: 82, grade: 2.25, remark: "Good" },
  { min: 79, grade: 2.5, remark: "Satisfactory" },
  { min: 76, grade: 2.75, remark: "Satisfactory" },
  { min: 75, grade: 3.0, remark: "Passed" },
  { min: 0, grade: 5.0, remark: "Failed" },
];

export function transmute(percent: number) {
  const p = round(percent, 2);
  const row = TRANSMUTATION_TABLE.find((r) => p >= r.min) ?? TRANSMUTATION_TABLE.at(-1)!;
  return { grade: row.grade, remark: row.remark };
}

/** Recommendation only — the Chair records the consensus verdict. */
export function suggestVerdict(percent: number): Verdict {
  if (percent >= 90) return "passed";
  if (percent >= 80) return "passed_minor_revisions";
  if (percent >= 75) return "passed_major_revisions";
  return "re_defense";
}

export interface WeightedResult {
  percent: number;       // 0–100
  rating: number;        // on the rubric's native scale (e.g. /5)
  scaleMax: number;
  scored: number;        // criteria with a score
  total: number;         // criteria expected
  complete: boolean;
}

/**
 * JHCSC Capstone Rating Sheet: a 1–5 rating stands for a percentage band; the system uses
 * the middle of each band. Ratings in between (e.g. 4.5) are interpolated.
 */
export const RATING_SCALE: { rating: number; percent: number; band: string; label: string }[] = [
  { rating: 5, percent: 98, band: "96–100", label: "Excellent" },
  { rating: 4, percent: 93, band: "91–95", label: "Exceeds Expectations" },
  { rating: 3, percent: 88.5, band: "87–90", label: "Meets Expectations" },
  { rating: 2, percent: 85, band: "84–86", label: "Meets Expectations Sometimes" },
  { rating: 1, percent: 80, band: "below 84", label: "Does not Meet Expectations" },
];

/** Criteria scored out of 5 use the rating sheet's scale; anything else is points. */
export const usesRatingScale = (c: Pick<RubricCriterion, "max_score">) => Number(c.max_score) === 5;

/** Percentage (0–100) a single score is worth. */
export function criterionPercent(score: number, maxScore: number): number {
  if (Number(maxScore) !== 5) return maxScore > 0 ? (score / maxScore) * 100 : 0;
  const s = Math.min(5, Math.max(0, score));
  if (s < 1) return s * RATING_SCALE[4].percent; // below the lowest box: scale down to 0
  const lo = RATING_SCALE.find((r) => r.rating === Math.floor(s))!;
  const hi = RATING_SCALE.find((r) => r.rating === Math.ceil(s))!;
  return lo.percent + (hi.percent - lo.percent) * (s - lo.rating);
}

export function weightedScore(
  criteria: RubricCriterion[],
  lookup: (c: RubricCriterion) => number | undefined,
): WeightedResult {
  const scaleMax = criteria[0]?.max_score ?? 5;
  let num = 0;
  let raw = 0;
  let den = 0;
  let scored = 0;
  for (const c of criteria) {
    const s = lookup(c);
    if (s === undefined) continue;
    scored++;
    num += criterionPercent(s, c.max_score) * c.weight_percentage;
    raw += (s / c.max_score) * c.weight_percentage;
    den += c.weight_percentage;
  }
  const percent = den ? num / den : 0;
  return {
    percent: round(percent, 2),
    rating: round(den ? (raw / den) * scaleMax : 0, 2),
    scaleMax,
    scored,
    total: criteria.length,
    complete: criteria.length > 0 && scored === criteria.length,
  };
}

export function splitCriteria(criteria: RubricCriterion[]) {
  const sorted = [...criteria].sort((a, b) => a.sort_order - b.sort_order);
  return {
    group: sorted.filter((c) => c.scope === "group"),
    individual: sorted.filter((c) => c.scope === "individual"),
  };
}

export function scoreLookup(scores: RubricScore[], assignmentId: string, studentId: string | null) {
  const map = new Map<string, number>();
  for (const s of scores) {
    if (s.panel_assignment_id === assignmentId && s.student_id === studentId) map.set(s.criterion_id, s.score);
  }
  return (c: RubricCriterion) => map.get(c.id);
}

export interface PanelistEvaluation {
  assignment: PanelAssignment;
  group: WeightedResult;
  individuals: Record<string, WeightedResult>;
  finals: Record<string, number>; // studentId → final %
  complete: boolean;
}

export function evaluatePanelist(
  bundle: Pick<SessionBundle, "criteria" | "scores" | "members"> & { session?: Partial<DefenseSession> },
  assignment: PanelAssignment,
  config: GradingConfig = configFor(bundle),
): PanelistEvaluation {
  const { group, individual } = splitCriteria(bundle.criteria);
  const g = weightedScore(group, scoreLookup(bundle.scores, assignment.id, null));
  const individuals: Record<string, WeightedResult> = {};
  const finals: Record<string, number> = {};
  for (const m of bundle.members) {
    const ind = weightedScore(individual, scoreLookup(bundle.scores, assignment.id, m.id));
    individuals[m.id] = ind;
    finals[m.id] = finalPercent(g.percent, ind.percent, config, individual.length > 0);
  }
  return {
    assignment,
    group: g,
    individuals,
    finals,
    complete: g.complete && Object.values(individuals).every((r) => r.complete || individual.length === 0),
  };
}

function finalPercent(groupPct: number, indivPct: number, config: GradingConfig, hasIndividual: boolean) {
  if (!hasIndividual) return groupPct;
  const w = config.groupWeight + config.individualWeight;
  if (w <= 0) return groupPct;
  return round((groupPct * config.groupWeight + indivPct * config.individualWeight) / w, 2);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

export interface CriterionStat {
  criterion: RubricCriterion;
  student: ProjectMember | null;
  byAssignment: Record<string, number | undefined>;
  mean: number;
  stdev: number;
  range: number;
  flagged: boolean;
}

export interface StudentResult {
  member: ProjectMember;
  individualPercent: number;
  finalPercent: number;
  transmuted: number;
  remark: string;
  passed: boolean;
}

export interface Consolidation {
  panel: PanelistEvaluation[];
  groupPercent: number;
  groupRating: number;
  students: StudentResult[];
  overallPercent: number;
  overallRating: number;
  stats: CriterionStat[];
  flaggedCount: number;
  suggestedVerdict: Verdict;
}

/** Aggregate scores. By default only submitted (signed) evaluations count. */
export function consolidate(
  bundle: SessionBundle,
  config: GradingConfig = configFor(bundle),
  opts: { includeUnsubmitted?: boolean } = {},
): Consolidation {
  const assignments = bundle.assignments.filter((a) => opts.includeUnsubmitted || a.has_submitted);
  const panel = assignments.map((a) => evaluatePanelist(bundle, a, config));
  const { group, individual } = splitCriteria(bundle.criteria);
  const scaleMax = bundle.criteria[0]?.max_score ?? 5;

  const groupPercent = round(mean(panel.map((p) => p.group.percent)), 2);
  const students: StudentResult[] = bundle.members.map((m) => {
    const indiv = round(mean(panel.map((p) => p.individuals[m.id]?.percent ?? 0)), 2);
    const fin = round(mean(panel.map((p) => p.finals[m.id] ?? 0)), 2);
    const t = transmute(fin);
    return { member: m, individualPercent: indiv, finalPercent: fin, transmuted: t.grade, remark: t.remark, passed: fin >= config.passingPercent };
  });

  const stats: CriterionStat[] = [];
  const pushStat = (c: RubricCriterion, student: ProjectMember | null) => {
    const byAssignment: Record<string, number | undefined> = {};
    for (const a of assignments) byAssignment[a.id] = scoreLookup(bundle.scores, a.id, student?.id ?? null)(c);
    const vals = Object.values(byAssignment).filter((v): v is number => v !== undefined);
    const range = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    stats.push({
      criterion: c, student, byAssignment,
      mean: round(mean(vals), 2), stdev: round(stdev(vals), 2), range: round(range, 2),
      flagged: vals.length > 1 && range >= config.varianceThreshold,
    });
  };
  group.forEach((c) => pushStat(c, null));
  bundle.members.forEach((m) => individual.forEach((c) => pushStat(c, m)));

  const overallPercent = round(mean(students.map((s) => s.finalPercent)), 2);
  return {
    panel,
    groupPercent,
    groupRating: round((groupPercent / 100) * scaleMax, 2),
    students,
    overallPercent,
    overallRating: round((overallPercent / 100) * scaleMax, 2),
    stats,
    flaggedCount: stats.filter((s) => s.flagged).length,
    suggestedVerdict: suggestVerdict(overallPercent),
  };
}
