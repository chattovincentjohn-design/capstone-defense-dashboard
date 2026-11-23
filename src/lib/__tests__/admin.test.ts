import { describe, expect, it } from "vitest";
import { consolidate } from "../grading";
import {
  activeRubric, blendProblems, deleteScheduledSession, fromManilaInput, gradesCsv, rubricProblems, saveStageRubric,
  scheduleSession, toManilaInput, updateScheduledSession, validateSchedule, type ScheduleDraft,
} from "../admin";
import { seedBundles, seedGrading, seedRubric, USERS } from "../mock-data";
import type { State } from "../store";

function state(): State {
  const bundles = seedBundles();
  return {
    bundles: Object.fromEntries(bundles.map((b) => [b.session.id, b])),
    order: bundles.map((b) => b.session.id),
    rubric: seedRubric(),
    grading: seedGrading(),
    currentUserId: "u-admin",
    hydrated: true,
  };
}

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  projectId: "new",
  newProject: {
    title: "Barangay Health Records", group_label: "Group 9", adviser_id: "u-reyes", academic_year: "2026-2027",
    manuscript_url: "", demo_url: "", abstract: "", members: [{ student_name: "Ana Cruz", student_number: "2022-1" }],
  },
  stage: "title",
  scheduledAt: "2026-12-01T01:00:00.000Z",
  room: "Room 301",
  secretaryId: "u-sec",
  chairId: "u-ramos",
  memberIds: ["u-diaz", "u-gomez"],
  ...over,
});

const errors = (s: State, d: ScheduleDraft) =>
  validateSchedule(d, s, USERS, new Date("2026-11-23")).filter((i) => i.level === "error").map((i) => i.message);

describe("time helpers", () => {
  it("round-trips Manila wall-clock time", () => {
    expect(fromManilaInput("2026-11-23T09:00")).toBe("2026-11-23T01:00:00.000Z");
    expect(toManilaInput("2026-11-23T01:00:00.000Z")).toBe("2026-11-23T09:00");
  });
});

describe("validateSchedule", () => {
  it("accepts a valid new defense", () => {
    expect(errors(state(), draft())).toEqual([]);
  });
  it("blocks adviser on panel, chair duplicated, secretary on panel", () => {
    const e = errors(state(), draft({ memberIds: ["u-reyes", "u-ramos"], secretaryId: "u-diaz", chairId: "u-ramos" }));
    expect(e.some((m) => m.includes("project adviser"))).toBe(true);
    expect(e.some((m) => m.includes("Chair cannot also"))).toBe(true);
    // secretary not on panel here; now put the secretary on the panel
    expect(errors(state(), draft({ secretaryId: "u-gomez" })).some((m) => m.includes("Secretary"))).toBe(true);
  });
  it("blocks a second open defense for the same project and stage", () => {
    expect(errors(state(), draft({ projectId: "p-g4", stage: "final", newProject: undefined })).join()).toMatch(/already has an open/);
  });
  it("warns on panel double-booking", () => {
    const w = validateSchedule(draft({ scheduledAt: "2026-11-23T01:30:00.000Z" }), state(), USERS, new Date("2026-11-01"));
    expect(w.some((i) => i.level === "warning" && i.message.includes("also booked"))).toBe(true);
  });
  it("prevents removing a panelist who already scored", () => {
    const s = state();
    const e = errors(s, draft({ sessionId: "sess-g4-final", projectId: "p-g4", newProject: undefined, stage: "final", memberIds: ["u-diaz"] }));
    expect(e.some((m) => m.includes("already entered scores"))).toBe(true);
  });
});

describe("scheduleSession / update / delete", () => {
  it("creates a session with a rubric snapshot and attendance", () => {
    const { state: s, sessionId } = scheduleSession(state(), draft(), USERS);
    const b = s.bundles[sessionId];
    expect(b.criteria.map((c) => c.id).sort()).toEqual(activeRubric(s.rubric, "title").map((c) => c.id).sort());
    expect(b.assignments.find((a) => a.panel_role === "chair")?.faculty_id).toBe("u-ramos");
    expect(b.minutes.attendance_json).toHaveLength(5); // 3 panel + adviser + 1 proponent
    expect(s.order.at(-1)).toBe(sessionId);
  });
  it("re-snapshots on stage change and preserves unchanged seats", () => {
    const { state: s, sessionId } = scheduleSession(state(), draft(), USERS);
    const before = s.bundles[sessionId].assignments.find((a) => a.faculty_id === "u-diaz")!.id;
    const projectId = s.bundles[sessionId].project.id;
    const s2 = updateScheduledSession(s, draft({ sessionId, projectId, newProject: undefined, stage: "proposal" }), USERS);
    expect(s2.bundles[sessionId].criteria.every((c) => c.stage === "proposal")).toBe(true);
    expect(s2.bundles[sessionId].assignments.find((a) => a.faculty_id === "u-diaz")!.id).toBe(before);
  });
  it("refuses to delete a scored session", () => {
    expect(() => deleteScheduledSession(state(), "sess-g4-final")).toThrow(/recorded scores/);
    expect(deleteScheduledSession(state(), "sess-g7-proposal").order).not.toContain("sess-g7-proposal");
  });
});

describe("saveStageRubric", () => {
  it("rejects weights that do not total 100", () => {
    const s = state();
    const drafts = activeRubric(s.rubric, "final").map((c) => (c.id === "c-f-g1" ? { ...c, weight_percentage: 40 } : c));
    expect(rubricProblems(drafts)[0]).toMatch(/105%/);
    expect(() => saveStageRubric(s, "final", drafts)).toThrow();
  });

  it("versions in-use criteria and leaves scored sessions frozen", () => {
    const s = state();
    const drafts = activeRubric(s.rubric, "final").map((c) =>
      c.id === "c-f-g1" ? { ...c, weight_percentage: 30 } : c.id === "c-f-g4" ? { ...c, weight_percentage: 20 } : c);
    const { state: s2, report } = saveStageRubric(s, "final", drafts);
    expect(report.versioned).toBe(2);
    expect(report.frozen).toEqual(["sess-g4-final"]);
    expect(s2.rubric.find((c) => c.id === "c-f-g1")!.is_active).toBe(false);
    expect(s2.bundles["sess-g4-final"].criteria.find((c) => c.id === "c-f-g1")!.weight_percentage).toBe(35);
    expect(activeRubric(s2.rubric, "final").find((c) => c.criterion_name === "System Functionality")!.weight_percentage).toBe(30);
  });

  it("syncs unscored sessions and supports add/remove", () => {
    const s = state();
    const drafts = activeRubric(s.rubric, "proposal")
      .filter((c) => c.id !== "c-p-g4")
      .map((c) => (c.id === "c-p-g1" ? { ...c, weight_percentage: 25 } : c));
    drafts.push({ id: "new-1", stage: "proposal", scope: "group", criterion_name: "Ethics & Data Privacy", description: "", weight_percentage: 20, max_score: 5, sort_order: 5 });
    const { state: s2, report } = saveStageRubric(s, "proposal", drafts);
    // Group 7 is unscored, so its criteria are edited in place (no needless versions)
    expect(report).toMatchObject({ added: 1, retired: 1, updated: 1, versioned: 0, synced: ["sess-g7-proposal"] });
    const names = s2.bundles["sess-g7-proposal"].criteria.map((c) => c.criterion_name);
    expect(names).toContain("Ethics & Data Privacy");
    expect(names).not.toContain("Significance & Innovation");
  });
});

describe("gradesCsv", () => {
  it("exports only locked sessions, one row per student", () => {
    const s = state();
    expect(gradesCsv(Object.values(s.bundles), USERS).split("\r\n")).toHaveLength(1);
    const b = s.bundles["sess-g4-final"];
    b.session = { ...b.session, is_locked: true, verdict: "passed", locked_at: "2026-11-23T03:00:00Z" };
    const lines = gradesCsv([b], USERS).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("IoT-Based Smart Agriculture System");
  });
});

describe("per-stage grade blend", () => {
  it("validates shares", () => {
    expect(blendProblems({ groupWeight: 70, individualWeight: 30 })).toEqual([]);
    expect(blendProblems({ groupWeight: 70, individualWeight: 40 })[0]).toMatch(/110%/);
    expect(blendProblems({ groupWeight: NaN, individualWeight: 40 })).toHaveLength(1);
    expect(blendProblems({ groupWeight: 100, individualWeight: 0 })).toEqual([]);
  });

  it("applies a new blend to unscored sessions only", () => {
    const s = state();
    const { state: s2, report } = saveStageRubric(s, "final", activeRubric(s.rubric, "final"), { groupWeight: 70, individualWeight: 30 });
    expect(report.blendChanged).toBe(true);
    expect(s2.grading.final).toEqual({ groupWeight: 70, individualWeight: 30 });
    // Group 4 is scored → keeps 60/40, so its grades do not move
    expect(s2.bundles["sess-g4-final"].session).toMatchObject({ group_weight: 60, individual_weight: 40 });
    expect(consolidate(s2.bundles["sess-g4-final"]).overallPercent).toBe(consolidate(s.bundles["sess-g4-final"]).overallPercent);

    const { state: s3 } = saveStageRubric(s, "proposal", activeRubric(s.rubric, "proposal"), { groupWeight: 50, individualWeight: 50 });
    expect(s3.bundles["sess-g7-proposal"].session).toMatchObject({ group_weight: 50, individual_weight: 50 });
  });

  it("rejects an invalid blend on save", () => {
    const s = state();
    expect(() => saveStageRubric(s, "final", activeRubric(s.rubric, "final"), { groupWeight: 80, individualWeight: 30 })).toThrow(/110%/);
  });

  it("stamps the stage blend on new sessions and on stage change", () => {
    const s = { ...state(), grading: { ...seedGrading(), title: { groupWeight: 80, individualWeight: 20 }, proposal: { groupWeight: 50, individualWeight: 50 } } };
    const { state: s2, sessionId } = scheduleSession(s, draft(), USERS);
    expect(s2.bundles[sessionId].session).toMatchObject({ group_weight: 80, individual_weight: 20 });
    const projectId = s2.bundles[sessionId].project.id;
    const s3 = updateScheduledSession(s2, draft({ sessionId, projectId, newProject: undefined, stage: "proposal" }), USERS);
    expect(s3.bundles[sessionId].session).toMatchObject({ group_weight: 50, individual_weight: 50 });
  });

  it("blocks scheduling when the stage blend is invalid", () => {
    const s = { ...state(), grading: { ...seedGrading(), title: { groupWeight: 90, individualWeight: 20 } } };
    expect(errors(s, draft()).join()).toMatch(/grade blend is not ready/);
  });
});
