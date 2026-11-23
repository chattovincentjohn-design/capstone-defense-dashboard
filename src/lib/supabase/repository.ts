/**
 * Supabase data access — one function per operation the demo store performs.
 * RLS decides what each call returns (e.g. blind grading hides other panelists' rows).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CapstoneProject, DefenseMinutes, DefenseSession, PanelAssignment, PanelComment,
  ProjectMember, RubricCriterion, RubricScore, SessionBundle, Verdict,
} from "../types";

export async function fetchSessionBundle(sb: SupabaseClient, sessionId: string): Promise<SessionBundle> {
  const { data: session, error } = await sb.from("defense_sessions").select("*").eq("id", sessionId).single<DefenseSession>();
  if (error) throw error;

  const [project, members, assignments, criteria, scores, comments, minutes] = await Promise.all([
    sb.from("capstone_projects").select("*").eq("id", session.project_id).single<CapstoneProject>(),
    sb.from("project_members").select("*").eq("project_id", session.project_id).order("student_name"),
    sb.from("panel_assignments").select("*").eq("session_id", sessionId),
    sb.from("session_criteria").select("rubric_criteria(*)").eq("session_id", sessionId),   // frozen snapshot
    sb.from("rubric_scores").select("*").eq("session_id", sessionId),       // RLS-filtered
    sb.from("panel_comments").select("*").eq("session_id", sessionId).order("created_at"),
    sb.from("defense_minutes").select("*").eq("session_id", sessionId).maybeSingle<DefenseMinutes>(),
  ]);

  return {
    session,
    project: project.data as CapstoneProject,
    members: (members.data ?? []) as ProjectMember[],
    assignments: (assignments.data ?? []) as PanelAssignment[],
    criteria: (criteria.data ?? [])
      .map((row) => (row as unknown as { rubric_criteria: RubricCriterion }).rubric_criteria)
      .map((c) => ({ ...c, weight_percentage: Number(c.weight_percentage), max_score: Number(c.max_score) }))
      .sort((a, b) => a.sort_order - b.sort_order),
    scores: (scores.data ?? []).map((s) => ({ ...s, score: Number(s.score) })) as RubricScore[],
    comments: (comments.data ?? []) as PanelComment[],
    minutes: (minutes.data ?? {
      id: "", session_id: sessionId, recorder_id: session.secretary_id ?? "", started_at: null, ended_at: null,
      attendance_json: [], qa_entries_json: [], deliberation_notes: "", chair_approved_at: null,
    }) as DefenseMinutes,
  };
}

export async function upsertScore(sb: SupabaseClient, row: Omit<RubricScore, "id">) {
  const { error } = await sb.from("rubric_scores").upsert(row, { onConflict: "panel_assignment_id,criterion_id,student_id" });
  if (error) throw error;
}

export async function submitEvaluation(sb: SupabaseClient, sessionId: string) {
  const { data, error } = await sb.rpc("submit_evaluation", { p_session: sessionId });
  if (error) throw error;
  return data as PanelAssignment;
}

export async function finalizeDefense(sb: SupabaseClient, sessionId: string, verdict: Verdict) {
  const { data, error } = await sb.rpc("finalize_defense", { p_session: sessionId, p_verdict: verdict });
  if (error) throw error;
  return data as DefenseSession;
}

export async function addComment(sb: SupabaseClient, c: Pick<PanelComment, "session_id" | "panel_assignment_id" | "category" | "severity" | "comment_text">) {
  const { data, error } = await sb.from("panel_comments").insert(c).select().single();
  if (error) throw error;
  return data as PanelComment;
}

export async function deleteComment(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("panel_comments").delete().eq("id", id);
  if (error) throw error;
}

export async function resolveRevision(sb: SupabaseClient, id: string, resolved: boolean, note: string, reference: string) {
  const { data, error } = await sb.rpc("resolve_revision", { p_comment: id, p_resolved: resolved, p_note: note, p_reference: reference });
  if (error) throw error;
  return data as PanelComment;
}

export async function saveMinutes(sb: SupabaseClient, m: DefenseMinutes) {
  const { id, ...rest } = m;
  const q = id ? sb.from("defense_minutes").update(rest).eq("id", id) : sb.from("defense_minutes").insert(rest);
  const { error } = await q;
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Admin / Capstone Coordinator
// ---------------------------------------------------------------------------
export interface ScheduleInput {
  project_id: string;
  stage: DefenseSession["stage"];
  scheduled_at: string;
  room_or_link: string;
  secretary_id: string | null;
  chair_id: string;
  member_ids: string[];
}

export async function createProject(
  sb: SupabaseClient,
  p: Omit<CapstoneProject, "id">,
  members: Pick<ProjectMember, "student_name" | "student_number">[],
) {
  const { data, error } = await sb.from("capstone_projects").insert(p).select().single<CapstoneProject>();
  if (error) throw error;
  if (members.length) {
    const { error: e2 } = await sb.from("project_members").insert(members.map((m) => ({ ...m, project_id: data.id })));
    if (e2) throw e2;
  }
  return data;
}

/** Inserting the session triggers the rubric snapshot (session_criteria). */
export async function scheduleSession(sb: SupabaseClient, input: ScheduleInput) {
  const { chair_id, member_ids, ...session } = input;
  const { data, error } = await sb.from("defense_sessions").insert(session).select().single<DefenseSession>();
  if (error) throw error;
  const rows = [
    { session_id: data.id, faculty_id: chair_id, panel_role: "chair" },
    ...member_ids.map((id) => ({ session_id: data.id, faculty_id: id, panel_role: "member" })),
  ];
  const { error: e2 } = await sb.from("panel_assignments").insert(rows);
  if (e2) { await sb.from("defense_sessions").delete().eq("id", data.id); throw e2; }
  return data;
}

export async function updateSession(
  sb: SupabaseClient, id: string,
  patch: Partial<Pick<DefenseSession, "stage" | "scheduled_at" | "room_or_link" | "secretary_id">>,
) {
  const { error } = await sb.from("defense_sessions").update(patch).eq("id", id);
  if (error) throw error;
}

/** Replace unscored panel seats; the DB refuses to touch panelists who already scored. */
export async function setPanel(sb: SupabaseClient, sessionId: string, chairId: string, memberIds: string[]) {
  const { data: current, error } = await sb.from("panel_assignments").select("*").eq("session_id", sessionId);
  if (error) throw error;
  const want = new Map<string, "chair" | "member">([[chairId, "chair"], ...memberIds.map((m) => [m, "member"] as [string, "member"])]);
  const keep = (current as PanelAssignment[]).filter((a) => want.get(a.faculty_id) === a.panel_role);
  const drop = (current as PanelAssignment[]).filter((a) => !keep.includes(a));
  if (drop.length) {
    const { error: e } = await sb.from("panel_assignments").delete().in("id", drop.map((a) => a.id));
    if (e) throw e;
  }
  const add = [...want].filter(([fid]) => !keep.some((a) => a.faculty_id === fid))
    .map(([faculty_id, panel_role]) => ({ session_id: sessionId, faculty_id, panel_role }));
  if (add.length) {
    const { error: e } = await sb.from("panel_assignments").insert(add);
    if (e) throw e;
  }
}

export async function deleteSession(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("defense_sessions").delete().eq("id", id);
  if (error) throw error;
}

export async function listRubric(sb: SupabaseClient, stage: DefenseSession["stage"]) {
  const { data, error } = await sb.from("rubric_criteria").select("*").eq("stage", stage).eq("is_active", true).order("sort_order");
  if (error) throw error;
  return data as RubricCriterion[];
}

export async function addCriterion(sb: SupabaseClient, c: Omit<RubricCriterion, "id">) {
  const { data, error } = await sb.from("rubric_criteria").insert(c).select().single();
  if (error) throw error;
  return data as RubricCriterion;
}

/** Copy-on-write when the criterion is already used by a session. */
export async function reviseCriterion(sb: SupabaseClient, c: RubricCriterion) {
  const { data, error } = await sb.rpc("revise_criterion", {
    p_id: c.id, p_name: c.criterion_name, p_description: c.description,
    p_weight: c.weight_percentage, p_max: c.max_score, p_sort: c.sort_order,
  });
  if (error) throw error;
  return data as RubricCriterion;
}

export async function retireCriterion(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("rubric_criteria").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function syncSessionRubric(sb: SupabaseClient, sessionId: string) {
  const { data, error } = await sb.rpc("sync_session_rubric", { p_session: sessionId });
  if (error) throw error;
  return data as number;
}
