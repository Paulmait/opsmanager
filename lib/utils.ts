import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility for constructing className strings conditionally.
 * Combines clsx for conditional classes with tailwind-merge for deduplication.
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-primary", className)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
