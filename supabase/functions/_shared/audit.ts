/**
 * Audit logging utilities for Edge Functions
 *
 * SECURITY:
 * - All function invocations logged to audit_logs table
 * - Immutable audit trail (table has append-only trigger)
 * - Captures context, inputs, and outcomes
 */

import { createAdminClient } from "./auth.ts";

// =============================================================================
// Types
// =============================================================================

export interface AuditLogEntry {
  organization_id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Audit Functions
// =============================================================================

/**
 * Log an action to the audit trail.
 *
 * SECURITY:
 * - Uses admin client to bypass RLS
 * - Table has triggers preventing modification
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("audit_logs").insert({
    organization_id: entry.organization_id,
    actor_id: entry.actor_id,
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    // Log error but don't fail the operation
    console.error("Failed to write audit log:", error.message);
  }
}

/**
 * Log Edge Function invocation start.
 */
export async function logFunctionStart(
  functionName: string,
  orgId: string,
  userId: string,
  input: unknown
): Promise<void> {
  await logAudit({
    organization_id: orgId,
    actor_id: userId,
    action: `edge_function.${functionName}.start`,
    resource_type: "edge_function",
    metadata: {
      function: functionName,
      input_summary: summarizeInput(input),
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log Edge Function invocation success.
 */
export async function logFunctionSuccess(
  functionName: string,
  orgId: string,
  userId: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAudit({
    organization_id: orgId,
    actor_id: userId,
    action: `edge_function.${functionName}.success`,
    resource_type: "edge_function",
    resource_id: resourceId,
    metadata: {
      function: functionName,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log Edge Function invocation failure.
 */
export async function logFunctionError(
  functionName: string,
  orgId: string,
  userId: string,
  error: Error | string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAudit({
    organization_id: orgId,
    actor_id: userId,
    action: `edge_function.${functionName}.error`,
    resource_type: "edge_function",
    metadata: {
      function: functionName,
      error: typeof error === "string" ? error : error.message,
      error_type: typeof error === "string" ? "string" : error.name,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log rate limit exceeded.
 */
export async function logRateLimitExceeded(
  functionName: string,
  orgId: string,
  userId: string,
  limits: { current: number; max: number; type: string }
): Promise<void> {
  await logAudit({
    organization_id: orgId,
    actor_id: userId,
    action: `edge_function.${functionName}.rate_limit`,
    resource_type: "edge_function",
    metadata: {
      function: functionName,
      limit_type: limits.type,
      current: limits.current,
      max: limits.max,
      timestamp: new Date().toISOString(),
    },
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a safe summary of input for logging.
 * Truncates large values and redacts sensitive fields.
 */
function summarizeInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input !== "object") {
    return input;
  }

  const sensitiveFields = [
    "password",
    "secret",
    "token",
    "api_key",
    "apiKey",
    "authorization",
    "credit_card",
    "ssn",
  ];

  const summary: Record<string, unknown> = {};
  const obj = input as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    // Redact sensitive fields
    if (sensitiveFields.some((f) => key.toLowerCase().includes(f))) {
      summary[key] = "[REDACTED]";
      continue;
    }

    // Truncate long strings
    if (typeof value === "string" && value.length > 100) {
      summary[key] = value.substring(0, 100) + "...";
      continue;
    }

    // Summarize arrays
    if (Array.isArray(value)) {
      summary[key] = `[Array(${value.length})]`;
      continue;
    }

    // Recursively summarize nested objects (one level)
    if (typeof value === "object" && value !== null) {
      summary[key] = "[Object]";
      continue;
    }

    summary[key] = value;
  }

  return summary;
}
