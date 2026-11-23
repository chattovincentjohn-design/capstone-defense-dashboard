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
    sb.from("rubric_criteria").select("*").eq("stage", session.stage).eq("is_active", true).order("sort_order"),
    sb.from("rubric_scores").select("*").eq("session_id", sessionId),       // RLS-filtered
    sb.from("panel_comments").select("*").eq("session_id", sessionId).order("created_at"),
    sb.from("defense_minutes").select("*").eq("session_id", sessionId).maybeSingle<DefenseMinutes>(),
  ]);

  return {
    session,
    project: project.data as CapstoneProject,
    members: (members.data ?? []) as ProjectMember[],
    assignments: (assignments.data ?? []) as PanelAssignment[],
    criteria: (criteria.data ?? []).map((c) => ({ ...c, weight_percentage: Number(c.weight_percentage), max_score: Number(c.max_score) })) as RubricCriterion[],
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
