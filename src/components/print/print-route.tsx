"use client";
import { useDefenseSession } from "@/lib/store";
import { MinutesDocument } from "./minutes-document";
import { RatingSheet } from "./rating-sheet";

export function PrintRoute({ sessionId, doc }: { sessionId: string; doc: "minutes" | "rating-sheet" }) {
  const { bundle, viewer, userById, hydrated } = useDefenseSession(sessionId);
  if (!hydrated) return <p className="p-10 text-center text-sm">Preparing document…</p>;
  if (!bundle || !viewer) return <p className="p-10 text-center">Session not found.</p>;
  return doc === "minutes"
    ? <MinutesDocument bundle={bundle} viewer={viewer} userById={userById} />
    : <RatingSheet bundle={bundle} viewer={viewer} userById={userById} />;
}
