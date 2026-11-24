/**
 * Supabase data access — one function per operation the demo store performs.
 * RLS decides what each call returns (e.g. blind grading hides other panelists' rows).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CapstoneProject, DefenseMinutes, DefenseSession, DefenseStage, StageBlend, PanelAssignment, PanelComment,
  ProjectMember, RubricCriterion, RubricScore, SessionBundle, Verdict,
} from "../types";

export async function fetchSessionBundle(sb: SupabaseClient, sessionId: string): Promise<SessionBundle> {
  const { data: raw, error } = await sb.from("defense_sessions").select("*").eq("id", sessionId).single<DefenseSession>();
  if (error) throw error;
  // numeric columns arrive as strings
  const session: DefenseSession = { ...raw, group_weight: Number(raw.group_weight), individual_weight: Number(raw.individual_weight) };

  const [project, members, assignments, criteria, scores, comments, minutes, scoring] = await Promise.all([
    sb.from("capstone_projects").select("*").eq("id", session.project_id).single<CapstoneProject>(),
    sb.from("project_members").select("*").eq("project_id", session.project_id).order("student_name"),
    sb.from("panel_assignments").select("*").eq("session_id", sessionId),
    sb.from("session_criteria").select("rubric_criteria(*)").eq("session_id", sessionId),   // frozen snapshot
    sb.from("rubric_scores").select("*").eq("session_id", sessionId),       // RLS-filtered
    sb.from("panel_comments").select("*").eq("session_id", sessionId).order("created_at"),
    sb.from("defense_minutes").select("*").eq("session_id", sessionId).maybeSingle<DefenseMinutes>(),
    sb.rpc("panel_scoring_status", { p_session: sessionId }),          // who has scored, not what
  ]);

  return {
    session,
    project: project.data as CapstoneProject,
    members: (members.data ?? []) as ProjectMember[],
    assignments: (assignments.data ?? []) as PanelAssignment[],
    criteria: (criteria.data ?? [])
      .filter((row) => (row as unknown as { rubric_criteria: RubricCriterion | null }).rubric_criteria)
      .map((row) => (row as unknown as { rubric_criteria: RubricCriterion }).rubric_criteria)
      .map((c) => ({ ...c, weight_percentage: Number(c.weight_percentage), max_score: Number(c.max_score) }))
      .sort((a, b) => a.sort_order - b.sort_order),
    scores: (scores.data ?? []).map((s) => ({ ...s, score: Number(s.score) })) as RubricScore[],
    comments: (comments.data ?? []) as PanelComment[],
    scored_assignment_ids: ((scoring.data ?? []) as { assignment_id: string; has_scores: boolean }[])
      .filter((r) => r.has_scores).map((r) => r.assignment_id),
    minutes: minutes.data
      ? { ...minutes.data, deliberation_notes: minutes.data.deliberation_notes ?? "" }
      : {
          id: "", session_id: sessionId, recorder_id: session.secretary_id ?? "", started_at: null, ended_at: null,
          attendance_json: [], qa_entries_json: [], deliberation_notes: "", chair_approved_at: null,
        },
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

/** Update the minutes row, or create it the first time. Returns the row id. */
export async function saveMinutes(sb: SupabaseClient, m: DefenseMinutes): Promise<string> {
  const { id, ...rest } = m;
  if (id) {
    const { error } = await sb.from("defense_minutes").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await sb.from("defense_minutes").insert(rest).select("id").single();
  if (error) throw error;
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Bulk loads for the signed-in user (RLS decides what comes back)
// ---------------------------------------------------------------------------
export async function listUsers(sb: SupabaseClient) {
  const { data, error } = await sb.from("users").select("id, full_name, email, role, department").order("full_name");
  if (error) throw error;
  return data as import("../types").User[];
}

export async function listAllCriteria(sb: SupabaseClient) {
  const { data, error } = await sb.from("rubric_criteria").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, weight_percentage: Number(c.weight_percentage), max_score: Number(c.max_score) })) as RubricCriterion[];
}

export async function listVisibleSessionIds(sb: SupabaseClient) {
  const { data, error } = await sb.from("defense_sessions").select("id").order("scheduled_at");
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
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
  members: { student_name: string; student_number: string; email?: string }[],
) {
  const { data, error } = await sb.from("capstone_projects").insert(p).select().single<CapstoneProject>();
  if (error) throw error;
  if (members.length) {
    const { error: e2 } = await sb.from("project_members").insert(members.map((m) => ({
      student_name: m.student_name, student_number: m.student_number, email: m.email || null, project_id: data.id,
    })));
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

export async function getStageBlends(sb: SupabaseClient): Promise<Record<DefenseStage, StageBlend>> {
  const { data, error } = await sb.from("stage_grading_config").select("*");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.stage, { groupWeight: Number(r.group_weight), individualWeight: Number(r.individual_weight) }])) as Record<DefenseStage, StageBlend>;
}

/** Update the stage template. Then call syncSessionRubric() for each unscored session of the stage. */
export async function setStageBlend(sb: SupabaseClient, stage: DefenseStage, blend: StageBlend) {
  const { error } = await sb.from("stage_grading_config")
    .update({ group_weight: blend.groupWeight, individual_weight: blend.individualWeight, updated_at: new Date().toISOString() })
    .eq("stage", stage);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Accounts (admin-only RPCs; see migrations/*_account_management.sql)
// ---------------------------------------------------------------------------
type AccountRow = import("../types").Account;

export async function listAccounts(sb: SupabaseClient): Promise<AccountRow[]> {
  const { data, error } = await sb.rpc("admin_list_accounts");
  if (error) throw error;
  return data as AccountRow[];
}

export async function createAccount(sb: SupabaseClient, input: import("../types").AccountInput) {
  const { data, error } = await sb.rpc("admin_create_account", {
    p_email: input.email, p_full_name: input.full_name, p_role: input.role, p_department: input.department,
  });
  if (error) throw error;
  const row = (data as { user_id: string; temp_password: string }[])[0];
  return { userId: row.user_id, tempPassword: row.temp_password };
}

export async function updateAccount(
  sb: SupabaseClient, id: string, patch: Partial<Pick<AccountRow, "full_name" | "role" | "department">>,
) {
  const { error } = await sb.from("users").update(patch).eq("id", id);
  if (error) throw error;
  // Keep a student's name in their group's member list in step with the account
  if (patch.full_name) {
    const { error: e2 } = await sb.from("project_members").update({ student_name: patch.full_name }).eq("user_id", id);
    if (e2) throw e2;
  }
}

export async function resetPassword(sb: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await sb.rpc("admin_reset_password", { p_user: id });
  if (error) throw error;
  return data as string;
}

export async function setAccountActive(sb: SupabaseClient, id: string, active: boolean) {
  const { error } = await sb.rpc("admin_set_account_active", { p_user: id, p_active: active });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Group members (proponents)
// ---------------------------------------------------------------------------
type MemberIn = import("../types").MemberInput;
const memberRow = (m: MemberIn) => ({
  student_name: m.student_name.trim(), student_number: m.student_number.trim(), email: m.email.trim().toLowerCase() || null,
});

export async function addMember(sb: SupabaseClient, projectId: string, m: MemberIn) {
  const { error } = await sb.from("project_members").insert({ ...memberRow(m), project_id: projectId });
  if (error) throw error;
}

export async function updateMember(sb: SupabaseClient, memberId: string, m: MemberIn) {
  const { error } = await sb.from("project_members").update(memberRow(m)).eq("id", memberId);
  if (error) throw error;
}

export async function removeMember(sb: SupabaseClient, memberId: string) {
  const { error } = await sb.from("project_members").delete().eq("id", memberId);
  if (error) throw error;
}

/** Creates (or links) the student's account; tempPassword is null when an existing account was linked. */
export async function createMemberAccount(sb: SupabaseClient, memberId: string) {
  const { data, error } = await sb.rpc("admin_create_member_account", { p_member: memberId });
  if (error) throw error;
  const row = (data as { user_id: string; temp_password: string | null; linked_existing: boolean }[])[0];
  return { userId: row.user_id, tempPassword: row.temp_password, linkedExisting: row.linked_existing };
}

// ---------------------------------------------------------------------------
// Group self-registration (see migrations/*_group_registration.sql)
// ---------------------------------------------------------------------------
type Reg = import("../types").GroupRegistration;

export async function registrationInfo(sb: SupabaseClient, code: string): Promise<import("../types").RegistrationFormInfo> {
  const { data, error } = await sb.rpc("registration_form_info", { p_code: code });
  if (error) throw error;
  return data as import("../types").RegistrationFormInfo;
}

export async function submitRegistration(sb: SupabaseClient, code: string, input: import("../types").RegistrationInput) {
  const { error } = await sb.rpc("submit_group_registration", { p_code: code, p_reg: input });
  if (error) throw error;
}

export async function listRegistrations(sb: SupabaseClient): Promise<Reg[]> {
  const { data, error } = await sb.from("group_registrations").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Reg[];
}

export async function getRegistrationSettings(sb: SupabaseClient): Promise<import("../types").RegistrationSettings> {
  const { data, error } = await sb.from("registration_settings").select("is_open, access_code").eq("id", 1).single();
  if (error) throw error;
  return data as import("../types").RegistrationSettings;
}

export async function saveRegistrationSettings(sb: SupabaseClient, s: import("../types").RegistrationSettings) {
  const { error } = await sb.from("registration_settings")
    .update({ is_open: s.is_open, access_code: s.access_code.trim(), updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

export async function setRegistrationStatus(sb: SupabaseClient, id: string, status: import("../types").RegistrationStatus) {
  const { error } = await sb.from("group_registrations").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteRegistration(sb: SupabaseClient, id: string) {
  const { error } = await sb.from("group_registrations").delete().eq("id", id);
  if (error) throw error;
}

export async function changeEmail(sb: SupabaseClient, id: string, email: string) {
  const { error } = await sb.rpc("admin_change_email", { p_user: id, p_email: email });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Faculty self sign-up (see migrations/*_faculty_signup.sql)
// ---------------------------------------------------------------------------
export async function facultySignupInfo(sb: SupabaseClient, code: string): Promise<{ open: boolean; valid: boolean }> {
  const { data, error } = await sb.rpc("faculty_signup_info", { p_code: code });
  if (error) throw error;
  return data as { open: boolean; valid: boolean };
}

export async function facultySignup(sb: SupabaseClient, code: string, f: import("../types").FacultySignupInput) {
  const { error } = await sb.rpc("faculty_signup", {
    p_code: code, p_full_name: f.full_name, p_email: f.email, p_password: f.password, p_role: f.role, p_department: f.department,
  });
  if (error) throw error;
}

export async function getFacultySignupSettings(sb: SupabaseClient): Promise<import("../types").AccessSettings> {
  const { data, error } = await sb.from("registration_settings").select("faculty_open, faculty_code").eq("id", 1).single();
  if (error) throw error;
  return { is_open: data.faculty_open, access_code: data.faculty_code };
}

export async function saveFacultySignupSettings(sb: SupabaseClient, s: import("../types").AccessSettings) {
  const { error } = await sb.from("registration_settings")
    .update({ faculty_open: s.is_open, faculty_code: s.access_code.trim(), updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

export async function deleteAccount(sb: SupabaseClient, id: string) {
  const { error } = await sb.rpc("admin_delete_account", { p_user: id });
  if (error) throw error;
}
