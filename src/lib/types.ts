// Domain types — mirror supabase/migrations/*_capstone_defense.sql 1:1.

export type UserRole = "superadmin" | "admin" | "chair" | "panelist" | "secretary" | "adviser" | "student";
export type DefenseStage = "title" | "proposal" | "final";
export type Verdict = "passed" | "passed_minor_revisions" | "passed_major_revisions" | "re_defense";
export type PanelRole = "chair" | "member";
export type RubricScope = "group" | "individual";
export type CommentCategory = "documentation" | "system_ui" | "database_architecture" | "methodology";
export type CommentSeverity = "mandatory" | "suggestion";

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  department: string | null;
}

/** A sign-in account as the Coordinator sees it. */
export interface Account extends User {
  is_active: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
}

export interface AccountInput {
  email: string;
  full_name: string;
  role: UserRole;
  department: string;
}

export interface MemberInput {
  student_name: string;
  student_number: string;
  email: string;
}

export interface CapstoneProject {
  id: string;
  title: string;
  group_label: string; // UI convenience, e.g. "Group 4"
  abstract: string | null;
  manuscript_url: string | null;
  demo_url: string | null;
  adviser_id: string | null;
  academic_year: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  student_name: string;
  student_number: string;
  user_id?: string | null;
  /** Used to create and link the student's sign-in account. */
  email?: string | null;
}

export interface DefenseSession {
  id: string;
  project_id: string;
  stage: DefenseStage;
  scheduled_at: string;
  room_or_link: string | null;
  secretary_id: string | null;
  verdict: Verdict | null;
  is_locked: boolean;
  locked_at: string | null;
  chair_signature_hash: string | null;
  /** Final-grade blend frozen at scheduling time (sums to 100). Missing on legacy rows → 60/40. */
  group_weight: number;
  individual_weight: number;
}

/** Per-stage template for the group/individual final-grade blend. */
export interface StageBlend {
  groupWeight: number;
  individualWeight: number;
}

export interface PanelAssignment {
  id: string;
  session_id: string;
  faculty_id: string;
  panel_role: PanelRole;
  has_submitted: boolean;
  signature_hash: string | null;
  submitted_at: string | null;
}

export interface RubricCriterion {
  id: string;
  stage: DefenseStage;
  scope: RubricScope;
  criterion_name: string;
  description: string | null;
  weight_percentage: number;
  max_score: number;
  sort_order: number;
  is_active?: boolean; // templates only; session snapshots omit it
}

export interface RubricScore {
  id: string;
  session_id: string;
  panel_assignment_id: string;
  student_id: string | null; // null ⇒ group criterion
  criterion_id: string;
  score: number;
}

export interface PanelComment {
  id: string;
  session_id: string;
  panel_assignment_id: string;
  category: CommentCategory;
  severity: CommentSeverity;
  comment_text: string;
  is_resolved: boolean;
  resolution_note: string | null;
  resolution_reference: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AttendanceEntry {
  id: string;
  name: string;
  role: string;
  present: boolean;
}

export interface QAEntry {
  id: string;
  timestamp: string;
  panelist_id: string;
  question: string;
  response: string;
  action_required: string;
}

export interface DefenseMinutes {
  id: string;
  session_id: string;
  recorder_id: string;
  started_at: string | null;
  ended_at: string | null;
  attendance_json: AttendanceEntry[];
  qa_entries_json: QAEntry[];
  deliberation_notes: string;
  chair_approved_at: string | null;
}

/** Everything the workspace needs for one defense session. */
export interface SessionBundle {
  session: DefenseSession;
  project: CapstoneProject;
  members: ProjectMember[];
  assignments: PanelAssignment[];
  criteria: RubricCriterion[];
  scores: RubricScore[];
  comments: PanelComment[];
  minutes: DefenseMinutes;
  /**
   * Seats that have entered at least one score. Blind grading can hide other people's
   * in-progress scores, so live mode loads this flag separately (never the scores).
   */
  scored_assignment_ids?: string[];
}

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------
export const STAGE_LABEL: Record<DefenseStage, string> = {
  title: "Title Defense",
  proposal: "Proposal Defense",
  final: "Final Defense",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  passed: "Passed",
  passed_minor_revisions: "Passed with Minor Revisions",
  passed_major_revisions: "Passed with Major Revisions",
  re_defense: "Re-defense",
};

export const CATEGORY_LABEL: Record<CommentCategory, string> = {
  documentation: "Documentation",
  system_ui: "System/UI",
  database_architecture: "Database/Architecture",
  methodology: "Methodology",
};

export const SEVERITY_LABEL: Record<CommentSeverity, string> = {
  mandatory: "Mandatory Revision",
  suggestion: "Suggestion",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: "Super Admin",
  admin: "Capstone Coordinator",
  chair: "Defense Chair",
  panelist: "Panel Member",
  secretary: "Defense Secretary",
  adviser: "Adviser",
  student: "Proponent",
};
