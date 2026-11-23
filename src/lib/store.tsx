"use client";
/**
 * App data store with two interchangeable backends behind one interface:
 *  - Demo (no env vars): in-browser state persisted to localStorage, synced across
 *    tabs via the `storage` event, with a role switcher to impersonate the cast.
 *  - Supabase (NEXT_PUBLIC_SUPABASE_* set): see lib/supabase/store.tsx.
 * Screens only use `useStore()` / `useDefenseSession()` and the async `ops`.
 */
import * as React from "react";
import {
  accountChangeProblem, accountProblems, assignableRoles, canManageAccount, deleteScheduledSession, generateTempPassword, groupScoringStarted, memberProblems, saveStageRubric,
  scheduleSession, updateScheduledSession, type RubricSaveReport, type ScheduleDraft,
} from "./admin";
import { seedBundles, seedGrading, seedRubric, USERS } from "./mock-data";
import { resolveViewer, type Viewer } from "./permissions";
import { signEvaluation, signFinalization } from "./signature";
import type {
  Account, AccountInput, DefenseMinutes, DefenseStage, MemberInput, ProjectMember, PanelComment, RubricCriterion, SessionBundle, StageBlend, User, Verdict,
} from "./types";
import { uid } from "./utils";

const STORAGE_KEY = "cdms-demo-state-v2";

export interface State {
  bundles: Record<string, SessionBundle>;
  /** Rubric templates edited by the Coordinator (sessions hold frozen snapshots). */
  rubric: RubricCriterion[];
  /** Group/individual final-grade blend per stage (sessions hold frozen copies). */
  grading: Record<DefenseStage, StageBlend>;
  order: string[];
  /** Demo only: the editable cast. Live mode loads accounts on demand from the database. */
  accounts: Account[];
  currentUserId: string;
  hydrated: boolean;
}

export type AccountPatch = Partial<Pick<Account, "full_name" | "role" | "department">>;

/** Outcome of creating sign-in accounts for a group, per student. */
export interface MemberAccountResult {
  memberId: string;
  name: string;
  email: string;
  tempPassword: string | null;   // null when an existing student account was linked
  linkedExisting: boolean;
  error?: string;
}

export type NewComment = Pick<PanelComment, "panel_assignment_id" | "category" | "severity" | "comment_text">;

/** Every write the UI can make. Workspace ops report failures via `error`; admin ops throw. */
export interface StoreOps {
  setScore(sessionId: string, assignmentId: string, criterionId: string, studentId: string | null, score: number): void;
  submitEvaluation(sessionId: string, assignmentId: string): Promise<void>;
  finalize(sessionId: string, verdict: Verdict): Promise<void>;
  addComment(sessionId: string, c: NewComment): Promise<void>;
  deleteComment(sessionId: string, commentId: string): Promise<void>;
  resolveRevision(sessionId: string, commentId: string, resolved: boolean, note: string, reference: string): Promise<void>;
  updateMinutes(sessionId: string, fn: (m: DefenseMinutes) => DefenseMinutes): void;
  schedule(draft: ScheduleDraft): Promise<string>;
  updateSchedule(draft: ScheduleDraft): Promise<string>;
  deleteSession(sessionId: string): Promise<string>;
  saveRubric(stage: DefenseStage, drafts: RubricCriterion[], blend: StageBlend): Promise<RubricSaveReport>;
  listAccounts(): Promise<Account[]>;
  createAccount(input: AccountInput): Promise<{ account: Account; tempPassword: string }>;
  updateAccount(id: string, patch: AccountPatch): Promise<void>;
  resetPassword(id: string): Promise<string>;
  setAccountActive(id: string, active: boolean): Promise<void>;
  addMember(projectId: string, input: MemberInput): Promise<void>;
  updateMember(memberId: string, input: MemberInput): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  createMemberAccounts(projectId: string): Promise<MemberAccountResult[]>;
}

export interface StoreCtx {
  mode: "demo" | "supabase";
  state: State;
  users: User[];
  currentUser: User;
  ops: StoreOps;
  /** Last failed write, shown as a toast. */
  error: string | null;
  clearError: () => void;
  /** Demo only. */
  setUser: (id: string) => void;
  reset: () => void;
  /** Supabase only. */
  signOut: () => Promise<void>;
}

export const StoreContext = React.createContext<StoreCtx | null>(null);

// ---------------------------------------------------------------------------
// Shared pure transforms (used by both backends for optimistic updates)
// ---------------------------------------------------------------------------
export function applyScore(b: SessionBundle, assignmentId: string, criterionId: string, studentId: string | null, score: number): SessionBundle {
  const a = b.assignments.find((x) => x.id === assignmentId);
  if (!a || a.has_submitted || b.session.is_locked) return b;
  const idx = b.scores.findIndex((s) => s.panel_assignment_id === assignmentId && s.criterion_id === criterionId && s.student_id === studentId);
  const scores = [...b.scores];
  if (idx >= 0) scores[idx] = { ...scores[idx], score };
  else scores.push({ id: uid("s"), session_id: b.session.id, panel_assignment_id: assignmentId, criterion_id: criterionId, student_id: studentId, score });
  return { ...b, scores };
}

export function applyMinutes(b: SessionBundle, fn: (m: DefenseMinutes) => DefenseMinutes): SessionBundle {
  return b.session.is_locked || b.minutes.chair_approved_at ? b : { ...b, minutes: fn(b.minutes) };
}

// ---------------------------------------------------------------------------
// Demo backend
// ---------------------------------------------------------------------------
type Action =
  | { type: "replace"; state: Omit<State, "hydrated"> }
  | { type: "setUser"; userId: string }
  | { type: "patchState"; fn: (s: State) => State }
  | { type: "patchBundle"; sessionId: string; fn: (b: SessionBundle) => SessionBundle };

function initial(): State {
  const bundles = seedBundles();
  return {
    bundles: Object.fromEntries(bundles.map((b) => [b.session.id, b])),
    order: bundles.map((b) => b.session.id),
    rubric: seedRubric(),
    grading: seedGrading(),
    accounts: USERS.map((u) => ({ ...u, is_active: true, created_at: null, last_sign_in_at: null })),
    currentUserId: "u-ramos",
    hydrated: false,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "replace":
      return { ...action.state, hydrated: true };
    case "setUser":
      return { ...state, currentUserId: action.userId };
    case "patchState":
      return action.fn(state);
    case "patchBundle": {
      const b = state.bundles[action.sessionId];
      if (!b) return state;
      return { ...state, bundles: { ...state.bundles, [action.sessionId]: action.fn(b) } };
    }
  }
}

async function backfillSignatures(s: State): Promise<State> {
  const bundles = { ...s.bundles };
  for (const [id, b] of Object.entries(bundles)) {
    const assignments = await Promise.all(
      b.assignments.map(async (a) =>
        a.has_submitted && !a.signature_hash && a.submitted_at
          ? { ...a, signature_hash: await signEvaluation(a.faculty_id, a.submitted_at, b.scores.filter((x) => x.panel_assignment_id === a.id)) }
          : a,
      ),
    );
    bundles[id] = { ...b, assignments };
  }
  return { ...s, bundles };
}

function mapMembers(s: State, projectId: string, fn: (ms: ProjectMember[]) => ProjectMember[]): State {
  const bundles = Object.fromEntries(Object.entries(s.bundles).map(([id, b]) =>
    [id, b.project.id === projectId ? { ...b, members: fn(b.members) } : b]));
  return { ...s, bundles };
}

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initial);
  const [error, setError] = React.useState<string | null>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    let base: State = initial();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) base = { ...initial(), ...JSON.parse(raw), hydrated: false }; // older saves lack newer keys
    } catch { /* storage unavailable → seed */ }
    backfillSignatures(base).then((s) => dispatch({ type: "replace", state: s }));
  }, []);

  React.useEffect(() => {
    if (!state.hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bundles: state.bundles, order: state.order, rubric: state.rubric, grading: state.grading,
        accounts: state.accounts, currentUserId: state.currentUserId,
      }));
    } catch { /* ignore */ }
  }, [state]);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const incoming = JSON.parse(e.newValue);
        dispatch({ type: "replace", state: { ...initial(), ...incoming, currentUserId: stateRef.current.currentUserId } });
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const ops = React.useMemo<StoreOps>(() => {
    const patch = (sessionId: string, fn: (b: SessionBundle) => SessionBundle) => dispatch({ type: "patchBundle", sessionId, fn });
    const replaceAll = (next: State) => dispatch({ type: "patchState", fn: () => next });
    return {
      setScore: (sessionId, assignmentId, criterionId, studentId, score) =>
        patch(sessionId, (b) => applyScore(b, assignmentId, criterionId, studentId, score)),
      async submitEvaluation(sessionId, assignmentId) {
        const b = stateRef.current.bundles[sessionId];
        const a = b?.assignments.find((x) => x.id === assignmentId);
        if (!a || a.has_submitted) return;
        const ts = new Date().toISOString();
        const hash = await signEvaluation(a.faculty_id, ts, b.scores.filter((s) => s.panel_assignment_id === assignmentId));
        patch(sessionId, (bb) => ({
          ...bb,
          assignments: bb.assignments.map((x) => (x.id === assignmentId ? { ...x, has_submitted: true, submitted_at: ts, signature_hash: hash } : x)),
        }));
      },
      async finalize(sessionId, verdict) {
        const b = stateRef.current.bundles[sessionId];
        const chair = b?.assignments.find((a) => a.panel_role === "chair");
        if (!chair || b.session.is_locked || !b.assignments.every((a) => a.has_submitted)) return;
        const ts = new Date().toISOString();
        const hashes = [...b.assignments].sort((x, y) => x.id.localeCompare(y.id)).map((a) => a.signature_hash ?? "");
        const hash = await signFinalization(chair.faculty_id, ts, verdict, hashes);
        patch(sessionId, (bb) => ({
          ...bb,
          session: { ...bb.session, verdict, is_locked: true, locked_at: ts, chair_signature_hash: hash },
          minutes: { ...bb.minutes, chair_approved_at: ts, ended_at: bb.minutes.ended_at ?? ts },
        }));
      },
      async addComment(sessionId, c) {
        patch(sessionId, (b) => b.session.is_locked ? b : ({
          ...b,
          comments: [...b.comments, {
            ...c, id: uid("cm"), session_id: sessionId, is_resolved: false, resolution_note: null,
            resolution_reference: null, resolved_at: null, created_at: new Date().toISOString(),
          }],
        }));
      },
      async deleteComment(sessionId, commentId) {
        patch(sessionId, (b) => b.session.is_locked ? b : ({ ...b, comments: b.comments.filter((c) => c.id !== commentId) }));
      },
      async resolveRevision(sessionId, commentId, resolved, note, reference) {
        patch(sessionId, (b) => ({
          ...b,
          comments: b.comments.map((c) => c.id === commentId ? {
            ...c, is_resolved: resolved, resolution_note: note || null, resolution_reference: reference || null,
            resolved_at: resolved ? new Date().toISOString() : null,
          } : c),
        }));
      },
      updateMinutes: (sessionId, fn) => patch(sessionId, (b) => applyMinutes(b, fn)),
      async schedule(draft) {
        replaceAll(scheduleSession(stateRef.current, draft, stateRef.current.accounts).state);
        return "Defense scheduled. The panel can now open it from their dashboard.";
      },
      async updateSchedule(draft) {
        replaceAll(updateScheduledSession(stateRef.current, draft, stateRef.current.accounts));
        return "Session updated.";
      },
      async deleteSession(sessionId) {
        replaceAll(deleteScheduledSession(stateRef.current, sessionId));
        return "Session removed from the schedule.";
      },
      async saveRubric(stage, drafts, blend) {
        const { state: next, report } = saveStageRubric(stateRef.current, stage, drafts, blend);
        replaceAll(next);
        return report;
      },

      // Demo accounts have no real passwords; the flow mirrors the live one.
      async listAccounts() {
        return [...stateRef.current.accounts].sort((a, b) => a.full_name.localeCompare(b.full_name));
      },
      async createAccount(input) {
        const s = stateRef.current;
        const problems = accountProblems(input, s.accounts);
        if (problems.length) throw new Error(problems.join(" "));
        const actor = s.accounts.find((a) => a.id === s.currentUserId);
        if (!actor || !assignableRoles(actor).includes(input.role)) throw new Error("Only the Super Admin can create Coordinator accounts.");
        const account: Account = {
          id: uid("u"), email: input.email.trim().toLowerCase(), full_name: input.full_name.trim(), role: input.role,
          department: input.department.trim() || null, is_active: true, created_at: new Date().toISOString(), last_sign_in_at: null,
        };
        replaceAll({ ...s, accounts: [...s.accounts, account] });
        return { account, tempPassword: generateTempPassword() };
      },
      async updateAccount(id, patch) {
        const s = stateRef.current;
        const target = s.accounts.find((a) => a.id === id);
        if (!target) throw new Error("Account not found.");
        const actor = s.accounts.find((a) => a.id === s.currentUserId)!;
        if (!canManageAccount(actor, target)) throw new Error("Only the Super Admin can manage Coordinator accounts.");
        const problem = accountChangeProblem(actor, target, { role: patch.role });
        if (problem) throw new Error(problem);
        replaceAll({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
      },
      async resetPassword(id) {
        const s = stateRef.current;
        const target = s.accounts.find((a) => a.id === id);
        if (!target) throw new Error("Account not found.");
        const actor = s.accounts.find((a) => a.id === s.currentUserId)!;
        if (!canManageAccount(actor, target)) throw new Error("Only the Super Admin can manage Coordinator accounts.");
        return generateTempPassword();
      },
      async setAccountActive(id, active) {
        const s = stateRef.current;
        const target = s.accounts.find((a) => a.id === id);
        if (!target) throw new Error("Account not found.");
        const problem = accountChangeProblem(s.accounts.find((a) => a.id === s.currentUserId)!, target, { active });
        if (problem) throw new Error(problem);
        replaceAll({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, is_active: active } : a)) });
      },

      // Members live on every bundle of the project (demo keeps a copy per session).
      async addMember(projectId, input) {
        const s = stateRef.current;
        const bundles = Object.values(s.bundles).filter((b) => b.project.id === projectId);
        if (!bundles.length) throw new Error("Group not found.");
        if (groupScoringStarted(bundles, projectId)) throw new Error("Group membership is locked once scoring has started.");
        const problems = memberProblems(input, bundles[0].members);
        if (problems.length) throw new Error(problems.join(" "));
        const member: ProjectMember = {
          id: uid("m"), project_id: projectId, student_name: input.student_name.trim(),
          student_number: input.student_number.trim(), email: input.email.trim().toLowerCase() || null,
        };
        replaceAll(mapMembers(s, projectId, (ms) => [...ms, member]));
      },
      async updateMember(memberId, input) {
        const s = stateRef.current;
        const b = Object.values(s.bundles).find((x) => x.members.some((m) => m.id === memberId));
        if (!b) throw new Error("Member not found.");
        const problems = memberProblems(input, b.members, memberId);
        if (problems.length) throw new Error(problems.join(" "));
        replaceAll(mapMembers(s, b.project.id, (ms) => ms.map((m) => (m.id === memberId ? {
          ...m, student_name: input.student_name.trim(), student_number: input.student_number.trim(),
          email: input.email.trim().toLowerCase() || null,
        } : m))));
      },
      async removeMember(memberId) {
        const s = stateRef.current;
        const b = Object.values(s.bundles).find((x) => x.members.some((m) => m.id === memberId));
        if (!b) throw new Error("Member not found.");
        if (groupScoringStarted(Object.values(s.bundles), b.project.id)) throw new Error("Group membership is locked once scoring has started.");
        replaceAll(mapMembers(s, b.project.id, (ms) => ms.filter((m) => m.id !== memberId)));
      },
      async createMemberAccounts(projectId) {
        let s = stateRef.current;
        const b = Object.values(s.bundles).find((x) => x.project.id === projectId);
        if (!b) throw new Error("Group not found.");
        const results: MemberAccountResult[] = [];
        for (const m of b.members.filter((x) => !x.user_id && x.email)) {
          const email = m.email!.toLowerCase();
          const existing = s.accounts.find((a) => a.email.toLowerCase() === email);
          if (existing && existing.role !== "student") {
            results.push({ memberId: m.id, name: m.student_name, email, tempPassword: null, linkedExisting: false, error: `${email} belongs to a faculty account` });
            continue;
          }
          const account: Account = existing ?? {
            id: uid("u"), email, full_name: m.student_name, role: "student", department: b.project.group_label,
            is_active: true, created_at: new Date().toISOString(), last_sign_in_at: null,
          };
          s = { ...mapMembers(s, projectId, (ms) => ms.map((x) => (x.id === m.id ? { ...x, user_id: account.id } : x))),
                accounts: existing ? s.accounts : [...s.accounts, account] };
          results.push({ memberId: m.id, name: m.student_name, email, tempPassword: existing ? null : generateTempPassword(), linkedExisting: !!existing });
        }
        replaceAll(s);
        return results;
      },
    };
  }, []);

  const value = React.useMemo<StoreCtx>(() => ({
    mode: "demo",
    state,
    users: state.accounts,
    currentUser: state.accounts.find((u) => u.id === state.currentUserId) ?? state.accounts[0] ?? USERS[0],
    ops,
    error,
    clearError: () => setError(null),
    setUser: (userId) => dispatch({ type: "setUser", userId }),
    reset: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      backfillSignatures(initial()).then((s) => dispatch({ type: "replace", state: { ...s, currentUserId: stateRef.current.currentUserId } }));
    },
    signOut: async () => {},
  }), [state, ops, error]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside a store provider");
  return ctx;
}

/** Session-scoped data + mutations for the workspace and print views. */
export function useDefenseSession(sessionId: string) {
  const { state, ops, currentUser, users } = useStore();
  const bundle = state.bundles[sessionId];
  const viewer: Viewer | null = bundle ? resolveViewer(currentUser, bundle) : null;
  const userById = React.useCallback((id: string | null | undefined) => users.find((u) => u.id === id), [users]);

  const actions = React.useMemo(() => ({
    setScore: (assignmentId: string, criterionId: string, studentId: string | null, score: number) =>
      ops.setScore(sessionId, assignmentId, criterionId, studentId, score),
    submitEvaluation: (assignmentId: string) => ops.submitEvaluation(sessionId, assignmentId),
    finalize: (verdict: Verdict) => ops.finalize(sessionId, verdict),
    addComment: (c: NewComment) => { void ops.addComment(sessionId, c); },
    deleteComment: (commentId: string) => { void ops.deleteComment(sessionId, commentId); },
    resolveRevision: (commentId: string, resolved: boolean, note: string, reference: string) => {
      void ops.resolveRevision(sessionId, commentId, resolved, note, reference);
    },
    updateMinutes: (fn: (m: DefenseMinutes) => DefenseMinutes) => ops.updateMinutes(sessionId, fn),
  }), [ops, sessionId]);

  return { bundle, viewer, actions, userById, hydrated: state.hydrated, order: state.order };
}
