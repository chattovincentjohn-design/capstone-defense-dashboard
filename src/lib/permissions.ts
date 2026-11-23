/**
 * Client-side mirror of the RLS policies. The UI uses these to decide what to
 * render; the database enforces the same rules authoritatively.
 */
import type { PanelAssignment, SessionBundle, User } from "./types";

export interface Viewer {
  user: User;
  assignment: PanelAssignment | null;
  isChair: boolean;
  isPanelist: boolean;
  isSecretary: boolean;
  isAdmin: boolean;
  isAdviser: boolean;
  isStudent: boolean;
}

export function resolveViewer(user: User, bundle: SessionBundle): Viewer {
  const assignment = bundle.assignments.find((a) => a.faculty_id === user.id) ?? null;
  return {
    user,
    assignment,
    isChair: assignment?.panel_role === "chair",
    isPanelist: !!assignment,
    isSecretary: bundle.session.secretary_id === user.id,
    isAdmin: user.role === "admin",
    isAdviser: bundle.project.adviser_id === user.id,
    isStudent: bundle.members.some((m) => m.user_id === user.id),
  };
}

export const allSubmitted = (b: SessionBundle) =>
  b.assignments.length > 0 && b.assignments.every((a) => a.has_submitted);

/** policy scores_read */
export function canSeeScoresOf(v: Viewer, target: PanelAssignment, b: SessionBundle) {
  if (v.assignment?.id === target.id) return true;
  if (b.session.is_locked && canViewSession(v)) return true;
  if (v.isChair && allSubmitted(b)) return true;
  if (v.isPanelist && v.assignment?.has_submitted && target.has_submitted) return true;
  return false;
}

export const canViewSession = (v: Viewer) =>
  v.isAdmin || v.isPanelist || v.isSecretary || v.isAdviser || v.isStudent;

export const canScore = (v: Viewer, b: SessionBundle) =>
  !!v.assignment && !v.assignment.has_submitted && !b.session.is_locked;

export const canComment = (v: Viewer, b: SessionBundle) => !!v.assignment && !b.session.is_locked;

export const canEditMinutes = (v: Viewer, b: SessionBundle) =>
  v.isSecretary && !b.session.is_locked && !b.minutes.chair_approved_at;

/** policy minutes_read */
export const canReadMinutes = (v: Viewer, b: SessionBundle) =>
  v.isAdmin || v.isSecretary || v.isPanelist || (b.session.is_locked && canViewSession(v));

export const canOpenDeliberation = (v: Viewer, b: SessionBundle) =>
  (v.isChair && allSubmitted(b)) || (b.session.is_locked && canViewSession(v));

export const canFinalize = (v: Viewer, b: SessionBundle) => v.isChair && allSubmitted(b) && !b.session.is_locked;

/** resolve_revision() RPC */
export const canResolveRevisions = (v: Viewer, b: SessionBundle) =>
  b.session.is_locked && (v.isAdmin || v.isAdviser || v.isStudent || v.isChair);

/** policy comments_read */
export const canSeeCommentsOf = (v: Viewer, target: PanelAssignment, b: SessionBundle) =>
  v.assignment?.id === target.id || v.isAdmin || v.isChair || v.isSecretary || (b.session.is_locked && canViewSession(v));
