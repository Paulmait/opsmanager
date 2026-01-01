/**
 * Formatting utilities for dates and text.
 */

/**
 * Format a date as a relative time string (e.g., "2 hours ago").
 */
export function formatDistanceToNow(date: string | Date): string {
  const now = new Date();
  const target = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - target.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMs < 0) {
    // Future date
    const absDiffDays = Math.abs(diffDays);
    if (absDiffDays === 0) return "today";
    if (absDiffDays === 1) return "tomorrow";
    if (absDiffDays < 7) return `in ${absDiffDays} days`;
    if (absDiffDays < 30) return `in ${Math.ceil(absDiffDays / 7)} weeks`;
    return `in ${Math.ceil(absDiffDays / 30)} months`;
  }

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return target.toLocaleDateString();
}

/**
 * Format a date as a readable string.
 */
export function formatDate(date: string | Date): string {
  const target = typeof date === "string" ? new Date(date) : date;
  return target.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date with time.
 */
export function formatDateTime(date: string | Date): string {
  const target = typeof date === "string" ? new Date(date) : date;
  return target.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Truncate a string with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
