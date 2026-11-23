/**
 * Coordinator (admin) operations as pure state transforms. These mirror the SQL in
 * migrations/20261124000000_admin_scheduling_rubric.sql:
 *  - scheduling snapshots the active rubric into the session
 *  - criteria in use by any session are copy-on-write (retire + new version)
 *  - template changes re-sync only sessions that nobody has scored yet
 */
import { consolidate, DEFAULT_GRADING_CONFIG } from "./grading";
import type { State } from "./store";
import type {
  CapstoneProject, DefenseMinutes, DefenseStage, PanelAssignment, ProjectMember, RubricCriterion,
  RubricScope, SessionBundle, StageBlend, User,
} from "./types";
import { STAGE_LABEL, VERDICT_LABEL } from "./types";
import { uid } from "./utils";

/** Assumed slot length used for double-booking checks. */
export const DEFENSE_SLOT_MINUTES = 120;
export const FACULTY_ROLES: User["role"][] = ["chair", "panelist", "adviser", "admin"];

// ---------------------------------------------------------------------------
// Time helpers — schedules are entered and shown in campus time (UTC+8, no DST)
// ---------------------------------------------------------------------------
export function toManilaInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}
export function fromManilaInput(local: string): string {
  return new Date(`${local}:00+08:00`).toISOString();
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------
export function activeRubric(rubric: RubricCriterion[], stage: DefenseStage) {
  return rubric.filter((c) => c.stage === stage && c.is_active !== false).sort((a, b) => a.sort_order - b.sort_order);
}

export function weightTotals(criteria: RubricCriterion[]) {
  const sum = (scope: RubricScope) => {
    const xs = criteria.filter((c) => c.scope === scope);
    return { total: Math.round(xs.reduce((a, c) => a + Number(c.weight_percentage), 0) * 100) / 100, count: xs.length };
  };
  return { group: sum("group"), individual: sum("individual") };
}

export function rubricProblems(criteria: RubricCriterion[]): string[] {
  const p: string[] = [];
  const t = weightTotals(criteria);
  if (t.group.count === 0) p.push("At least one group criterion is required.");
  if (t.group.count && t.group.total !== 100) p.push(`Group weights total ${t.group.total}%, must be 100%.`);
  if (t.individual.count && t.individual.total !== 100) p.push(`Individual weights total ${t.individual.total}%, must be 100%.`);
  for (const c of criteria) {
    if (!c.criterion_name.trim()) p.push("Every criterion needs a name.");
    if (!(c.weight_percentage > 0 && c.weight_percentage <= 100)) p.push(`"${c.criterion_name || "Untitled"}": weight must be between 0 and 100.`);
    if (!(c.max_score > 0)) p.push(`"${c.criterion_name || "Untitled"}": max score must be positive.`);
  }
  return [...new Set(p)];
}

/** Sessions that would pick up template changes: unlocked and nobody has scored. */
export const isRubricSyncable = (b: SessionBundle) => !b.session.is_locked && b.scores.length === 0;

/** Frozen = referenced by a session whose grades depend on it (scored or locked). Mirrors criterion_is_frozen() in SQL. */
export const isCriterionInUse = (id: string, bundles: SessionBundle[]) =>
  bundles.some((b) => !isRubricSyncable(b) && b.criteria.some((c) => c.id === id));

const snapshot = (rubric: RubricCriterion[], stage: DefenseStage) =>
  activeRubric(rubric, stage).map((c) => {
    const copy = { ...c };
    delete copy.is_active;
    return copy;
  });

// ---------------------------------------------------------------------------
// Final-grade blend (group vs individual), per stage
// ---------------------------------------------------------------------------
export function blendFor(state: Pick<State, "grading">, stage: DefenseStage): StageBlend {
  return state.grading?.[stage] ?? { groupWeight: DEFAULT_GRADING_CONFIG.groupWeight, individualWeight: DEFAULT_GRADING_CONFIG.individualWeight };
}

export function blendProblems(b: StageBlend): string[] {
  const p: string[] = [];
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  if (!ok(b.groupWeight) || !ok(b.individualWeight)) p.push("Group and individual shares must each be between 0% and 100%.");
  else if (Math.round((b.groupWeight + b.individualWeight) * 100) / 100 !== 100) p.push(`Group + individual shares total ${b.groupWeight + b.individualWeight}%, must be 100%.`);
  if (b.groupWeight === 0 && b.individualWeight === 0) p.push("At least one share must be above 0%.");
  return p;
}

export const sessionUsesBlend = (a: StageBlend, s: SessionBundle["session"]) =>
  a.groupWeight === s.group_weight && a.individualWeight === s.individual_weight;

export interface RubricSaveReport {
  updated: number;
  versioned: number;   // in-use criteria retired and re-created
  added: number;
  retired: number;
  synced: string[];    // session ids that received the new rubric
  frozen: string[];    // session ids that keep their snapshot
  blendChanged: boolean;
}

/**
 * Save the full set of criteria for one stage. Drafts whose id starts with "new-" are inserted.
 * Throws if the resulting rubric is invalid.
 */
export function saveStageRubric(
  state: State, stage: DefenseStage, drafts: RubricCriterion[], blend: StageBlend = blendFor(state, stage),
): { state: State; report: RubricSaveReport } {
  const problems = [...blendProblems(blend), ...rubricProblems(drafts)];
  if (problems.length) throw new Error(problems.join(" "));

  const bundles = Object.values(state.bundles);
  const current = activeRubric(state.rubric, stage);
  const prevBlend = blendFor(state, stage);
  const report: RubricSaveReport = {
    updated: 0, versioned: 0, added: 0, retired: 0, synced: [], frozen: [],
    blendChanged: prevBlend.groupWeight !== blend.groupWeight || prevBlend.individualWeight !== blend.individualWeight,
  };
  let rubric = [...state.rubric];
  // In-place edits of description/sort_order are visible in snapshots too (same row in SQL).
  const cosmetic = new Map<string, Pick<RubricCriterion, "description" | "sort_order">>();

  for (const d of drafts) {
    if (d.id.startsWith("new-")) {
      rubric.push({ ...d, id: uid("c"), stage, is_active: true });
      report.added++;
      continue;
    }
    const old = current.find((c) => c.id === d.id);
    if (!old) continue;
    const core = old.criterion_name !== d.criterion_name || old.weight_percentage !== d.weight_percentage || old.max_score !== d.max_score;
    const meta = old.description !== d.description || old.sort_order !== d.sort_order;
    if (!core && !meta) continue;
    if (core && isCriterionInUse(old.id, bundles)) {
      rubric = rubric.map((c) => (c.id === old.id ? { ...c, is_active: false } : c));
      rubric.push({ ...d, id: uid("c"), stage, scope: old.scope, is_active: true });
      report.versioned++;
    } else {
      rubric = rubric.map((c) => (c.id === old.id ? { ...d, stage, scope: old.scope, is_active: true } : c));
      if (!core) cosmetic.set(old.id, { description: d.description, sort_order: d.sort_order });
      report.updated++;
    }
  }
  for (const old of current) {
    if (drafts.some((d) => d.id === old.id)) continue;
    rubric = isCriterionInUse(old.id, bundles)
      ? rubric.map((c) => (c.id === old.id ? { ...c, is_active: false } : c))
      : rubric.filter((c) => c.id !== old.id);
    report.retired++;
  }

  const nextBundles: Record<string, SessionBundle> = {};
  for (const [id, b] of Object.entries(state.bundles)) {
    if (b.session.stage !== stage) { nextBundles[id] = b; continue; }
    if (isRubricSyncable(b)) {
      nextBundles[id] = {
        ...b,
        session: { ...b.session, group_weight: blend.groupWeight, individual_weight: blend.individualWeight },
        criteria: snapshot(rubric, stage),
      };
      report.synced.push(id);
    } else {
      nextBundles[id] = { ...b, criteria: b.criteria.map((c) => (cosmetic.has(c.id) ? { ...c, ...cosmetic.get(c.id)! } : c)) };
      report.frozen.push(id);
    }
  }
  return { state: { ...state, rubric, grading: { ...state.grading, [stage]: blend }, bundles: nextBundles }, report };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
export interface NewProjectInput {
  title: string;
  group_label: string;
  adviser_id: string | null;
  academic_year: string;
  manuscript_url: string;
  demo_url: string;
  abstract: string;
  members: { student_name: string; student_number: string }[];
}

export interface ScheduleDraft {
  sessionId?: string;            // set when editing
  projectId: string | "new";
  newProject?: NewProjectInput;
  stage: DefenseStage;
  scheduledAt: string;           // ISO
  room: string;
  secretaryId: string | null;
  chairId: string;
  memberIds: string[];
}

export interface Issue { level: "error" | "warning"; message: string }

export function listProjects(state: State) {
  const map = new Map<string, { project: CapstoneProject; members: ProjectMember[] }>();
  for (const id of state.order) {
    const b = state.bundles[id];
    if (b && !map.has(b.project.id)) map.set(b.project.id, { project: b.project, members: b.members });
  }
  return [...map.values()];
}

/** Parse "Name, 2022-00001" lines. */
export function parseMembers(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, num = ""] = l.split(/\s*[,;\t]\s*/);
    return { student_name: name ?? "", student_number: num };
  });
}

const overlaps = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < DEFENSE_SLOT_MINUTES * 60_000;

export function validateSchedule(draft: ScheduleDraft, state: State, users: User[], now = new Date()): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });
  const name = (id: string) => users.find((u) => u.id === id)?.full_name ?? id;
  const others = Object.values(state.bundles).filter((b) => b.session.id !== draft.sessionId);
  const editing = draft.sessionId ? state.bundles[draft.sessionId] : undefined;

  // project
  let adviserId: string | null = null;
  let projectId = draft.projectId;
  if (draft.projectId === "new") {
    const p = draft.newProject;
    if (!p?.title.trim()) err("Project title is required.");
    if (!p?.group_label.trim()) err("Group label is required.");
    if (!p?.academic_year.trim()) err("Academic year is required.");
    if (!p || p.members.length === 0) err("Add at least one proponent.");
    const nums = (p?.members ?? []).map((m) => m.student_number);
    if (p?.members.some((m) => !m.student_name || !m.student_number)) err('Each proponent line needs "Name, Student No."');
    if (new Set(nums).size !== nums.length) err("Duplicate student numbers.");
    adviserId = p?.adviser_id ?? null;
    projectId = "";
  } else {
    const proj = listProjects(state).find((x) => x.project.id === draft.projectId);
    if (!proj) err("Select a project.");
    adviserId = proj?.project.adviser_id ?? null;
  }

  // when
  if (!draft.scheduledAt || Number.isNaN(new Date(draft.scheduledAt).getTime())) err("Date and time are required.");
  else if (new Date(draft.scheduledAt) < now && !editing) warn("Scheduled time is in the past.");
  if (!draft.room.trim()) err("Room or meeting link is required.");

  // panel
  if (!draft.chairId) err("Assign a Defense Chair.");
  if (draft.memberIds.length === 0) err("Assign at least one panel member.");
  if (draft.memberIds.includes(draft.chairId)) err("The Chair cannot also be listed as a panel member.");
  if (new Set(draft.memberIds).size !== draft.memberIds.length) err("A panel member is listed twice.");
  const panel = [draft.chairId, ...draft.memberIds].filter(Boolean);
  if (draft.secretaryId && panel.includes(draft.secretaryId)) err("The Secretary cannot sit on the panel.");
  if (adviserId && panel.includes(adviserId)) err(`${name(adviserId)} is the project adviser and cannot evaluate it.`);
  if (panel.length < 3) warn("Panels usually have at least 3 evaluators (Chair + 2 members).");

  // duplicate defense for same project/stage
  if (projectId) {
    const dup = others.find((b) => b.project.id === projectId && b.session.stage === draft.stage);
    if (dup && !dup.session.is_locked) err(`This project already has an open ${STAGE_LABEL[draft.stage]} on the schedule.`);
    else if (dup && dup.session.verdict !== "re_defense") warn(`This project already completed its ${STAGE_LABEL[draft.stage]} (${VERDICT_LABEL[dup.session.verdict!]}).`);
  }

  // conflicts with other sessions
  if (draft.scheduledAt) {
    for (const b of others.filter((o) => !o.session.is_locked && overlaps(o.session.scheduled_at, draft.scheduledAt))) {
      const label = `${b.project.group_label} (${new Date(b.session.scheduled_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" })})`;
      const busy = [...panel, draft.secretaryId].filter((id): id is string =>
        !!id && (b.assignments.some((a) => a.faculty_id === id) || b.session.secretary_id === id));
      busy.forEach((id) => warn(`${name(id)} is also booked for ${label}.`));
      if (b.session.room_or_link && b.session.room_or_link.trim().toLowerCase() === draft.room.trim().toLowerCase()) {
        warn(`Room "${draft.room}" is already booked for ${label}.`);
      }
    }
  }

  // rubric
  if (!editing || isRubricSyncable(editing)) {
    const problems = rubricProblems(activeRubric(state.rubric, draft.stage));
    if (problems.length) err(`The ${STAGE_LABEL[draft.stage]} rubric is not ready: ${problems[0]}`);
    const bp = blendProblems(blendFor(state, draft.stage));
    if (bp.length) err(`The ${STAGE_LABEL[draft.stage]} grade blend is not ready: ${bp[0]}`);
  }

  // edits that would discard recorded work
  if (editing) {
    if (editing.session.is_locked) err("Locked sessions cannot be edited.");
    if (draft.stage !== editing.session.stage && editing.scores.length) err("Stage cannot change after scoring has started.");
    for (const a of editing.assignments) {
      const keptAs = a.faculty_id === draft.chairId ? "chair" : draft.memberIds.includes(a.faculty_id) ? "member" : null;
      if (keptAs !== a.panel_role && editing.scores.some((s) => s.panel_assignment_id === a.id)) {
        err(`${name(a.faculty_id)} has already entered scores and must stay on the panel as ${a.panel_role}.`);
      }
    }
  }
  return issues;
}

export function buildAttendance(panel: { id: string; role: string }[], adviserId: string | null, members: ProjectMember[], users: User[]) {
  const n = (id: string) => users.find((u) => u.id === id)?.full_name ?? id;
  return [
    ...panel.map((p) => ({ id: uid("at"), name: n(p.id), role: p.role, present: true })),
    ...(adviserId ? [{ id: uid("at"), name: n(adviserId), role: "Adviser", present: true }] : []),
    ...members.map((m) => ({ id: uid("at"), name: m.student_name, role: "Proponent", present: true })),
  ];
}

function buildAssignments(sessionId: string, chairId: string, memberIds: string[], keep: PanelAssignment[] = []): PanelAssignment[] {
  const want: [string, PanelAssignment["panel_role"]][] = [[chairId, "chair"], ...memberIds.map((m) => [m, "member"] as [string, "member"])];
  return want.map(([faculty_id, panel_role]) =>
    keep.find((a) => a.faculty_id === faculty_id && a.panel_role === panel_role) ??
    { id: uid("pa"), session_id: sessionId, faculty_id, panel_role, has_submitted: false, signature_hash: null, submitted_at: null });
}

export function scheduleSession(state: State, draft: ScheduleDraft, users: User[]): { state: State; sessionId: string } {
  const blocking = validateSchedule(draft, state, users).filter((i) => i.level === "error");
  if (blocking.length) throw new Error(blocking.map((i) => i.message).join(" "));

  let project: CapstoneProject;
  let members: ProjectMember[];
  if (draft.projectId === "new") {
    const p = draft.newProject!;
    const projectId = uid("p");
    project = {
      id: projectId, title: p.title.trim(), group_label: p.group_label.trim(), abstract: p.abstract.trim() || null,
      manuscript_url: p.manuscript_url.trim() || null, demo_url: p.demo_url.trim() || null,
      adviser_id: p.adviser_id, academic_year: p.academic_year.trim(),
    };
    members = p.members.map((m) => ({ id: uid("m"), project_id: projectId, ...m }));
  } else {
    const found = listProjects(state).find((x) => x.project.id === draft.projectId)!;
    project = found.project;
    members = found.members;
  }

  const sessionId = uid("sess");
  const assignments = buildAssignments(sessionId, draft.chairId, draft.memberIds);
  const minutes: DefenseMinutes = {
    id: uid("min"), session_id: sessionId, recorder_id: draft.secretaryId ?? "", started_at: null, ended_at: null,
    attendance_json: buildAttendance(assignments.map((a) => ({ id: a.faculty_id, role: a.panel_role === "chair" ? "Chair" : "Panel Member" })), project.adviser_id, members, users),
    qa_entries_json: [], deliberation_notes: "", chair_approved_at: null,
  };
  const bundle: SessionBundle = {
    session: {
      id: sessionId, project_id: project.id, stage: draft.stage, scheduled_at: draft.scheduledAt,
      group_weight: blendFor(state, draft.stage).groupWeight, individual_weight: blendFor(state, draft.stage).individualWeight,
      room_or_link: draft.room.trim(), secretary_id: draft.secretaryId, verdict: null, is_locked: false,
      locked_at: null, chair_signature_hash: null,
    },
    project, members, assignments, criteria: snapshot(state.rubric, draft.stage), scores: [], comments: [], minutes,
  };
  const bundles = { ...state.bundles, [sessionId]: bundle };
  const order = sortedOrder(bundles);
  return { state: { ...state, bundles, order }, sessionId };
}

export function updateScheduledSession(state: State, draft: ScheduleDraft, users: User[]): State {
  const b = draft.sessionId ? state.bundles[draft.sessionId] : undefined;
  if (!b) throw new Error("Session not found.");
  const blocking = validateSchedule(draft, state, users).filter((i) => i.level === "error");
  if (blocking.length) throw new Error(blocking.map((i) => i.message).join(" "));

  const assignments = buildAssignments(b.session.id, draft.chairId, draft.memberIds, b.assignments);
  const keptIds = new Set(assignments.map((a) => a.id));
  const stageChanged = draft.stage !== b.session.stage;
  const minutes = b.minutes.started_at ? b.minutes : {
    ...b.minutes,
    recorder_id: draft.secretaryId ?? "",
    attendance_json: buildAttendance(assignments.map((a) => ({ id: a.faculty_id, role: a.panel_role === "chair" ? "Chair" : "Panel Member" })), b.project.adviser_id, b.members, users),
  };
  const next: SessionBundle = {
    ...b,
    session: {
      ...b.session, stage: draft.stage, scheduled_at: draft.scheduledAt, room_or_link: draft.room.trim(), secretary_id: draft.secretaryId,
      ...(stageChanged && { group_weight: blendFor(state, draft.stage).groupWeight, individual_weight: blendFor(state, draft.stage).individualWeight }),
    },
    assignments,
    criteria: stageChanged ? snapshot(state.rubric, draft.stage) : b.criteria,
    comments: b.comments.filter((c) => keptIds.has(c.panel_assignment_id)),
    minutes,
  };
  const bundles = { ...state.bundles, [b.session.id]: next };
  return { ...state, bundles, order: sortedOrder(bundles) };
}

export function deleteScheduledSession(state: State, sessionId: string): State {
  const b = state.bundles[sessionId];
  if (!b) return state;
  if (b.scores.length) throw new Error("Cannot delete a session with recorded scores.");
  const bundles = { ...state.bundles };
  delete bundles[sessionId];
  return { ...state, bundles, order: state.order.filter((id) => id !== sessionId) };
}

function sortedOrder(bundles: Record<string, SessionBundle>) {
  return Object.values(bundles)
    .sort((a, b) => a.session.scheduled_at.localeCompare(b.session.scheduled_at))
    .map((b) => b.session.id);
}

// ---------------------------------------------------------------------------
// Consolidated grade export
// ---------------------------------------------------------------------------
const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function gradesCsv(bundles: SessionBundle[], users: User[]): string {
  const header = ["Academic Year", "Stage", "Group", "Project Title", "Adviser", "Student No.", "Student Name",
    "Group %", "Individual %", "Final %", "Grade", "Remark", "Verdict", "Locked At (UTC)"];
  const rows: (string | number | null)[][] = [];
  for (const b of bundles.filter((x) => x.session.is_locked)) {
    const c = consolidate(b);
    for (const s of c.students) {
      rows.push([
        b.project.academic_year, STAGE_LABEL[b.session.stage], b.project.group_label, b.project.title,
        users.find((u) => u.id === b.project.adviser_id)?.full_name ?? "",
        s.member.student_number, s.member.student_name, c.groupPercent.toFixed(2), s.individualPercent.toFixed(2),
        s.finalPercent.toFixed(2), s.transmuted.toFixed(2), s.remark,
        b.session.verdict ? VERDICT_LABEL[b.session.verdict] : "", b.session.locked_at,
      ]);
    }
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
