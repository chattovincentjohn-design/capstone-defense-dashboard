"use client";
/**
 * Demo data store. Persists to localStorage and syncs across browser tabs via the
 * `storage` event — open the workspace in two tabs as two different panelists to
 * see live status updates (the production equivalent is lib/supabase/realtime.ts).
 */
import * as React from "react";
import { seedBundles, seedRubric, USERS } from "./mock-data";
import { resolveViewer, type Viewer } from "./permissions";
import { signEvaluation, signFinalization } from "./signature";
import type { DefenseMinutes, PanelComment, RubricCriterion, SessionBundle, User, Verdict } from "./types";
import { uid } from "./utils";

const STORAGE_KEY = "cdms-demo-state-v1";

export interface State {
  bundles: Record<string, SessionBundle>;
  /** Rubric templates edited by the Coordinator (sessions hold frozen snapshots). */
  rubric: RubricCriterion[];
  order: string[];
  currentUserId: string;
  hydrated: boolean;
}

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

interface StoreCtx {
  state: State;
  users: User[];
  currentUser: User;
  setUser: (id: string) => void;
  patch: (sessionId: string, fn: (b: SessionBundle) => SessionBundle) => void;
  patchState: (fn: (s: State) => State) => void;
  reset: () => void;
}

const Ctx = React.createContext<StoreCtx | null>(null);

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initial);

  // Hydrate from localStorage once on mount.
  React.useEffect(() => {
    let base: State = initial();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) base = { ...initial(), ...JSON.parse(raw), hydrated: false }; // older saves lack `rubric`
    } catch { /* storage unavailable → seed */ }
    backfillSignatures(base).then((s) => dispatch({ type: "replace", state: s }));
  }, []);

  // Persist after hydration.
  React.useEffect(() => {
    if (!state.hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bundles: state.bundles, order: state.order, rubric: state.rubric, currentUserId: state.currentUserId }));
    } catch { /* ignore */ }
  }, [state]);

  // Cross-tab "realtime" sync. Keep this tab's selected user.
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
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const value = React.useMemo<StoreCtx>(() => ({
    state,
    users: USERS,
    currentUser: USERS.find((u) => u.id === state.currentUserId) ?? USERS[0],
    setUser: (userId) => dispatch({ type: "setUser", userId }),
    patch: (sessionId, fn) => dispatch({ type: "patchBundle", sessionId, fn }),
    patchState: (fn) => dispatch({ type: "patchState", fn }),
    reset: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      backfillSignatures(initial()).then((s) => dispatch({ type: "replace", state: { ...s, currentUserId: state.currentUserId } }));
    },
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside <DemoStoreProvider>");
  return ctx;
}

/** Session-scoped data + mutations. Each mutation mirrors a Supabase call (see lib/supabase/repository.ts). */
export function useDefenseSession(sessionId: string) {
  const { state, patch, currentUser, users } = useStore();
  const bundle = state.bundles[sessionId];
  const viewer: Viewer | null = bundle ? resolveViewer(currentUser, bundle) : null;
  const userById = React.useCallback((id: string | null | undefined) => users.find((u) => u.id === id), [users]);

  const actions = React.useMemo(() => ({
    /** upsert into rubric_scores */
    setScore(assignmentId: string, criterionId: string, studentId: string | null, score: number) {
      patch(sessionId, (b) => {
        const a = b.assignments.find((x) => x.id === assignmentId);
        if (!a || a.has_submitted || b.session.is_locked) return b;
        const idx = b.scores.findIndex((s) => s.panel_assignment_id === assignmentId && s.criterion_id === criterionId && s.student_id === studentId);
        const scores = [...b.scores];
        if (idx >= 0) scores[idx] = { ...scores[idx], score };
        else scores.push({ id: uid("s"), session_id: sessionId, panel_assignment_id: assignmentId, criterion_id: criterionId, student_id: studentId, score });
        return { ...b, scores };
      });
    },

    /** rpc('submit_evaluation') */
    async submitEvaluation(assignmentId: string) {
      const b = state.bundles[sessionId];
      const a = b.assignments.find((x) => x.id === assignmentId);
      if (!a || a.has_submitted) return;
      const ts = new Date().toISOString();
      const hash = await signEvaluation(a.faculty_id, ts, b.scores.filter((s) => s.panel_assignment_id === assignmentId));
      patch(sessionId, (bb) => ({
        ...bb,
        assignments: bb.assignments.map((x) => (x.id === assignmentId ? { ...x, has_submitted: true, submitted_at: ts, signature_hash: hash } : x)),
      }));
    },

    /** rpc('finalize_defense') */
    async finalize(verdict: Verdict) {
      const b = state.bundles[sessionId];
      const chair = b.assignments.find((a) => a.panel_role === "chair");
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

    addComment(c: Omit<PanelComment, "id" | "session_id" | "is_resolved" | "resolution_note" | "resolution_reference" | "resolved_at" | "created_at">) {
      patch(sessionId, (b) => b.session.is_locked ? b : ({
        ...b,
        comments: [...b.comments, {
          ...c, id: uid("cm"), session_id: sessionId, is_resolved: false, resolution_note: null,
          resolution_reference: null, resolved_at: null, created_at: new Date().toISOString(),
        }],
      }));
    },

    deleteComment(commentId: string) {
      patch(sessionId, (b) => b.session.is_locked ? b : ({ ...b, comments: b.comments.filter((c) => c.id !== commentId) }));
    },

    /** rpc('resolve_revision') */
    resolveRevision(commentId: string, resolved: boolean, note: string, reference: string) {
      patch(sessionId, (b) => ({
        ...b,
        comments: b.comments.map((c) => c.id === commentId ? {
          ...c, is_resolved: resolved, resolution_note: note || null, resolution_reference: reference || null,
          resolved_at: resolved ? new Date().toISOString() : null,
        } : c),
      }));
    },

    /** update defense_minutes */
    updateMinutes(fn: (m: DefenseMinutes) => DefenseMinutes) {
      patch(sessionId, (b) => (b.session.is_locked || b.minutes.chair_approved_at ? b : { ...b, minutes: fn(b.minutes) }));
    },
  }), [patch, sessionId, state.bundles]);

  return { bundle, viewer, actions, userById, hydrated: state.hydrated, order: state.order };
}
