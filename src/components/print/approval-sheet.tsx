"use client";
import { joinAuthors } from "@/lib/admin";
import { consolidate, transmute } from "@/lib/grading";
import type { Viewer } from "@/lib/permissions";
import type { SessionBundle, User } from "@/lib/types";
import { TIME_ZONE } from "@/lib/utils";
import { PrintShell } from "./print-shell";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: TIME_ZONE });

/** A signature line with the printed name on it and the role underneath. */
function Sign({ name, role, className = "" }: { name: string; role: string; className?: string }) {
  return (
    <div className={`text-center ${className}`}>
      <div className="mx-auto flex h-8 w-[85mm] max-w-full items-end justify-center border-b border-black pb-0.5 font-bold uppercase">{name}</div>
      <div className="pt-1">{role}</div>
    </div>
  );
}

/**
 * Approval Sheet, following the BSIT-JHCSC-Dumingag template: recommended by the
 * adviser, approved by the defense panel with the grade, accepted by the Program Chair.
 */
export function ApprovalSheet({ bundle, userById }: { bundle: SessionBundle; viewer: Viewer; userById: (id: string) => User | undefined }) {
  const { session, project } = bundle;
  const name = (id: string | null | undefined) => (id ? userById(id)?.full_name ?? "" : "");
  const chair = bundle.assignments.find((a) => a.panel_role === "chair");
  const members = bundle.assignments.filter((a) => a.panel_role === "member");
  const authors = joinAuthors(bundle.members.map((m) => m.student_name));

  // The grade appears only once the Chair has locked the defense.
  let grade = "";
  if (session.is_locked) {
    const c = consolidate(bundle);
    if (c.students.length) grade = `${transmute(c.overallPercent).grade.toFixed(2)} (${c.overallPercent.toFixed(2)}%)`;
  }
  const approvedOn = session.is_locked && session.locked_at ? longDate(session.locked_at) : "";
  const blank = (value: string, width: string) =>
    value ? <span className="whitespace-nowrap border-b border-black px-1 font-semibold">{value}</span> : <span className={`inline-block border-b border-black ${width}`}>&nbsp;</span>;

  return (
    <PrintShell sessionId={session.id} draft={!session.is_locked}>
      <div className="text-[12pt] leading-[2]">
        <h1 className="mb-6 text-center text-[12pt] font-bold uppercase">Approval Sheet</h1>

        <p className="text-justify indent-[0.5in]">
          This capstone project study entitled <b>&ldquo;{project.title.toUpperCase()}&rdquo;</b> prepared and submitted
          by {authors}, has been examined and is recommended for approval and acceptance.
        </p>

        <p className="mt-6">RECOMMENDED:</p>
        <div className="mt-10 flex justify-start">
          <Sign name={name(project.adviser_id)} role="Adviser" className="w-[95mm]" />
        </div>

        <hr className="my-6 border-black" />

        <p className="text-justify indent-[0.5in]">
          APPROVED by the IT Project Defense Panel with a grade of {blank(grade, "w-[38mm]")} on {blank(approvedOn, "w-[50mm]")}.
        </p>

        <div className="mt-12 flex justify-center">
          <Sign name={name(chair?.faculty_id)} role="Chairman" className="w-[95mm]" />
        </div>
        <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-10">
          {(members.length ? members : [null, null]).map((a, i) => (
            <Sign key={a?.id ?? i} name={name(a?.faculty_id)} role="Panel Member" />
          ))}
        </div>

        <hr className="my-6 border-black" />

        <p className="text-justify indent-[0.5in]">
          ACCEPTED and APPROVED in partial fulfillment of the requirements for the degree, Bachelor of Science in Information Technology.
        </p>

        <div className="mt-12 flex justify-end">
          <div className="w-[95mm]">
            <div className="h-8 border-b border-black" />
            <p className="pt-1">Program Chair, BSIT-JHCSC-Dumingag</p>
            <p>Date: <span className="inline-block w-[55mm] border-b border-black">&nbsp;</span></p>
          </div>
        </div>
      </div>
    </PrintShell>
  );
}
