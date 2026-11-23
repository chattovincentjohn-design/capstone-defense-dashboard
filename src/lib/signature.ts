/**
 * E-signature hashing. Mirrors `submit_evaluation()` / `finalize_defense()` in SQL
 * so a hash stored by Postgres can be re-verified in the browser:
 *
 *   SHA-256( user_id | ISO-8601 UTC ms timestamp | canonical payload )
 *
 * Canonical score payload = "criterion_id:student_id|group:score(2dp)" joined by ",",
 * ordered by criterion_id then student_id (group first).
 */
import type { RubricScore } from "./types";

export function canonicalScorePayload(scores: RubricScore[]): string {
  return [...scores]
    .sort((a, b) =>
      a.criterion_id === b.criterion_id
        ? (a.student_id ?? "").localeCompare(b.student_id ?? "")
        : a.criterion_id.localeCompare(b.criterion_id),
    )
    .map((s) => `${s.criterion_id}:${s.student_id ?? "group"}:${s.score.toFixed(2)}`)
    .join(",");
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signEvaluation(userId: string, timestampIso: string, scores: RubricScore[]) {
  return sha256Hex(`${userId}|${timestampIso}|${canonicalScorePayload(scores)}`);
}

export async function signFinalization(chairId: string, timestampIso: string, verdict: string, panelHashes: string[]) {
  return sha256Hex(`${chairId}|${timestampIso}|${verdict}|${panelHashes.join(",")}`);
}

export async function verifyEvaluation(hash: string, userId: string, timestampIso: string, scores: RubricScore[]) {
  return (await signEvaluation(userId, timestampIso, scores)) === hash;
}

export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—");
