"use client";
/**
 * Supabase-backed store. Loads everything the signed-in user may see (RLS decides),
 * keeps it fresh with Realtime, and writes through the repository. Scores and minutes
 * are applied optimistically and saved after a short pause so sliders and typing stay
 * smooth; other writes reload the affected session from the database.
 */
import * as React from "react";
import {
  activeRubric, blendFor, buildAttendance, cleanRegistration, facultySignupProblems, groupScoringStarted, registrationProblems, isRubricSyncable, memberProblems, saveStageRubric,
  sessionHasScores, validateSchedule,
  type ScheduleDraft,
} from "../admin";
import { seedGrading } from "../mock-data";
import { applyMinutes, applyScore, StoreContext, type MemberAccountResult, type State, type StoreCtx, type StoreOps } from "../store";
import type { DefenseMinutes, RubricScore, SessionBundle, User } from "../types";
import { isPublicPath } from "../redirect";
import { createClient } from "./client";
import * as repo from "./repository";

const SCORE_SAVE_MS = 500;
const MINUTES_SAVE_MS = 800;
const RELOAD_DEBOUNCE_MS = 250;

const EMPTY: State = { bundles: {}, order: [], rubric: [], grading: seedGrading(), accounts: [], registrations: [], registrationSettings: { is_open: false, access_code: "" }, facultySignupSettings: { is_open: false, access_code: "" }, currentUserId: "", hydrated: false };
const GUEST: User = { id: "", full_name: "Signed out", email: "", role: "student", department: null };

const message = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);

type PendingScore = { row: Omit<RubricScore, "id">; timer: ReturnType<typeof setTimeout> };

export function SupabaseStoreProvider({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<State>(EMPTY);
  const [users, setUsers] = React.useState<User[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const pendingScores = React.useRef(new Map<string, PendingScore>());
  const minutesTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reloadTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const currentUser = users.find((u) => u.id === state.currentUserId) ?? GUEST;

  // ---- loading ------------------------------------------------------------
  /** Re-apply this tab's unsaved score edits on top of fresh server data. */
  const overlayPending = (b: SessionBundle) => {
    let out = b;
    for (const { row } of pendingScores.current.values()) {
      if (row.session_id === b.session.id) out = applyScore(out, row.panel_assignment_id, row.criterion_id, row.student_id, row.score);
    }
    return out;
  };

  const loadBundle = React.useCallback(async (sessionId: string) => {
    try {
      const b = overlayPending(await repo.fetchSessionBundle(sb, sessionId));
      setState((s) => ({
        ...s,
        bundles: { ...s.bundles, [sessionId]: b },
        order: s.order.includes(sessionId) ? s.order : [...s.order, sessionId],
      }));
    } catch (e) {
      // Session no longer visible (deleted or unassigned): drop it.
      setState((s) => {
        if (!s.bundles[sessionId]) return s;
        const bundles = { ...s.bundles };
        delete bundles[sessionId];
        return { ...s, bundles, order: s.order.filter((id) => id !== sessionId) };
      });
      if (stateRef.current.bundles[sessionId]) console.warn("Reload failed", message(e));
    }
  }, [sb]);

  const loadAll = React.useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      setState({ ...EMPTY });
      if (!isPublicPath(window.location.pathname)) {
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      }
      return;
    }
    try {
      const [userList, rubric, grading, ids] = await Promise.all([
        repo.listUsers(sb), repo.listAllCriteria(sb), repo.getStageBlends(sb), repo.listVisibleSessionIds(sb),
      ]);
      const bundles = await Promise.all(ids.map((id) => repo.fetchSessionBundle(sb, id)));
      setUsers(userList);
      setState({
        bundles: Object.fromEntries(bundles.map((b) => [b.session.id, overlayPending(b)])),
        order: ids,
        rubric,
        grading: { ...seedGrading(), ...grading },
        accounts: [],
        registrations: [],
        registrationSettings: { is_open: false, access_code: "" },
        facultySignupSettings: { is_open: false, access_code: "" },
        currentUserId: user.id,
        hydrated: true,
      });
    } catch (e) {
      setError(`Could not load data: ${message(e)}`);
    }
  }, [sb]);

  const scheduleReload = React.useCallback((key: string, fn: () => void) => {
    clearTimeout(reloadTimers.current.get(key));
    reloadTimers.current.set(key, setTimeout(() => { reloadTimers.current.delete(key); fn(); }, RELOAD_DEBOUNCE_MS));
  }, []);

  // ---- auth + realtime ------------------------------------------------------
  React.useEffect(() => {
    void loadAll();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void loadAll();
    });

    const channel = sb.channel("defense-live");
    for (const table of ["panel_assignments", "panel_comments", "defense_minutes"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (p) => {
        const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { session_id?: string };
        const sid = row?.session_id;
        if (!sid) return scheduleReload("*", () => void loadAll());
        // The secretary is the only writer of minutes; don't clobber their in-progress typing.
        const b = stateRef.current.bundles[sid];
        if (table === "defense_minutes" && b?.session.secretary_id === stateRef.current.currentUserId) return;
        scheduleReload(sid, () => void loadBundle(sid));
      });
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "defense_sessions" }, () =>
      scheduleReload("*", () => void loadAll()));
    channel.subscribe();

    return () => {
      sub.subscription.unsubscribe();
      void sb.removeChannel(channel);
    };
  }, [sb, loadAll, loadBundle, scheduleReload]);

  // ---- writes ------------------------------------------------------------------
  const patch = React.useCallback((sessionId: string, fn: (b: SessionBundle) => SessionBundle) => {
    setState((s) => (s.bundles[sessionId] ? { ...s, bundles: { ...s.bundles, [sessionId]: fn(s.bundles[sessionId]) } } : s));
  }, []);

  const saveScore = React.useCallback(async (key: string) => {
    const p = pendingScores.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    try {
      await repo.upsertScore(sb, p.row);
      if (pendingScores.current.get(key) === p) pendingScores.current.delete(key);
    } catch (e) {
      pendingScores.current.delete(key);
      setError(`Score not saved: ${message(e)}`);
      void loadBundle(p.row.session_id);
    }
  }, [sb, loadBundle]);

  const flushScores = React.useCallback(async (sessionId: string) => {
    const keys = [...pendingScores.current.entries()].filter(([, p]) => p.row.session_id === sessionId).map(([k]) => k);
    await Promise.all(keys.map(saveScore));
  }, [saveScore]);

  const saveMinutesNow = React.useCallback(async (sessionId: string) => {
    minutesTimers.current.delete(sessionId);
    const b = stateRef.current.bundles[sessionId];
    if (!b) return;
    try {
      const m = { ...b.minutes, recorder_id: b.minutes.recorder_id || stateRef.current.currentUserId };
      const id = await repo.saveMinutes(sb, m);
      if (!b.minutes.id) patch(sessionId, (bb) => ({ ...bb, minutes: { ...bb.minutes, id, recorder_id: m.recorder_id } }));
    } catch (e) {
      setError(`Minutes not saved: ${message(e)}`);
    }
  }, [sb, patch]);

  /** Run a workspace write; surface failures as a toast and resync the session. */
  const attempt = React.useCallback(async (sessionId: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      await loadBundle(sessionId);
    }
  }, [loadBundle]);

  const ops = React.useMemo<StoreOps>(() => ({
    setScore(sessionId, assignmentId, criterionId, studentId, score) {
      patch(sessionId, (b) => applyScore(b, assignmentId, criterionId, studentId, score));
      const key = `${assignmentId}|${criterionId}|${studentId ?? "group"}`;
      clearTimeout(pendingScores.current.get(key)?.timer);
      pendingScores.current.set(key, {
        row: { session_id: sessionId, panel_assignment_id: assignmentId, criterion_id: criterionId, student_id: studentId, score },
        timer: setTimeout(() => void saveScore(key), SCORE_SAVE_MS),
      });
    },
    submitEvaluation: (sessionId) => attempt(sessionId, async () => {
      await flushScores(sessionId);
      await repo.submitEvaluation(sb, sessionId);
    }),
    finalize: (sessionId, verdict) => attempt(sessionId, () => repo.finalizeDefense(sb, sessionId, verdict)),
    addComment: (sessionId, c) => attempt(sessionId, () => repo.addComment(sb, { ...c, session_id: sessionId })),
    deleteComment: (sessionId, id) => attempt(sessionId, () => repo.deleteComment(sb, id)),
    resolveRevision: (sessionId, id, resolved, note, ref) =>
      attempt(sessionId, () => repo.resolveRevision(sb, id, resolved, note, ref)),
    updateMinutes(sessionId, fn: (m: DefenseMinutes) => DefenseMinutes) {
      patch(sessionId, (b) => applyMinutes(b, fn));
      clearTimeout(minutesTimers.current.get(sessionId));
      minutesTimers.current.set(sessionId, setTimeout(() => void saveMinutesNow(sessionId), MINUTES_SAVE_MS));
    },

    // ---- Coordinator --------------------------------------------------------
    async schedule(draft: ScheduleDraft) {
      const s = stateRef.current;
      const errors = validateSchedule(draft, s, users).filter((i) => i.level === "error");
      if (errors.length) throw new Error(errors.map((i) => i.message).join(" "));

      let projectId = draft.projectId;
      let adviserId: string | null;
      let members;
      if (draft.projectId === "new") {
        const p = draft.newProject!;
        const created = await repo.createProject(sb, {
          title: p.title.trim(), group_label: p.group_label.trim(), abstract: p.abstract.trim() || null,
          manuscript_url: p.manuscript_url.trim() || null, demo_url: p.demo_url.trim() || null,
          adviser_id: p.adviser_id, academic_year: p.academic_year.trim(),
        }, p.members);
        projectId = created.id;
        adviserId = created.adviser_id;
        members = p.members.map((m, i) => ({ ...m, id: `tmp-${i}`, project_id: created.id }));
      } else {
        const b = Object.values(s.bundles).find((x) => x.project.id === draft.projectId)!;
        adviserId = b.project.adviser_id;
        members = b.members;
      }

      const session = await repo.scheduleSession(sb, {
        project_id: projectId, stage: draft.stage, scheduled_at: draft.scheduledAt, room_or_link: draft.room.trim(),
        secretary_id: draft.secretaryId, chair_id: draft.chairId, member_ids: draft.memberIds,
      });
      if (draft.secretaryId) {
        await repo.saveMinutes(sb, {
          id: "", session_id: session.id, recorder_id: draft.secretaryId, started_at: null, ended_at: null,
          attendance_json: buildAttendance(
            [{ id: draft.chairId, role: "Chair" }, ...draft.memberIds.map((id) => ({ id, role: "Panel Member" }))],
            adviserId, members, users),
          qa_entries_json: [], deliberation_notes: "", chair_approved_at: null,
        });
      }
      await loadAll();
      return "Defense scheduled. The panel can now open it from their dashboard.";
    },

    async updateSchedule(draft: ScheduleDraft) {
      const s = stateRef.current;
      const b = draft.sessionId ? s.bundles[draft.sessionId] : undefined;
      if (!b) throw new Error("Session not found.");
      const errors = validateSchedule(draft, s, users).filter((i) => i.level === "error");
      if (errors.length) throw new Error(errors.map((i) => i.message).join(" "));

      await repo.updateSession(sb, b.session.id, {
        stage: draft.stage, scheduled_at: draft.scheduledAt, room_or_link: draft.room.trim(), secretary_id: draft.secretaryId,
      });
      await repo.setPanel(sb, b.session.id, draft.chairId, draft.memberIds);
      if (!b.minutes.started_at && draft.secretaryId) {
        await repo.saveMinutes(sb, {
          ...b.minutes, session_id: b.session.id, recorder_id: draft.secretaryId,
          attendance_json: buildAttendance(
            [{ id: draft.chairId, role: "Chair" }, ...draft.memberIds.map((id) => ({ id, role: "Panel Member" }))],
            b.project.adviser_id, b.members, users),
        });
      }
      await loadAll();
      return "Session updated.";
    },

    async deleteSession(sessionId) {
      const b = stateRef.current.bundles[sessionId];
      if (b && sessionHasScores(b)) throw new Error("Cannot delete a session with recorded scores.");
      await repo.deleteSession(sb, sessionId);
      await loadAll();
      return "Session removed from the schedule.";
    },

    async saveRubric(stage, drafts, blend) {
      const s = stateRef.current;
      // Validates and computes the same report the demo shows; throws on invalid input.
      const { report } = saveStageRubric(s, stage, drafts, blend);
      const current = activeRubric(s.rubric, stage);

      for (const old of current) {
        if (!drafts.some((d) => d.id === old.id)) await repo.retireCriterion(sb, old.id);
      }
      for (const d of drafts) {
        if (d.id.startsWith("new-")) {
          await repo.addCriterion(sb, {
            stage, scope: d.scope, criterion_name: d.criterion_name.trim(), description: d.description,
            weight_percentage: d.weight_percentage, max_score: d.max_score, sort_order: d.sort_order, is_active: true,
          });
          continue;
        }
        const old = current.find((c) => c.id === d.id);
        if (old && (old.criterion_name !== d.criterion_name || old.weight_percentage !== d.weight_percentage ||
            old.max_score !== d.max_score || old.description !== d.description || old.sort_order !== d.sort_order)) {
          await repo.reviseCriterion(sb, d);
        }
      }
      if (report.blendChanged || JSON.stringify(blendFor(s, stage)) !== JSON.stringify(blend)) {
        await repo.setStageBlend(sb, stage, blend);
      }
      for (const b of Object.values(s.bundles)) {
        if (b.session.stage === stage && isRubricSyncable(b)) await repo.syncSessionRubric(sb, b.session.id);
      }
      await loadAll();
      return report;
    },

    // ---- Group self-registration ---------------------------------------------
    registrationInfo: (code) => repo.registrationInfo(sb, code),
    async submitRegistration(code, input) {
      const problems = registrationProblems(input);
      if (problems.length) throw new Error(problems.join(" "));
      await repo.submitRegistration(sb, code, cleanRegistration(input));
    },
    listRegistrations: () => repo.listRegistrations(sb),
    getRegistrationSettings: () => repo.getRegistrationSettings(sb),
    async saveRegistrationSettings(settings) {
      if (settings.is_open && settings.access_code.trim().length < 4) throw new Error("Set a registration code of at least 4 characters before opening registration.");
      await repo.saveRegistrationSettings(sb, settings);
    },
    setRegistrationStatus: (id, status) => repo.setRegistrationStatus(sb, id, status),
    deleteRegistration: (id) => repo.deleteRegistration(sb, id),
    facultySignupInfo: (code) => repo.facultySignupInfo(sb, code),
    async facultySignup(code, input) {
      const problems = facultySignupProblems(input, input.password);
      if (problems.length) throw new Error(problems.join(" "));
      await repo.facultySignup(sb, code, input);
      const { error } = await sb.auth.signInWithPassword({ email: input.email.trim().toLowerCase(), password: input.password });
      if (error) throw new Error(`Your account was created, but signing in failed: ${error.message}. Try the sign-in page.`);
    },
    getFacultySignupSettings: () => repo.getFacultySignupSettings(sb),
    async saveFacultySignupSettings(settings) {
      if (settings.is_open && settings.access_code.trim().length < 4) throw new Error("Set a sign-up code of at least 4 characters before opening sign-up.");
      await repo.saveFacultySignupSettings(sb, settings);
    },

    // ---- Accounts (admin-only RPCs) ----------------------------------------
    listAccounts: () => repo.listAccounts(sb),
    async createAccount(input) {
      const { userId, tempPassword } = await repo.createAccount(sb, input);
      const accounts = await repo.listAccounts(sb);
      setUsers(await repo.listUsers(sb));
      const account = accounts.find((a) => a.id === userId);
      if (!account) throw new Error("Account was created but could not be loaded.");
      return { account, tempPassword };
    },
    async updateAccount(id, patch) {
      await repo.updateAccount(sb, id, patch);
      setUsers(await repo.listUsers(sb));
    },
    async changeEmail(id, email) {
      await repo.changeEmail(sb, id, email);
      setUsers(await repo.listUsers(sb));
      await loadAll();
    },
    resetPassword: (id) => repo.resetPassword(sb, id),
    setAccountActive: (id, active) => repo.setAccountActive(sb, id, active),

    // ---- Group members -------------------------------------------------------
    async addMember(projectId, input) {
      const s = stateRef.current;
      const bundles = Object.values(s.bundles);
      const current = bundles.find((b) => b.project.id === projectId);
      if (!current) throw new Error("Group not found.");
      if (groupScoringStarted(bundles, projectId)) throw new Error("Group membership is locked once scoring has started.");
      const problems = memberProblems(input, current.members);
      if (problems.length) throw new Error(problems.join(" "));
      await repo.addMember(sb, projectId, input);
      await loadAll();
    },
    async updateMember(memberId, input) {
      const b = Object.values(stateRef.current.bundles).find((x) => x.members.some((m) => m.id === memberId));
      if (!b) throw new Error("Member not found.");
      const problems = memberProblems(input, b.members, memberId);
      if (problems.length) throw new Error(problems.join(" "));
      await repo.updateMember(sb, memberId, input);
      await loadAll();
    },
    async removeMember(memberId) {
      const bundles = Object.values(stateRef.current.bundles);
      const b = bundles.find((x) => x.members.some((m) => m.id === memberId));
      if (!b) throw new Error("Member not found.");
      if (groupScoringStarted(bundles, b.project.id)) throw new Error("Group membership is locked once scoring has started.");
      await repo.removeMember(sb, memberId);
      await loadAll();
    },
    async createMemberAccounts(projectId) {
      const b = Object.values(stateRef.current.bundles).find((x) => x.project.id === projectId);
      if (!b) throw new Error("Group not found.");
      const results: MemberAccountResult[] = [];
      for (const m of b.members.filter((x) => !x.user_id && x.email)) {
        try {
          const r = await repo.createMemberAccount(sb, m.id);
          results.push({ memberId: m.id, name: m.student_name, email: m.email!, tempPassword: r.tempPassword, linkedExisting: r.linkedExisting });
        } catch (e) {
          results.push({ memberId: m.id, name: m.student_name, email: m.email!, tempPassword: null, linkedExisting: false, error: message(e) });
        }
      }
      setUsers(await repo.listUsers(sb));
      await loadAll();
      return results;
    },
  }), [sb, patch, saveScore, flushScores, saveMinutesNow, attempt, loadAll, users]);

  // Save pending edits if the tab is closed mid-pause.
  React.useEffect(() => {
    const flush = () => {
      for (const key of pendingScores.current.keys()) void saveScore(key);
      for (const sid of minutesTimers.current.keys()) void saveMinutesNow(sid);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [saveScore, saveMinutesNow]);

  const value = React.useMemo<StoreCtx>(() => ({
    mode: "supabase",
    state,
    users,
    currentUser,
    ops,
    error,
    clearError: () => setError(null),
    setUser: () => {},
    reset: () => {},
    signOut: async () => {
      await sb.auth.signOut();
      window.location.assign("/login");
    },
  }), [state, users, currentUser, ops, error, sb]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
