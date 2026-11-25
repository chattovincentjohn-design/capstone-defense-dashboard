"use client";
import { gradeVisibleMembers } from "@/lib/admin";
import { configFor, consolidate, criterionPercent, RATING_SCALE, scoreLabel, splitCriteria, TRANSMUTATION_TABLE, usesRatingScale } from "@/lib/grading";
import { canOpenDeliberation, type Viewer } from "@/lib/permissions";
import { STAGE_LABEL, VERDICT_LABEL, type SessionBundle, type User } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";
import { DocHeader, MetaTable, PrintShell, SignatureBlock } from "./print-shell";

export function RatingSheet({ bundle, viewer, userById }: { bundle: SessionBundle; viewer: Viewer; userById: (id: string) => User | undefined }) {
  const { session, project } = bundle;
  const allowed = canOpenDeliberation(viewer, bundle);
  const c = consolidate({ ...bundle, members: gradeVisibleMembers(viewer, bundle) });
  const cfg = configFor(bundle);
  const { group, individual } = splitCriteria(bundle.criteria);
  const name = (fid: string) => userById(fid)?.full_name ?? "";
  const chair = bundle.assignments.find((a) => a.panel_role === "chair");

  return (
    <PrintShell sessionId={session.id} draft={!session.is_locked}>
      <DocHeader title="Official Consolidated Rating Sheet" subtitle={`${STAGE_LABEL[session.stage]} · A.Y. ${project.academic_year}`} />
      <MetaTable rows={[
        ["Project Title", <b key="t">{project.title}</b>],
        ["Group", project.group_label],
        ["Proponents", bundle.members.map((m) => `${m.student_name} (${m.student_number})`).join("; ")],
        ["Adviser", name(project.adviser_id ?? "")],
        ["Date / Venue", `${fmtDateTime(session.scheduled_at)} · ${session.room_or_link ?? ""}`],
      ]} />

      {!allowed ? (
        <p className="border border-black p-4 text-center">
          Consolidated scores are confidential until all panel members have submitted and the Defense Chair locks the session.
        </p>
      ) : (
        <>
          <h2 className="mb-1 font-bold">I. Group Criteria ({cfg.groupWeight}% of final grade)</h2>
          <table className="mb-4 text-[10pt]">
            <thead className="bg-neutral-100">
              <tr>
                <th className="text-left">Criterion</th><th>Weight</th>
                {c.panel.map((p) => <th key={p.assignment.id}>{name(p.assignment.faculty_id).split(" ").slice(-1)}</th>)}
                <th>Mean</th>
              </tr>
            </thead>
            <tbody>
              {group.map((cr) => {
                const st = c.stats.find((s) => s.criterion.id === cr.id && !s.student)!;
                return (
                  <tr key={cr.id}>
                    <td>{cr.criterion_name}</td><td className="text-center">{cr.weight_percentage}%</td>
                    {c.panel.map((p) => <td key={p.assignment.id} className="text-center">{scoreLabel(st.byAssignment[p.assignment.id], cr)}</td>)}
                    <td className="text-center font-semibold">{usesRatingScale(cr)
                      ? (() => { const xs = c.panel.map((p) => st.byAssignment[p.assignment.id]).filter((v): v is number => v !== undefined).map((v) => criterionPercent(v, 5)); return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—"; })()
                      : st.mean.toFixed(2)}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td colSpan={2}>Weighted Group Score (%)</td>
                {c.panel.map((p) => <td key={p.assignment.id} className="text-center">{p.group.percent.toFixed(2)}</td>)}
                <td className="text-center">{c.groupPercent.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <h2 className="mb-1 font-bold">II. Individual Criteria ({cfg.individualWeight}% of final grade)</h2>
          <table className="mb-4 text-[10pt]">
            <thead className="bg-neutral-100">
              <tr>
                <th className="text-left">Proponent</th>
                {individual.map((cr) => <th key={cr.id}>{cr.criterion_name} ({usesRatingScale(cr) ? `${cr.weight_percentage}%` : `${cr.max_score} pts`})</th>)}
                <th>Indiv. %</th>
              </tr>
            </thead>
            <tbody>
              {c.students.map((s) => (
                <tr key={s.member.id}>
                  <td>{s.member.student_name}</td>
                  {individual.map((cr) => (
                    <td key={cr.id} className="text-center">{c.stats.find((x) => x.criterion.id === cr.id && x.student?.id === s.member.id)?.mean.toFixed(2)}</td>
                  ))}
                  <td className="text-center font-semibold">{s.individualPercent.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mb-1 font-bold">III. Final Ratings</h2>
          <table className="mb-2 text-[10pt]">
            <thead className="bg-neutral-100">
              <tr><th className="text-left">Proponent</th><th>Student No.</th><th>Final %</th><th>Grade</th><th>Remark</th></tr>
            </thead>
            <tbody>
              {c.students.map((s) => (
                <tr key={s.member.id}>
                  <td>{s.member.student_name}</td><td className="text-center">{s.member.student_number}</td>
                  <td className="text-center">{s.finalPercent.toFixed(2)}</td>
                  <td className="text-center font-bold">{s.transmuted.toFixed(2)}</td>
                  <td className="text-center">{s.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-3 text-[8pt] text-neutral-600">
            {group.some(usesRatingScale) && <>Rating scale: {RATING_SCALE.map((r) => `${r.percent} = ${r.band} ${r.label}`).join("; ")}. </>}
            Transmutation: {TRANSMUTATION_TABLE.filter((t) => t.min > 0).map((t) => `≥${t.min}=${t.grade.toFixed(2)}`).join(", ")}, below 75=5.00.
            Final % = Group % × {cfg.groupWeight}% + Individual % × {cfg.individualWeight}%, averaged across panel members.
          </p>

          <p className="border border-black p-2 text-center text-[12pt]">
            VERDICT: <b>{session.verdict ? VERDICT_LABEL[session.verdict].toUpperCase() : "PENDING"}</b>
          </p>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        {bundle.assignments.filter((a) => a.panel_role === "member").map((a) => (
          <SignatureBlock key={a.id} name={name(a.faculty_id)} role="Panel Member" signedAt={a.submitted_at} hash={a.signature_hash} />
        ))}
        {chair && <SignatureBlock name={name(chair.faculty_id)} role="Defense Chair" signedAt={session.locked_at} hash={session.chair_signature_hash} />}
      </div>
    </PrintShell>
  );
}
