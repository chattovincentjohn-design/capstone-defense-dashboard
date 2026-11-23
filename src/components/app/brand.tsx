import Image from "next/image";
import { cn } from "@/lib/utils";

/** JHCSC School of Computing Studies seal. */
export function BrandLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image src="/scs-logo.png" alt="JHCSC School of Computing Studies" width={size} height={size}
      className={cn("shrink-0 rounded-full", className)} priority />
  );
}


export const APP_YEAR = 2026;
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";

/** Credit line shown at the bottom of every screen (hidden when printing). */
export function AppFooter() {
  return (
    <footer className="no-print px-4 py-4 text-center text-xs text-muted-foreground">
      © {APP_YEAR} · Designed and Developed by <span className="font-semibold text-foreground">VENOUTZ</span> · Version {APP_VERSION}
    </footer>
  );
}
