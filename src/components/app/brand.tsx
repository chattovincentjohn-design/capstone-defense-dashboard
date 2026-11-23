import Image from "next/image";
import { cn } from "@/lib/utils";

/** JHCSC School of Computing Studies seal. */
export function BrandLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image src="/scs-logo.png" alt="JHCSC School of Computing Studies" width={size} height={size}
      className={cn("shrink-0 rounded-full", className)} priority />
  );
}

/** Maroon strip that carries the school identity across every screen. */
export function BrandStrip() {
  return (
    <div className="no-print bg-primary px-4 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground">
      JHCSC · School of Computing Studies
    </div>
  );
}
