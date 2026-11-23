import { describe, expect, it } from "vitest";
import { configFor, consolidate, evaluatePanelist, transmute, suggestVerdict, weightedScore } from "../grading";
import { seedBundles } from "../mock-data";
import { canonicalScorePayload, signEvaluation } from "../signature";
import { canSeeScoresOf, resolveViewer } from "../permissions";
import { USERS } from "../mock-data";

const bundle = () => seedBundles()[0];

describe("weightedScore", () => {
  it("weights criteria by percentage", () => {
    const b = bundle();
    const group = b.criteria.filter((c) => c.scope === "group");
    const scores: Record<string, number> = { "c-f-g1": 5, "c-f-g2": 4, "c-f-g3": 3, "c-f-g4": 2 };
    const r = weightedScore(group, (c) => scores[c.id]);
    // (1*35 + .8*25 + .6*25 + .4*15) / 100 = .76
    expect(r.percent).toBe(76);
    expect(r.rating).toBe(3.8);
    expect(r.complete).toBe(true);
  });

  it("reports incomplete scoring", () => {
    const b = bundle();
    const r = weightedScore(b.criteria.filter((c) => c.scope === "group"), (c) => (c.id === "c-f-g1" ? 5 : undefined));
    expect(r.complete).toBe(false);
    expect(r.scored).toBe(1);
  });
});

describe("transmutation & verdict", () => {
  it.each([[100, 1.0], [97, 1.0], [96.99, 1.25], [83.2, 2.25], [75, 3.0], [74.99, 5.0]])("%s%% → %s", (p, g) => {
    expect(transmute(p).grade).toBe(g);
  });
  it("suggests verdicts by band", () => {
    expect(suggestVerdict(92)).toBe("passed");
    expect(suggestVerdict(83)).toBe("passed_minor_revisions");
    expect(suggestVerdict(76)).toBe("passed_major_revisions");
    expect(suggestVerdict(70)).toBe("re_defense");
  });
});

describe("evaluatePanelist / consolidate", () => {
  it("combines group 60% + individual 40%", () => {
    const b = bundle();
    const diaz = b.assignments.find((a) => a.id === "pa-2-diaz")!;
    const e = evaluatePanelist(b, diaz);
    expect(e.complete).toBe(true);
    // group: (.92*35 + .68*25 + .8*25 + .84*15) = 81.8 ; Andrea indiv: (.9+.88)/2 = 89
    expect(e.group.percent).toBe(81.8);
    expect(e.individuals["m-g4-1"].percent).toBe(89);
    expect(e.finals["m-g4-1"]).toBeCloseTo(81.8 * 0.6 + 89 * 0.4, 2);
  });

  it("only counts submitted evaluations and flags variance", () => {
    const b = bundle();
    const c = consolidate(b);
    expect(c.panel).toHaveLength(1); // only Diaz submitted in seed
    const all = consolidate(b, undefined, { includeUnsubmitted: true });
    expect(all.panel).toHaveLength(3);
    // Technical Documentation: 4.0 / 3.4 / 4.5 → range 1.1 ≥ 1.0
    expect(all.stats.find((s) => s.criterion.id === "c-f-g2" && !s.student)!.flagged).toBe(true);
  });
});

describe("blind grading visibility", () => {
  it("hides other panelists' scores until own submission", () => {
    const b = bundle();
    const gomez = resolveViewer(USERS.find((u) => u.id === "u-gomez")!, b);
    const diazA = b.assignments.find((a) => a.id === "pa-2-diaz")!;
    expect(canSeeScoresOf(gomez, diazA, b)).toBe(false);
    b.assignments = b.assignments.map((a) => (a.id === "pa-3-gomez" ? { ...a, has_submitted: true } : a));
    expect(canSeeScoresOf(resolveViewer(USERS.find((u) => u.id === "u-gomez")!, b), diazA, b)).toBe(true);
  });
  it("adviser sees nothing until lock", () => {
    const b = bundle();
    const adviser = resolveViewer(USERS.find((u) => u.id === "u-reyes")!, b);
    expect(canSeeScoresOf(adviser, b.assignments[1], b)).toBe(false);
    b.session.is_locked = true;
    expect(canSeeScoresOf(adviser, b.assignments[1], b)).toBe(true);
  });
});

describe("signature", () => {
  it("is deterministic and order-independent", async () => {
    const b = bundle();
    const rows = b.scores.filter((s) => s.panel_assignment_id === "pa-2-diaz");
    expect(canonicalScorePayload(rows)).toBe(canonicalScorePayload([...rows].reverse()));
    const h1 = await signEvaluation("u-diaz", "2026-11-23T02:41:17.000Z", rows);
    const h2 = await signEvaluation("u-diaz", "2026-11-23T02:41:17.000Z", [...rows].reverse());
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    rows[0] = { ...rows[0], score: rows[0].score + 0.1 };
    expect(await signEvaluation("u-diaz", "2026-11-23T02:41:17.000Z", rows)).not.toBe(h1);
  });
});

describe("configFor (per-session blend)", () => {
  it("uses the session's frozen blend", () => {
    const b = bundle();
    b.session = { ...b.session, group_weight: 70, individual_weight: 30 };
    const diaz = b.assignments.find((a) => a.id === "pa-2-diaz")!;
    const e = evaluatePanelist(b, diaz);
    expect(e.finals["m-g4-1"]).toBeCloseTo(81.8 * 0.7 + 89 * 0.3, 2);
    expect(consolidate(b).students[0].finalPercent).toBeCloseTo(81.8 * 0.7 + 89 * 0.3, 2);
  });
  it("falls back to 60/40 for legacy sessions without a blend", () => {
    const b = bundle();
    const legacy = { ...b, session: { ...b.session } } as typeof b;
    delete (legacy.session as Partial<typeof legacy.session>).group_weight;
    delete (legacy.session as Partial<typeof legacy.session>).individual_weight;
    expect(configFor(legacy)).toMatchObject({ groupWeight: 60, individualWeight: 40 });
  });
  it("100/0 makes the final equal the group score", () => {
    const b = bundle();
    b.session = { ...b.session, group_weight: 100, individual_weight: 0 };
    const e = evaluatePanelist(b, b.assignments.find((a) => a.id === "pa-2-diaz")!);
    expect(e.finals["m-g4-2"]).toBe(81.8);
  });
});
