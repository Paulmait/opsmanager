"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, error, ...props }, ref) => {
    return (
      <select
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus:ring-destructive",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
