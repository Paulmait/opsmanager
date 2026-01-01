/**
 * Structured logging utility for server-side code.
 *
 * In development: Pretty-printed JSON to console
 * In production: Structured JSON for log aggregation services
 *
 * Usage:
 * ```ts
 * import { logger } from "@/lib/logger";
 *
 * logger.info("User logged in", { userId: "123", org: "acme" });
 * logger.error("Failed to process", { error: err.message });
 * ```
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

const isDev = process.env.NODE_ENV === "development";

function formatLog(entry: LogEntry): string {
  if (isDev) {
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    return `[${entry.level.toUpperCase()}] ${entry.message}${ctx}`;
  }
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context !== undefined && { context }),
  };

  const formatted = formatLog(entry);

  switch (level) {
    case "debug":
      if (isDev) console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    log("debug", message, context),
  info: (message: string, context?: LogContext) =>
    log("info", message, context),
  warn: (message: string, context?: LogContext) =>
    log("warn", message, context),
  error: (message: string, context?: LogContext) =>
    log("error", message, context),
};

/**
 * Create a child logger with preset context.
 *
 * @example
 * ```ts
 * const authLogger = createLogger({ module: "auth" });
 * authLogger.info("Login attempt", { email: "..." });
 * // Output: { module: "auth", email: "..." }
 * ```
 */
export function createLogger(baseContext: LogContext) {
  return {
    debug: (message: string, context?: LogContext) =>
      log("debug", message, { ...baseContext, ...context }),
    info: (message: string, context?: LogContext) =>
      log("info", message, { ...baseContext, ...context }),
    warn: (message: string, context?: LogContext) =>
      log("warn", message, { ...baseContext, ...context }),
    error: (message: string, context?: LogContext) =>
      log("error", message, { ...baseContext, ...context }),
  };
}
