"use client";
import * as React from "react";
import { Check, Copy, KeyRound, Power, PowerOff, Trash2, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { groupAccountHolder, listProjects } from "@/lib/admin";
import { useStore } from "@/lib/store";
import { AccessCodeCard } from "./access-code-card";
import type { Account } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));
type Credential = { title: string; email: string; password: string };

/** One sign-in account per capstone group, held by its authorized member. */
export function GroupAccountsManager() {
  const { ops, state, mode } = useStore();
  const [accounts, setAccounts] = React.useState<Account[] | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ id: string; action: "reset" | "delete" | "disable" } | null>(null);
  const [credential, setCredential] = React.useState<Credential | null>(null);
  const [choice, setChoice] = React.useState<Record<string, string>>({});
  const [copied, setCopied] = React.useState(false);

  const reload = React.useCallback(async () => {
    try { setAccounts(await ops.listAccounts()); } catch (e) { setNotice({ ok: false, text: errText(e) }); }
  }, [ops]);
  React.useEffect(() => { void reload(); }, [reload, state]);

  const act = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice({ ok: true, text: ok });
    } catch (e) {
      setNotice({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
      setConfirm(null);
      await reload();
    }
  };

  if (!accounts) return <p className="text-sm text-muted-foreground">Loading group accounts…</p>;

  const projects = listProjects(state);
  const linkedIds = new Set(projects.flatMap((p) => p.members.map((m) => m.user_id).filter(Boolean)));
  const unlinked = accounts.filter((a) => a.role === "student" && !linkedIds.has(a.id));
  const withAccount = projects.filter((p) => groupAccountHolder(p.members)).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each capstone group has <b className="text-foreground">one</b> sign-in account, held by an authorized member. After the defense is
        locked it sees the verdict, comments, minutes and every member&apos;s grade. Groups that register on the registration page choose
        their authorized member and password themselves; the account is created when you schedule them.
      </p>
      <AccessCodeCard
        title="Group account sign-up page"
        description="For groups that already appear below but have no account yet (for example, scheduled by hand). One member enters this code plus their email and student number as listed in the group, then sets the group password. Groups that already have an account cannot sign up again."
        path="/group-signup" prefix="GRP" audience="group leaders"
        load={ops.getGroupSignupSettings} save={ops.saveGroupSignupSettings} />
      <p className="text-sm text-muted-foreground">{projects.length} groups · {withAccount} with an account</p>

      {notice && (
        <p role={notice.ok ? "status" : "alert"}
          className={cn("rounded-md border px-3 py-2 text-sm", notice.ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
          {notice.text}
        </p>
      )}
      {credential && (
        <Card className="border-success/50">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="normal-case tracking-normal text-success">{credential.title}</CardTitle>
            <Button size="icon" variant="ghost" className="size-7" aria-label="Dismiss" onClick={() => setCredential(null)}><X /></Button>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Email:</span> {credential.email}</p>
            <p><span className="text-muted-foreground">Temporary password:</span> <span className="font-mono text-base tracking-wider">{credential.password}</span></p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(
                `CDEMS group account\nSign in: ${window.location.origin}/login\nEmail: ${credential.email}\nTemporary password: ${credential.password}\nPlease change it after signing in.`,
              ).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy sign-in details"}</Button>
              <span className="text-xs text-muted-foreground">{mode === "demo" ? "Demo mode: passwords are illustrative." : "Shown only once. Send it to the authorized member privately."}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Group</th>
                <th className="px-2 py-2 text-left font-medium">Authorized member</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-left font-medium">Last sign-in</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No groups yet. Groups appear here once their first defense is scheduled.</td></tr>
              )}
              {projects.map(({ project, members }) => {
                const holder = groupAccountHolder(members);
                const acc = holder ? accounts.find((a) => a.id === holder.user_id) : undefined;
                const eligible = members.filter((m) => m.email);
                const picked = eligible.some((m) => m.id === choice[project.id]) ? choice[project.id] : eligible[0]?.id ?? "";
                const key = project.id;
                return (
                  <tr key={project.id} className={cn("border-b align-middle last:border-0", acc && !acc.is_active && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{project.group_label}</p>
                      <p className="max-w-[260px] truncate text-xs text-muted-foreground" title={project.title}>{project.title}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      {holder ? (
                        <>
                          <p className="font-medium">{holder.student_name}</p>
                          <p className="text-xs text-muted-foreground">{acc?.email ?? holder.email}</p>
                        </>
                      ) : eligible.length ? (
                        <NativeSelect aria-label={`Authorized member for ${project.group_label}`} className="h-8 w-64 text-xs" value={picked}
                          onChange={(e) => setChoice((c) => ({ ...c, [project.id]: e.target.value }))}>
                          {eligible.map((m) => <option key={m.id} value={m.id}>{m.student_name} — {m.email}</option>)}
                        </NativeSelect>
                      ) : (
                        <span className="text-xs text-muted-foreground">Add a member email in Groups first</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {acc ? <Badge variant={acc.is_active ? "success" : "muted"}>{acc.is_active ? "Active" : "Disabled"}</Badge>
                        : <Badge variant="warning">No account</Badge>}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">{acc?.last_sign_in_at ? fmtDateTime(acc.last_sign_in_at) : acc ? "Never" : "—"}</td>
                    <td className="px-4 py-2.5">
                      {!acc ? (
                        <div className="flex justify-end">
                          <Button size="sm" disabled={!picked || busy === key} onClick={() => void act(key, async () => {
                            const r = await ops.createGroupAccount(picked);
                            if (r.tempPassword) setCredential({ title: `Group account created for ${project.group_label} (${r.name})`, email: r.email, password: r.tempPassword });
                          }, `${project.group_label} now has its group account.`)}>
                            <UserPlus /> Create account
                          </Button>
                        </div>
                      ) : confirm?.id === acc.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="mr-1 text-xs text-muted-foreground">
                            {confirm.action === "reset" ? "Issue a new password and sign them out?"
                              : confirm.action === "delete" ? "Delete this group account? The member stays in the group." : "Disable sign-in?"}
                          </span>
                          <Button size="sm" variant={confirm.action === "reset" ? "default" : "destructive"} disabled={busy === key}
                            onClick={() => confirm.action === "reset"
                              ? void act(key, async () => {
                                  const pw = await ops.resetPassword(acc.id);
                                  setCredential({ title: `New password for ${project.group_label} (${acc.full_name})`, email: acc.email, password: pw });
                                }, `Password reset for ${project.group_label}. They have been signed out.`)
                              : confirm.action === "delete"
                                ? void act(key, () => ops.deleteAccount(acc.id), `${project.group_label}'s account was deleted. You can now choose another member.`)
                                : void act(key, () => ops.setAccountActive(acc.id, false), `${project.group_label}'s account can no longer sign in.`)}>
                            {confirm.action === "delete" ? "Delete" : "Confirm"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={!acc.is_active || busy === key} onClick={() => { setConfirm({ id: acc.id, action: "reset" }); setCredential(null); }}><KeyRound /> Reset password</Button>
                          {acc.is_active
                            ? <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => setConfirm({ id: acc.id, action: "disable" })}><PowerOff /> Disable</Button>
                            : <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => void act(key, () => ops.setAccountActive(acc.id, true), `${project.group_label}'s account can sign in again.`)}><Power /> Enable</Button>}
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === key}
                            aria-label={`Delete ${project.group_label} account`} onClick={() => setConfirm({ id: acc.id, action: "delete" })}><Trash2 /> Delete</Button>
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

      {unlinked.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Student accounts not linked to a group ({unlinked.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">Left over from earlier per-student accounts or removed groups. Delete them unless you still need them.</p>
            {unlinked.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <span><b>{a.full_name}</b> <span className="text-xs text-muted-foreground">{a.email}</span></span>
                {confirm?.id === a.id ? (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="destructive" disabled={busy === a.id} onClick={() => void act(a.id, () => ops.deleteAccount(a.id), `${a.full_name}'s account was deleted.`)}>Delete</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm({ id: a.id, action: "delete" })}><Trash2 /> Delete</Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
