"use client";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { TIME_ZONE } from "@/lib/utils";

export function PrintShell({ sessionId, draft, children }: { sessionId: string; draft: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <Button asChild variant="secondary" size="sm"><Link href={`/defense/${sessionId}`}><ArrowLeft /> Back to workspace</Link></Button>
        <div className="flex items-center gap-3">
          {draft && <span className="text-xs font-semibold text-red-700">DRAFT — session not yet locked</span>}
          <Button size="sm" onClick={() => window.print()}><Printer /> Print / Save as PDF</Button>
        </div>
      </div>
      <article className="paper relative mx-auto w-[210mm] max-w-full p-[16mm] text-[11pt] leading-snug shadow-xl">
        {draft && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span className="-rotate-30 text-[110pt] font-bold tracking-widest text-red-600/10">DRAFT</span>
          </div>
        )}
        {children}
      </article>
    </div>
  );
}

/** Document letterhead; the course line comes from the defense's course (program). */
export function DocHeader({ title, subtitle, programId }: { title: string; subtitle: string; programId?: string }) {
  const { state } = useStore();
  const program = state.programs.find((p) => p.id === programId);
  return (
    <header className="mb-5 text-center">
      <p className="text-[10pt] uppercase tracking-wide">Republic of the Philippines</p>
      <p className="font-bold uppercase">[Institution Name]</p>
      <p className="text-[10pt]">
        {program ? `${program.name} · Office of the ${program.project_term} Coordinator` : "Office of the Coordinator"}
      </p>
      <hr className="my-3 border-black" />
      <h1 className="text-[14pt] font-bold uppercase">{title}</h1>
      <p className="text-[10pt]">{subtitle}</p>
    </header>
  );
}

export function SignatureBlock({ name, role, signedAt, hash }: { name: string; role: string; signedAt?: string | null; hash?: string | null }) {
  return (
    <div className="break-inside-avoid pt-8 text-center text-[10pt]">
      <div className="mx-auto mb-1 h-6 font-mono text-[7pt] text-neutral-600">
        {hash ? `e-signed SHA-256: ${hash.slice(0, 32)}…` : ""}
      </div>
      <div className="mx-auto w-56 border-t border-black pt-1 font-bold uppercase">{name}</div>
      <div>{role}</div>
      <div className="text-[8pt] text-neutral-600">{signedAt ? new Date(signedAt).toLocaleString("en-PH", { timeZone: TIME_ZONE }) : "Date: ____________"}</div>
    </div>
  );
}

export function MetaTable({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="mb-4 text-[10pt]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}><th className="w-40 bg-neutral-100 text-left font-semibold">{k}</th><td>{v}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
