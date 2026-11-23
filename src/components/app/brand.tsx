import Image from "next/image";
import { cn } from "@/lib/utils";

/** JHCSC School of Computing Studies seal. */
export function BrandLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image src="/scs-logo.png" alt="JHCSC School of Computing Studies" width={size} height={size}
      className={cn("shrink-0 rounded-full", className)} priority />
  );
}

