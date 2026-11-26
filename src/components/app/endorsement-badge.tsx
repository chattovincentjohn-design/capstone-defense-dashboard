"use client";
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import type { EndorsementStatus, GroupRegistration } from "@/lib/types";

export const ENDORSEMENT_LABEL: Record<EndorsementStatus, string> = {
  none: "No endorsement (registered earlier)",
  pending: "Endorsement: waiting for adviser",
  verified: "Endorsement verified by adviser",
  returned: "Endorsement returned by adviser",
};
const VARIANT: Record<EndorsementStatus, "muted" | "warning" | "success" | "destructive"> = {
  none: "muted", pending: "warning", verified: "success", returned: "destructive",
};

export function EndorsementBadge({ status }: { status: EndorsementStatus }) {
  return <Badge variant={VARIANT[status]}>{ENDORSEMENT_LABEL[status]}</Badge>;
}

/** Opens the uploaded endorsement in a new tab through a short-lived private link. */
export function OpenEndorsementButton({ reg }: { reg: Pick<GroupRegistration, "endorsement_path" | "group_label"> }) {
  const { ops } = useStore();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!reg.endorsement_path) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
        // Open the tab first (popup blockers), then point it at the signed link.
        const tab = window.open("", "_blank");
        setBusy(true); setError(null);
        try {
          const url = await ops.endorsementLink(reg.endorsement_path);
          if (tab) tab.location.href = url; else window.location.assign(url);
        } catch (e) {
          tab?.close();
          setError(e instanceof Error ? e.message : String(e));
        } finally { setBusy(false); }
      }}>
        <ExternalLink /> {busy ? "Opening…" : "View endorsement"}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
