import * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn "native-select": styled <select>, accessible and form-friendly. */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-input bg-background/60 px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 [&>option]:bg-card",
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
export { NativeSelect };
