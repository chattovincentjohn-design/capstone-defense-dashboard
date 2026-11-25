import { describe, expect, it } from "vitest";
import { configFor, consolidate, criterionPercent, scoreLabel, evaluatePanelist, transmute, suggestVerdict, weightedScore } from "../grading";
import { seedBundles } from "../mock-data";
import { canonicalScorePayload, signEvaluation } from "../signature";
import { canSeeScoresOf, resolveViewer } from "../permissions";
import { USERS } from "../mock-data";

const bundle = () => seedBundles()[0];

describe("weightedScore", () => {
  it("turns 1–5 ratings into the rating sheet's percentages", () => {
    const b = bundle();
    const group = b.criteria.filter((c) => c.scope === "group");
    expect(group).toHaveLength(15);
    const all = (r: number) => weightedScore(group, () => r);
    expect(all(5).percent).toBe(98);
    expect(all(4).percent).toBe(93);
    expect(all(3).percent).toBe(88.5);
    expect(all(2).percent).toBe(85);
    expect(all(1).percent).toBe(80);
    expect(all(4).rating).toBe(4);
    expect(all(4).complete).toBe(true);
  });

  it("interpolates between rating boxes and treats /10 items as points", () => {
    expect(criterionPercent(4.5, 5)).toBe(95.5);
    expect(criterionPercent(0, 5)).toBe(0);
    expect(criterionPercent(9, 10)).toBe(90);
    expect(criterionPercent(21, 30)).toBe(70);
  });

  it("labels rating-scale scores as percentages and points as points", () => {
    expect(scoreLabel(3, { max_score: 5 })).toBe("88.5");
    expect(scoreLabel(5, { max_score: 5 })).toBe("98");
    expect(scoreLabel(9, { max_score: 10 })).toBe("9");
    expect(scoreLabel(undefined, { max_score: 5 })).toBe("—");
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
  it("combines group 30% + individual 70%", () => {
    const b = bundle();
    const diaz = b.assignments.find((a) => a.id === "pa-2-diaz")!;
    const e = evaluatePanelist(b, diaz);
    expect(e.complete).toBe(true);
    // group: two 5s (98), ten 4s (93), three 3s (88.5) ≈ 92.77 ; Andrea indiv: 9+9+8 of 30 = 86.67
    expect(e.group.percent).toBe(92.77);
    expect(e.individuals["m-g4-1"].percent).toBe(86.67);
    expect(e.finals["m-g4-1"]).toBeCloseTo(92.77 * 0.3 + 86.67 * 0.7, 1);
  });

  it("only counts submitted evaluations and flags variance", () => {
    const b = bundle();
    const c = consolidate(b);
    expect(c.panel).toHaveLength(1); // only Diaz submitted in seed
    const all = consolidate(b, undefined, { includeUnsubmitted: true });
    expect(all.panel).toHaveLength(3);
    // Item 3: 4 / 3 / 4 → range 1 ≥ 1.0 ; item 2: 4 / 4 / 5 → also 1
    expect(all.stats.find((s) => s.criterion.id === "c-f-g3" && !s.student)!.flagged).toBe(true);
    expect(all.stats.find((s) => s.criterion.id === "c-f-g4" && !s.student)!.flagged).toBe(false);
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
    expect(e.finals["m-g4-1"]).toBeCloseTo(92.77 * 0.7 + 86.67 * 0.3, 1);
    expect(consolidate(b).students[0].finalPercent).toBeCloseTo(92.77 * 0.7 + 86.67 * 0.3, 1);
  });
  it("falls back to 30/70 for legacy sessions without a blend", () => {
    const b = bundle();
    const legacy = { ...b, session: { ...b.session } } as typeof b;
    delete (legacy.session as Partial<typeof legacy.session>).group_weight;
    delete (legacy.session as Partial<typeof legacy.session>).individual_weight;
    expect(configFor(legacy)).toMatchObject({ groupWeight: 30, individualWeight: 70 });
  });
  it("100/0 makes the final equal the group score", () => {
    const b = bundle();
    b.session = { ...b.session, group_weight: 100, individual_weight: 0 };
    const e = evaluatePanelist(b, b.assignments.find((a) => a.id === "pa-2-diaz")!);
    expect(e.finals["m-g4-2"]).toBe(92.77);
  });
});
