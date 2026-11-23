"use client";
import { canReadMinutes, type Viewer } from "@/lib/permissions";
import { CATEGORY_LABEL, STAGE_LABEL, VERDICT_LABEL, type SessionBundle, type User } from "@/lib/types";
import { fmtDateTime, fmtTime } from "@/lib/utils";
import { DocHeader, MetaTable, PrintShell, SignatureBlock } from "./print-shell";

export function MinutesDocument({ bundle, viewer, userById }: { bundle: SessionBundle; viewer: Viewer; userById: (id: string) => User | undefined }) {
  const { session, project, minutes: m } = bundle;
  const name = (id: string | null | undefined) => userById(id ?? "")?.full_name ?? "";
  const chair = bundle.assignments.find((a) => a.panel_role === "chair");
  const mandatory = bundle.comments.filter((c) => c.severity === "mandatory");

  return (
    <PrintShell sessionId={session.id} draft={!m.chair_approved_at}>
      <DocHeader title="Minutes of the Defense" subtitle={`${STAGE_LABEL[session.stage]} · A.Y. ${project.academic_year}`} />
      {!canReadMinutes(viewer, bundle) ? (
        <p className="border border-black p-4 text-center">Minutes are released after Chair approval.</p>
      ) : (
        <>
          <MetaTable rows={[
            ["Project Title", <b key="t">{project.title}</b>],
            ["Group", project.group_label],
            ["Venue", session.room_or_link ?? ""],
            ["Scheduled", fmtDateTime(session.scheduled_at)],
            ["Called to order", fmtTime(m.started_at)],
            ["Adjourned", fmtTime(m.ended_at)],
          ]} />

          <h2 className="mb-1 font-bold">I. Attendance</h2>
          <table className="mb-4 text-[10pt]">
            <thead className="bg-neutral-100"><tr><th className="text-left">Name</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {m.attendance_json.map((a) => (
                <tr key={a.id}><td>{a.name}</td><td className="text-center">{a.role}</td><td className="text-center">{a.present ? "Present" : "Absent"}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 className="mb-1 font-bold">II. Questions, Responses & Actions</h2>
          <table className="mb-4 text-[10pt]">
            <thead className="bg-neutral-100">
              <tr><th className="w-14">Time</th><th className="text-left">Panelist Question</th><th className="text-left">Proponents&apos; Response</th><th className="text-left">Action Required</th></tr>
            </thead>
            <tbody>
              {m.qa_entries_json.length === 0 && <tr><td colSpan={4} className="text-center">No questions recorded.</td></tr>}
              {m.qa_entries_json.map((q) => (
                <tr key={q.id} className="align-top">
                  <td className="text-center">{fmtTime(q.timestamp)}</td>
                  <td><b>{name(q.panelist_id)}:</b> {q.question}</td>
                  <td>{q.response || "—"}</td>
                  <td>{q.action_required || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mb-1 font-bold">III. Deliberation</h2>
          <p className="mb-4 min-h-12 whitespace-pre-wrap border border-black p-2 text-[10pt]">{m.deliberation_notes || "—"}</p>

          <h2 className="mb-1 font-bold">IV. Required Revisions</h2>
          <ol className="mb-4 list-decimal pl-6 text-[10pt]">
            {mandatory.length === 0 && <li>None.</li>}
            {mandatory.map((c) => <li key={c.id}>[{CATEGORY_LABEL[c.category]}] {c.comment_text}</li>)}
          </ol>

          <p className="border border-black p-2 text-center text-[12pt]">
            DECISION OF THE PANEL: <b>{session.verdict ? VERDICT_LABEL[session.verdict].toUpperCase() : "PENDING"}</b>
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-6">
        <SignatureBlock name={name(m.recorder_id)} role="Defense Secretary / Recorder" signedAt={m.ended_at} />
        {chair && <SignatureBlock name={name(chair.faculty_id)} role="Defense Chair — Approved" signedAt={m.chair_approved_at} hash={session.chair_signature_hash} />}
      </div>
    </PrintShell>
  );
}
