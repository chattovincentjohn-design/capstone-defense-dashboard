"use client";
import * as React from "react";
import type { PanelAssignment } from "../types";
import { createClient } from "./client";

/**
 * Live panel submission status for the Chair / header indicators.
 * Subscribes to panel_assignments, defense_sessions, defense_minutes and panel_comments
 * for one session (RLS applies to postgres_changes payloads).
 */
export function useSessionRealtime(sessionId: string, onChange: (table: string, row: unknown) => void) {
  React.useEffect(() => {
    const sb = createClient();
    const channel = sb.channel(`defense:${sessionId}`);
    for (const table of ["panel_assignments", "panel_comments", "defense_minutes"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `session_id=eq.${sessionId}` },
        (p) => onChange(table, p.new));
    }
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "defense_sessions", filter: `id=eq.${sessionId}` },
      (p) => onChange("defense_sessions", p.new));
    channel.subscribe();
    return () => { sb.removeChannel(channel); };
  }, [sessionId, onChange]);
}

export function usePanelStatus(sessionId: string, initial: PanelAssignment[]) {
  const [assignments, setAssignments] = React.useState(initial);
  const onChange = React.useCallback((table: string, row: unknown) => {
    if (table !== "panel_assignments") return;
    const r = row as PanelAssignment;
    setAssignments((xs) => xs.map((a) => (a.id === r.id ? r : a)));
  }, []);
  useSessionRealtime(sessionId, onChange);
  return assignments;
}
