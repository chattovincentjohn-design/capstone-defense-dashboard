"use client";
import * as React from "react";
import { Check, Copy, KeyRound, Lock, Pencil, Plus, Search, Trash2, UserCheck, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { groupScoringStarted, listProjects, memberProblems } from "@/lib/admin";
import { useStore, type MemberAccountResult } from "@/lib/store";
import { STAGE_LABEL, type MemberInput, type ProjectMember } from "@/lib/types";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));
const BLANK: MemberInput = { student_name: "", student_number: "", email: "" };

export function GroupsManager() {
  const { state, ops } = useStore();
  const [query, setQuery] = React.useState("");
  const projects = listProjects(state);
  const bundles = Object.values(state.bundles);
  const q = query.trim().toLowerCase();
  const shown = projects.filter(({ project, members }) =>
    !q || project.title.toLowerCase().includes(q) || project.group_label.toLowerCase().includes(q) ||
    members.some((m) => m.student_name.toLowerCase().includes(q) || m.student_number.includes(q) || (m.email ?? "").includes(q)));

  const totals = projects.reduce((t, p) => ({
    members: t.members + p.members.length,
    linked: t.linked + p.members.filter((m) => m.user_id).length,
  }), { members: 0, linked: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {projects.length} groups · {totals.members} proponents · {totals.linked} with a group account
        </p>
        <label className="relative">
          <span className="sr-only">Search groups</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="h-9 w-64 pl-8" placeholder="Search group, title, student" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        New groups are registered when you schedule their first defense. Each group has <span className="text-foreground">one sign-in account</span> held by an authorized member;
        after the defense is locked it sees the verdict, comments, minutes and every member&apos;s grade.
      </p>

      {shown.length === 0 && <p className="text-sm text-muted-foreground">No groups match.</p>}
      {shown.map(({ project, members }) => (
        <GroupCard key={project.id} title={`${project.group_label}: ${project.title}`} projectId={project.id} members={members}
          stages={bundles.filter((b) => b.project.id === project.id).map((b) => STAGE_LABEL[b.session.stage])}
          locked={groupScoringStarted(bundles, project.id)} ops={ops} />
      ))}
    </div>
  );
}

function GroupCard({ title, projectId, members, stages, locked, ops }: {
  title: string; projectId: string; members: ProjectMember[]; stages: string[]; locked: boolean;
  ops: ReturnType<typeof useStore>["ops"];
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [results, setResults] = React.useState<MemberAccountResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const holder = members.find((m) => !!m.user_id) ?? null;
  const eligible = members.filter((m) => !m.user_id && m.email);
  const [chosen, setChosen] = React.useState("");
  const chosenId = eligible.some((m) => m.id === chosen) ? chosen : eligible[0]?.id ?? "";

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); return true; } catch (e) { setError(errText(e)); return false; }
  };

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle className="normal-case tracking-normal">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{stages.join(" · ")}</p>
        </div>
        {locked && <Badge variant="warning" title="Members can't be added or removed once scoring has started"><Lock className="size-3" /> Membership locked</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-2 text-left font-medium">Student</th>
                <th className="px-2 py-2 text-left font-medium">Student No.</th>
                <th className="px-2 py-2 text-left font-medium">Email</th>
                <th className="px-2 py-2 text-left font-medium">Sign-in</th>
                <th className="py-2 pl-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => editing === m.id ? (
                <MemberEditRow key={m.id} initial={{ student_name: m.student_name, student_number: m.student_number, email: m.email ?? "" }}
                  members={members} editingId={m.id} emailLocked={!!m.user_id} onCancel={() => setEditing(null)}
                  onSave={async (input) => { if (await run(() => ops.updateMember(m.id, input))) setEditing(null); }} />
              ) : (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2 pr-2 font-medium">{m.student_name}</td>
                  <td className="px-2 py-2 tabular-nums">{m.student_number}</td>
                  <td className="px-2 py-2 text-xs">{m.email || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-2">
                    {m.user_id ? <Badge variant="success"><UserCheck className="size-3" /> Group account</Badge>
                      : holder ? <span className="text-xs text-muted-foreground">—</span>
                      : m.email ? <Badge variant="muted">Eligible</Badge>
                      : <Badge variant="warning">Needs email</Badge>}
                  </td>
                  <td className="py-2 pl-2">
                    {confirmRemove === m.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="mr-1 text-xs text-muted-foreground">Remove from group?</span>
                        <Button size="sm" variant="destructive" onClick={async () => { await run(() => ops.removeMember(m.id)); setConfirmRemove(null); }}>Remove</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${m.student_name}`} onClick={() => { setEditing(m.id); setAdding(false); }}><Pencil /></Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${m.student_name}`} disabled={locked}
                          title={locked ? "Members can't be removed once scoring has started" : undefined}
                          onClick={() => setConfirmRemove(m.id)}><Trash2 /></Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {adding && (
                <MemberEditRow initial={BLANK} members={members} onCancel={() => setAdding(false)}
                  onSave={async (input) => { if (await run(() => ops.addMember(projectId, input))) setAdding(false); }} />
              )}
            </tbody>
          </table>
        </div>

        {error && <p role="alert" className="flex gap-1.5 text-xs text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={locked || adding} onClick={() => { setAdding(true); setEditing(null); }}
            title={locked ? "Members can't be added once scoring has started" : undefined}><Plus /> Add member</Button>
          {holder ? (
            <span className="text-xs text-muted-foreground">
              Group account: <b className="text-foreground">{holder.student_name}</b> ({holder.email}). Manage it in Group Accounts.
            </span>
          ) : eligible.length === 0 ? (
            <span className="text-xs text-muted-foreground">Add an email to a member (pencil) to create the group&apos;s account.</span>
          ) : (
            <>
              <NativeSelect aria-label="Authorized member" className="h-8 w-60 text-xs" value={chosenId} onChange={(e) => setChosen(e.target.value)}>
                {eligible.map((m) => <option key={m.id} value={m.id}>{m.student_name} — {m.email}</option>)}
              </NativeSelect>
              <Button size="sm" disabled={creating || !chosenId} onClick={async () => {
                setCreating(true); setResults(null);
                await run(async () => setResults([await ops.createGroupAccount(chosenId)]));
                setCreating(false);
              }}>
                <KeyRound /> {creating ? "Creating…" : "Create group account"}
              </Button>
            </>
          )}
        </div>

        {results && <ResultsCard results={results} onClose={() => setResults(null)} />}
      </CardContent>
    </Card>
  );
}

function MemberEditRow({ initial, members, editingId, emailLocked, onSave, onCancel }: {
  initial: MemberInput; members: ProjectMember[]; editingId?: string; emailLocked?: boolean;
  onSave: (m: MemberInput) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = React.useState(initial);
  const [attempted, setAttempted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const problems = memberProblems(f, members, editingId);
  const save = async () => {
    setAttempted(true);
    if (problems.length) return;
    setBusy(true); await onSave(f); setBusy(false);
  };
  return (
    <tr className="border-b bg-background/40 align-top">
      <td className="py-2 pr-2"><Input aria-label="Student name" className="h-8 text-sm" value={f.student_name} autoFocus
        onChange={(e) => setF({ ...f, student_name: e.target.value })} placeholder="Full name" /></td>
      <td className="px-2 py-2"><Input aria-label="Student number" className="h-8 text-sm" value={f.student_number}
        onChange={(e) => setF({ ...f, student_number: e.target.value })} placeholder="2022-00000" /></td>
      <td className="px-2 py-2">
        <Input aria-label="Student email" type="email" className="h-8 text-sm" value={f.email} disabled={emailLocked}
          title={emailLocked ? "The sign-in email can't change once the account exists" : undefined}
          onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="student@school.edu" />
        {attempted && problems.length > 0 && <p className="mt-1 text-xs text-destructive">{problems.join(" ")}</p>}
      </td>
      <td className="px-2 py-2" />
      <td className="py-2 pl-2">
        <div className="flex justify-end gap-1">
          <Button size="sm" disabled={busy} onClick={() => void save()}><Check /> Save</Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label="Cancel" onClick={onCancel}><X /></Button>
        </div>
      </td>
    </tr>
  );
}

function ResultsCard({ results, onClose }: { results: MemberAccountResult[]; onClose: () => void }) {
  const { mode } = useStore();
  const [copied, setCopied] = React.useState(false);
  const created = results.filter((r) => r.tempPassword);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const text = created.map((r) =>
    `${r.name}\nSign in: ${origin}/login\nEmail: ${r.email}\nTemporary password: ${r.tempPassword}\nPlease change it after signing in.`).join("\n\n");
  return (
    <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-success">
          {created.length} account{created.length === 1 ? "" : "s"} created
          {results.some((r) => r.linkedExisting) && `, ${results.filter((r) => r.linkedExisting).length} linked to an existing account`}
          {results.some((r) => r.error) && `, ${results.filter((r) => r.error).length} failed`}
        </p>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Dismiss"><X /></Button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {results.map((r) => (
            <tr key={r.memberId} className="border-t border-success/20">
              <td className="py-1.5 pr-2">{r.name}</td>
              <td className="px-2 py-1.5 text-xs">{r.email}</td>
              <td className={cn("py-1.5 pl-2 text-right", r.error ? "text-destructive text-xs" : "font-mono")}>
                {r.error ? r.error : r.tempPassword ?? <span className="text-xs text-muted-foreground">linked (uses existing password)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {created.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy all sign-in details"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {mode === "demo" ? "Demo mode: passwords are illustrative." : "Shown only once. Give it to the group's authorized member privately; they can also use “Forgot password?”."}
          </span>
        </div>
      )}
    </div>
  );
}
