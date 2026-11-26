"use client";
import * as React from "react";
import { CheckCircle2, FileSignature, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store";
import type { GroupRegistration } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";
import { EndorsementBadge, OpenEndorsementButton } from "./endorsement-badge";

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

/**
 * Adviser's dashboard card: groups that named this faculty member as capstone adviser upload an
 * endorsement when they register; the adviser verifies it (or returns it with a reason) here.
 */
export function EndorsementReviews() {
  const { ops, currentUser, state } = useStore();
  const [regs, setRegs] = React.useState<GroupRegistration[] | null>(null);
  const [returning, setReturning] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const faculty = !!currentUser.id && currentUser.role !== "student";

  const reload = React.useCallback(async () => {
    if (!faculty) return;
    try { setRegs(await ops.listMyAdviseeRegistrations()); } catch { setRegs([]); }
  }, [ops, faculty]);
  React.useEffect(() => { void reload(); }, [reload, state.hydrated, currentUser.id]);

  const open = (regs ?? []).filter((r) => r.status === "pending" && r.endorsement_status !== "none");
  if (!faculty || open.length === 0) return null;
  const waiting = open.filter((r) => r.endorsement_status === "pending").length;

  const review = async (r: GroupRegistration, verified: boolean, text: string) => {
    setBusy(r.id); setNotice(null);
    try {
      await ops.reviewEndorsement(r.id, verified, text);
      setNotice({ ok: true, text: verified ? `${r.group_label}'s endorsement is verified. The Coordinator can now schedule them.` : `${r.group_label}'s endorsement was returned.` });
      setReturning(null); setNote("");
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: errText(e) });
    } finally { setBusy(null); }
  };

  return (
    <Card className={waiting ? "border-warning/60" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileSignature className="size-4" /> Endorsements to verify {waiting > 0 && `(${waiting})`}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          These groups named you as their capstone adviser and uploaded an endorsement. Check that it is the one you signed.
          The Coordinator can schedule a group only after you verify it.
        </p>
        {notice && <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "text-sm text-success" : "text-sm text-destructive"}>{notice.text}</p>}
        {open.map((r) => (
          <div key={r.id} className="space-y-2 rounded-md border bg-background/40 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.group_label}: {r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.members.map((m) => m.student_name).join(", ")} · A.Y. {r.academic_year} · Registered {fmtDateTime(r.created_at)}
                </p>
              </div>
              <EndorsementBadge status={r.endorsement_status} />
            </div>
            {r.endorsement_status === "returned" && r.endorsement_note && <p className="text-xs text-destructive">Your reason: {r.endorsement_note}</p>}
            {returning === r.id ? (
              <div className="space-y-2">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Reason for returning ${r.group_label}'s endorsement`}
                  placeholder="Why is it returned? e.g. Not signed, wrong title, unreadable scan" />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={busy === r.id || note.trim().length < 5} onClick={() => void review(r, false, note)}><Undo2 /> Return endorsement</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setReturning(null); setNote(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <OpenEndorsementButton reg={r} />
                {r.endorsement_status !== "verified" && (
                  <Button size="sm" disabled={busy === r.id} onClick={() => void review(r, true, "")}><CheckCircle2 /> Verify — I endorsed this group</Button>
                )}
                {r.endorsement_status !== "returned" && (
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => { setReturning(r.id); setNote(""); }}><Undo2 /> Return</Button>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
