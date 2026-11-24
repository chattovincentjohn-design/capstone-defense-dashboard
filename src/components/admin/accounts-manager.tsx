"use client";
import * as React from "react";
import { Check, Copy, KeyRound, Pencil, Power, PowerOff, Search, Trash2, UserPlus, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { accountChangeProblem, accountProblems, assignableRoles, canManageAccount, emailChangeProblem, isAdminRole } from "@/lib/admin";
import { useStore } from "@/lib/store";
import { AccessCodeCard } from "./access-code-card";
import { ROLE_LABEL, type Account, type AccountInput, type UserRole } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const ROLES: UserRole[] = ["superadmin", "admin", "chair", "panelist", "secretary", "adviser", "student"];
const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));
const BLANK: AccountInput = { full_name: "", email: "", role: "panelist", department: "" };

type Credential = { kind: "created" | "reset"; name: string; email: string; password: string };

/** Faculty Accounts and Student Accounts share this screen; `audience` decides which accounts it lists. */
export function AccountsManager({ audience = "faculty" }: { audience?: "faculty" | "students" } = {}) {
  const students = audience === "students";
  const { ops, currentUser, mode, state } = useStore();
  const [accounts, setAccounts] = React.useState<Account[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<UserRole | "all">("all");
  const [showForm, setShowForm] = React.useState(false);
  const [credential, setCredential] = React.useState<Credential | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = React.useState<{ id: string; action: "reset" | "disable" | "delete" } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setAccounts(await ops.listAccounts());
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, [ops]);
  React.useEffect(() => { void reload(); }, [reload]);

  const act = async (id: string, fn: () => Promise<string | void>, success: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await fn();
      setNotice({ ok: true, text: success });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: errText(e) });
      await reload();
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  if (loadError) return <p role="alert" className="text-sm text-destructive">Could not load accounts: {loadError}</p>;
  if (!accounts) return <p className="text-sm text-muted-foreground">Loading accounts…</p>;

  // Group membership of each student account (from the defenses this admin can see)
  const membership = new Map<string, { group: string; number: string }>();
  for (const b of Object.values(state.bundles)) {
    for (const m of b.members) if (m.user_id) membership.set(m.user_id, { group: b.project.group_label, number: m.student_number });
  }
  const listed = accounts.filter((a) => (a.role === "student") === students);
  const q = query.trim().toLowerCase();
  const shown = listed.filter((a) =>
    (students || roleFilter === "all" || a.role === roleFilter) &&
    (!q || a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || (a.department ?? "").toLowerCase().includes(q) ||
      (membership.get(a.id)?.number ?? "").includes(q) || (membership.get(a.id)?.group ?? "").toLowerCase().includes(q)));
  const disabled = listed.filter((a) => !a.is_active).length;
  const formRoles = students ? (["student"] as UserRole[]) : assignableRoles(currentUser).filter((r) => r !== "student");

  return (
    <div className="space-y-4">
      {!students && <AccessCodeCard
        title="Faculty sign-up page"
        description="Faculty create their own account here (Panel Member, Defense Chair, Defense Secretary or Adviser) and choose their own password. They need the code below. Coordinator accounts are still created only by the Super Admin."
        path="/signup" prefix="FAC" audience="faculty"
        load={ops.getFacultySignupSettings} save={ops.saveFacultySignupSettings} />}
      {students && (
        <p className="text-sm text-muted-foreground">
          Student (proponent) sign-in accounts. Each student sees only their own group&apos;s defense and their own grade.
          You can also create them per group from the <b>Groups</b> tab; an account here is linked to a group automatically when the email matches.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{listed.length} {students ? "student" : "faculty"} accounts{disabled ? ` · ${disabled} disabled` : ""}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search accounts</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input className="h-9 w-56 pl-8" placeholder={students ? "Search name, email, student no., group" : "Search name, email, dept."}
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {!students && (
            <NativeSelect className="h-9 w-44" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}>
              <option value="all">All roles</option>
              {ROLES.filter((r) => r !== "student").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </NativeSelect>
          )}
          <Button size="sm" onClick={() => { setShowForm(true); setCredential(null); setNotice(null); }}><UserPlus /> {students ? "Add student" : "Add account"}</Button>
        </div>
      </div>

      {credential && <CredentialCard credential={credential} demo={mode === "demo"} onClose={() => setCredential(null)} />}
      {notice && (
        <p role={notice.ok ? "status" : "alert"}
          className={cn("rounded-md border px-3 py-2 text-sm", notice.ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
          {notice.text}
        </p>
      )}

      {showForm && (
        <CreateAccountForm existing={accounts} roles={formRoles} students={students} onCancel={() => setShowForm(false)}
          onCreate={async (input) => {
            const { account, tempPassword } = await ops.createAccount(input);
            setShowForm(false);
            setCredential({ kind: "created", name: account.full_name, email: account.email, password: tempPassword });
            await reload();
          }} />
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">{students ? "Group · Student No." : "Role"}</th>
                <th className="px-2 py-2 text-left font-medium">{students ? "Section" : "Department"}</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-left font-medium">Last sign-in</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No accounts match.</td></tr>
              )}
              {shown.map((a) => {
                const self = a.id === currentUser.id;
                const busy = busyId === a.id;
                const manageable = canManageAccount(currentUser, a);
                const lockedHint = !manageable ? "Only the Super Admin can manage Coordinator accounts" : undefined;
                const roleOptions = ROLES.filter((r) => r !== "student" && (r === a.role || assignableRoles(currentUser).includes(r)));
                const member = membership.get(a.id);
                return (
                  <tr key={a.id} className={cn("border-b align-middle last:border-0", !a.is_active && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <NameField account={a} disabled={busy || !manageable} self={self}
                        onSave={(full_name) => act(a.id, () => ops.updateAccount(a.id, { full_name }), `Name updated to ${full_name}.`)} />
                      <EmailField account={a} accounts={accounts ?? []} disabled={busy || !manageable} title={lockedHint}
                        onSave={(email) => act(a.id, () => ops.changeEmail(a.id, email),
                          `${a.full_name} now signs in with ${email.trim().toLowerCase()}. Their password did not change.`)} />
                    </td>
                    <td className="px-2 py-2.5">
                      {students ? (
                        member
                          ? <span className="text-xs">{member.group} · <span className="font-mono">{member.number}</span></span>
                          : <Badge variant="muted">Not in a group</Badge>
                      ) : (
                      <NativeSelect className="h-8 w-44 text-xs" aria-label={`Role for ${a.full_name}`} value={a.role}
                        disabled={busy || !manageable || (self && isAdminRole(a.role))}
                        title={self && isAdminRole(a.role) ? "You cannot change your own administrator role" : lockedHint}
                        onChange={(e) => {
                          const role = e.target.value as UserRole;
                          const problem = accountChangeProblem(currentUser, a, { role });
                          if (problem) return setNotice({ ok: false, text: problem });
                          void act(a.id, () => ops.updateAccount(a.id, { role }), `${a.full_name} is now ${ROLE_LABEL[role]}.`);
                        }}>
                        {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </NativeSelect>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <DepartmentField account={a} disabled={busy || !manageable}
                        onSave={(department) => act(a.id, () => ops.updateAccount(a.id, { department: department || null }), `${students ? "Section" : "Department"} updated for ${a.full_name}.`)} />
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge variant={a.is_active ? "success" : "muted"}>{a.is_active ? "Active" : "Disabled"}</Badge>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{a.last_sign_in_at ? fmtDateTime(a.last_sign_in_at) : "Never"}</td>
                    <td className="px-4 py-2.5">
                      {confirm?.id === a.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="mr-1 text-xs text-muted-foreground">
                            {confirm.action === "reset" ? "Issue a new password and sign them out?"
                              : confirm.action === "delete" ? "Delete this account permanently? This cannot be undone."
                              : "Disable sign-in?"}
                          </span>
                          <Button size="sm" variant={confirm.action === "reset" ? "default" : "destructive"} disabled={busy}
                            onClick={() => confirm.action === "reset"
                              ? void act(a.id, async () => {
                                  const password = await ops.resetPassword(a.id);
                                  setCredential({ kind: "reset", name: a.full_name, email: a.email, password });
                                }, `Password reset for ${a.full_name}. They have been signed out.`)
                              : confirm.action === "delete"
                                ? void act(a.id, () => ops.deleteAccount(a.id), `${a.full_name}'s account was deleted.`)
                                : void act(a.id, () => ops.setAccountActive(a.id, false), `${a.full_name} can no longer sign in.`)}>
                            {confirm.action === "delete" ? "Delete" : "Confirm"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={busy || !a.is_active || !manageable} title={lockedHint} onClick={() => { setConfirm({ id: a.id, action: "reset" }); setCredential(null); }}
                            aria-label={`Reset password for ${a.full_name}`}><KeyRound /> Reset password</Button>
                          {a.is_active ? (
                            <Button size="sm" variant="ghost" disabled={busy || self || !manageable} title={self ? "You cannot disable your own account" : lockedHint}
                              onClick={() => setConfirm({ id: a.id, action: "disable" })} aria-label={`Disable ${a.full_name}`}><PowerOff /> Disable</Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={busy || !manageable} title={lockedHint} aria-label={`Enable ${a.full_name}`}
                              onClick={() => void act(a.id, () => ops.setAccountActive(a.id, true), `${a.full_name} can sign in again.`)}><Power /> Enable</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || self || !manageable}
                            title={self ? "You cannot delete your own account" : lockedHint}
                            onClick={() => setConfirm({ id: a.id, action: "delete" })} aria-label={`Delete ${a.full_name}`}><Trash2 /> Delete</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Disabling keeps the person&apos;s scores, signatures and minutes intact; it only blocks sign-in. Per-defense roles (Chair, member,
        Secretary) are set when scheduling; the role here is the person&apos;s default.
      </p>
    </div>
  );
}

function EmailField({ account, accounts, disabled, title, onSave }: {
  account: Account; accounts: Account[]; disabled: boolean; title?: string; onSave: (email: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(account.email);
  const problem = value.trim().toLowerCase() === account.email.toLowerCase() ? null : emailChangeProblem(value, account.id, accounts);
  const unchanged = value.trim().toLowerCase() === account.email.toLowerCase();

  if (!editing) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {account.email}
        <Button size="icon" variant="ghost" className="size-6" aria-label={`Edit email for ${account.full_name}`} title={title ?? "Edit email"}
          disabled={disabled} onClick={() => { setValue(account.email); setEditing(true); }}><Pencil className="size-3" /></Button>
      </p>
    );
  }
  const save = async () => {
    if (problem || unchanged) return;
    await onSave(value);
    setEditing(false);
  };
  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-1">
        <Input type="email" autoFocus className="h-7 w-56 text-xs" aria-label={`New email for ${account.full_name}`} value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} />
        <Button size="icon" className="size-7" aria-label="Save email" disabled={disabled || !!problem || unchanged} onClick={() => void save()}><Check /></Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Cancel" onClick={() => setEditing(false)}><X /></Button>
      </div>
      {problem && <p className="text-[11px] text-destructive">{problem}</p>}
      {!problem && !unchanged && <p className="text-[11px] text-muted-foreground">They will sign in with this email from now on. The password stays the same.</p>}
    </div>
  );
}

function NameField({ account, disabled, self, onSave }: {
  account: Account; disabled: boolean; self: boolean; onSave: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(account.full_name);
  const trimmed = value.trim();
  const invalid = trimmed.length < 2;
  const save = async () => {
    if (invalid || trimmed === account.full_name) return setEditing(false);
    await onSave(trimmed);
    setEditing(false);
  };
  if (!editing) {
    return (
      <p className="flex items-center gap-1 font-medium">
        {account.full_name} {self && <Badge variant="default" className="ml-1">You</Badge>}
        <Button size="icon" variant="ghost" className="size-6" aria-label={`Edit name of ${account.full_name}`} title="Edit name"
          disabled={disabled} onClick={() => { setValue(account.full_name); setEditing(true); }}><Pencil className="size-3" /></Button>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input autoFocus className="h-7 w-56 text-sm" aria-label={`New name for ${account.full_name}`} value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} />
      <Button size="icon" className="size-7" aria-label="Save name" disabled={disabled || invalid} onClick={() => void save()}><Check /></Button>
      <Button size="icon" variant="ghost" className="size-7" aria-label="Cancel" onClick={() => setEditing(false)}><X /></Button>
    </div>
  );
}

function DepartmentField({ account, disabled, onSave }: { account: Account; disabled: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = React.useState(account.department ?? "");
  React.useEffect(() => setValue(account.department ?? ""), [account.department]);
  const commit = () => { if (value.trim() !== (account.department ?? "")) onSave(value.trim()); };
  return (
    <Input className="h-8 w-52 text-xs" aria-label={`Department for ${account.full_name}`} value={value} disabled={disabled}
      placeholder="—" onChange={(e) => setValue(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setValue(account.department ?? ""); }} />
  );
}

function CreateAccountForm({ existing, roles, students = false, onCreate, onCancel }: {
  existing: Account[]; roles: UserRole[]; students?: boolean; onCreate: (input: AccountInput) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = React.useState<AccountInput>(() => ({ ...BLANK, role: roles.includes(BLANK.role) ? BLANK.role : roles[0] }));
  const [attempted, setAttempted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const problems = accountProblems(f, existing);
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (problems.length) return;
    setBusy(true);
    setServerError(null);
    try {
      await onCreate({ ...f, email: f.email.trim().toLowerCase(), full_name: f.full_name.trim(), department: f.department.trim() });
    } catch (err) {
      setServerError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{students ? "New student account" : "New account"}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="acc-name">Full name (as it appears on documents)</Label>
              <Input id="acc-name" value={f.full_name} onChange={(e) => set("full_name", e.target.value)}
                placeholder={students ? "Ana M. Cruz" : "Prof. Juan P. Santos"} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-email">Email (used to sign in)</Label>
              <Input id="acc-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)}
                placeholder={students ? "acruz@jhcsc.edu.ph" : "jsantos@school.edu"} autoComplete="off" />
            </div>
            {!students && (
              <div className="space-y-1">
                <Label htmlFor="acc-role">Role</Label>
                <NativeSelect id="acc-role" value={f.role} onChange={(e) => set("role", e.target.value as UserRole)}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="acc-dept">{students ? "Section" : "Department / section"}</Label>
              <Input id="acc-dept" value={f.department} onChange={(e) => set("department", e.target.value)}
                placeholder={students ? "BSIT 4-A" : "College of Computing Studies"} />
            </div>
          </div>
          {f.role === "admin" && <p className="text-xs text-warning">Coordinators can manage every schedule, rubric and non-Coordinator account.</p>}
          {f.role === "superadmin" && <p className="text-xs text-warning">Super Admins can do everything, including managing Coordinators.</p>}
          {((attempted && problems.length > 0) || serverError) && (
            <ul className="space-y-1 text-xs text-destructive" aria-live="polite">
              {attempted && problems.map((p) => <li key={p} className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{p}</li>)}
              {serverError && <li className="flex gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{serverError}</li>}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}><X /> Cancel</Button>
            <Button type="submit" disabled={busy || (attempted && problems.length > 0)}><UserPlus /> {busy ? "Creating…" : "Create account"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CredentialCard({ credential, demo, onClose }: { credential: Credential; demo: boolean; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const text = `CDEMS · Capstone Defense Evaluation and Management System\nSign in: ${typeof window !== "undefined" ? window.location.origin : ""}/login\nEmail: ${credential.email}\nTemporary password: ${credential.password}\nPlease change it after signing in (your name → Change password).`;
  return (
    <Card className="border-success/50">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-success">
            {credential.kind === "created" ? `Account created for ${credential.name}` : `New password for ${credential.name}`}
          </p>
          <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Dismiss"><X /></Button>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt><dd>{credential.email}</dd>
          <dt className="text-muted-foreground">Temporary password</dt>
          <dd className="font-mono text-base tracking-wider" aria-label="Temporary password">{credential.password}</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
          }}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy sign-in details"}</Button>
          <span className="text-xs text-muted-foreground">
            {demo ? "Demo mode: this password is illustrative; demo accounts have no real sign-in." :
              "Shown only once. Share it privately; they should change it after signing in."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
