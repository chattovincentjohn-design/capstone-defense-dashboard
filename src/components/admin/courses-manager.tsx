"use client";
import * as React from "react";
import { Check, Pencil, Plus, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { programProblem } from "@/lib/admin";
import { useStore, type ProgramInput } from "@/lib/store";
import { ROLE_LABEL, type Program } from "@/lib/types";

const TERMS: Program["project_term"][] = ["Capstone", "Thesis", "Research"];
const BLANK: ProgramInput = { code: "", name: "", project_term: "Thesis" };
const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

/** Super admin: list, rename and add courses. Each course gets its own Coordinator(s), rubric and grade split. */
export function CoursesManager({ onPick }: { onPick: (programId: string) => void }) {
  const { state, users, ops } = useStore();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const stats = (id: string) => {
    const groups = new Set(Object.values(state.bundles).filter((b) => b.project.program_id === id).map((b) => b.project.id)).size;
    const coordinators = users.filter((u) => u.role === "admin" && u.program_id === id).map((u) => u.full_name);
    return { groups, coordinators };
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each course has its own {ROLE_LABEL.admin}(s), rubric and grade split. To give a course a Coordinator, pick the course above,
        open <span className="text-foreground">Accounts</span>, and add an account with the role <span className="text-foreground">{ROLE_LABEL.admin}</span>.
      </p>
      {notice && <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <Button size="sm" onClick={() => { setAdding(true); setEditing(null); setNotice(null); }} disabled={adding}><Plus /> Add course</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Code</th>
                <th className="px-2 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">Defense type</th>
                <th className="px-2 py-2 text-left font-medium">Coordinator(s)</th>
                <th className="px-2 py-2 text-right font-medium">Groups</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {adding && (
                <ProgramRow initial={BLANK} programs={state.programs} onCancel={() => setAdding(false)}
                  onSave={async (input) => {
                    const p = await ops.createProgram(input);
                    setAdding(false);
                    setNotice(`${p.code} added with a copy of the BSIT rubric and grade split. Next: give it a Coordinator in Accounts.`);
                  }} />
              )}
              {state.programs.map((p) => editing === p.id ? (
                <ProgramRow key={p.id} initial={{ code: p.code, name: p.name, project_term: p.project_term }} programs={state.programs}
                  editingId={p.id} onCancel={() => setEditing(null)}
                  onSave={async (input) => { await ops.updateProgram(p.id, input); setEditing(null); setNotice(`${input.code.toUpperCase()} updated.`); }} />
              ) : (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-semibold">{p.code}</td>
                  <td className="px-2 py-2.5">{p.name}</td>
                  <td className="px-2 py-2.5">{p.project_term}</td>
                  <td className="px-2 py-2.5 text-xs">
                    {stats(p.id).coordinators.join(", ") || <span className="text-warning">None yet</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{stats(p.id).groups}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onPick(p.id)}>Open</Button>
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${p.code}`}
                        onClick={() => { setEditing(p.id); setAdding(false); setNotice(null); }}><Pencil /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProgramRow({ initial, programs, editingId, onSave, onCancel }: {
  initial: ProgramInput; programs: Program[]; editingId?: string;
  onSave: (input: ProgramInput) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    const problem = programProblem(f, programs, editingId);
    if (problem) return setError(problem);
    setBusy(true);
    try { await onSave(f); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <tr className="border-b bg-background/40 align-top">
      <td className="px-4 py-2"><Input aria-label="Course code" className="h-8 w-28 uppercase" value={f.code} autoFocus
        onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="BSHM" /></td>
      <td className="px-2 py-2">
        <Input aria-label="Course name" className="h-8" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="BS Hospitality Management" />
        {error && <p className="mt-1 flex gap-1 text-xs text-destructive"><XCircle className="mt-px size-3.5 shrink-0" />{error}</p>}
      </td>
      <td className="px-2 py-2">
        <NativeSelect aria-label="Defense type" className="h-8 w-32" value={f.project_term}
          onChange={(e) => setF({ ...f, project_term: e.target.value as Program["project_term"] })}>
          {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </NativeSelect>
      </td>
      <td className="px-2 py-2" colSpan={2} />
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <Button size="sm" disabled={busy} onClick={() => void save()}><Check /> Save</Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label="Cancel" onClick={onCancel}><X /></Button>
        </div>
      </td>
    </tr>
  );
}
