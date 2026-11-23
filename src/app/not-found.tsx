import Link from "next/link";
import { BrandLogo } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Page not found · CDEMS" };

export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-md px-4">
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <BrandLogo size={80} />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">JHCSC · School of Computing Studies</p>
      </div>
      <Card>
        <CardContent className="space-y-4 p-6 text-center">
          <div>
            <p className="text-3xl font-bold">404</p>
            <p className="font-semibold">This page could not be found.</p>
            <p className="mt-1 text-sm text-muted-foreground">The link may be mistyped or out of date. Pick where you want to go:</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild><Link href="/">CDEMS home (my defenses)</Link></Button>
            <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
            <Button asChild variant="outline"><Link href="/register">Group registration</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
