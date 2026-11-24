"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDefenseSession } from "@/lib/store";
import { MinutesDocument } from "./minutes-document";
import { RatingSheet } from "./rating-sheet";

export function PrintRoute({ sessionId, doc }: { sessionId: string; doc: "minutes" | "rating-sheet" }) {
  const { bundle, viewer, userById, hydrated } = useDefenseSession(sessionId);
  if (!hydrated) return <p className="p-10 text-center text-sm">Preparing document…</p>;
  if (!bundle || !viewer) {
    return (
      <div className="mx-auto my-16 max-w-md px-4">
        <Card>
          <CardContent className="space-y-3 p-6 text-center text-sm">
            <p className="text-base font-semibold">This defense could not be found</p>
            <p className="text-muted-foreground">
              The link may be incomplete, the defense may have been deleted, or you are not assigned to it.
              Open the defense from your dashboard and use its Rating Sheet or Minutes button.
            </p>
            <Button asChild className="w-full"><Link href="/">Go to my dashboard</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  return doc === "minutes"
    ? <MinutesDocument bundle={bundle} viewer={viewer} userById={userById} />
    : <RatingSheet bundle={bundle} viewer={viewer} userById={userById} />;
}
