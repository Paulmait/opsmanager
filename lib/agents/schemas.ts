import { z } from "zod";

/**
 * Agent Schemas
 *
 * Strict JSON schemas for agent inputs/outputs.
 * All agent outputs MUST pass validation or be rejected.
 */

// =============================================================================
// Risk & Confidence Levels
// =============================================================================

export const RiskLevel = z.enum(["none", "low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ConfidenceLevel = z.enum(["very_low", "low", "medium", "high", "very_high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

// Numeric mappings for comparisons
export const RISK_SCORES: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = {
  very_low: 1,
  low: 2,
  medium: 3,
  high: 4,
  very_high: 5,
};

// =============================================================================
// Tool Definitions (Allowlist)
// =============================================================================

/**
 * SECURITY: Only these tools are allowed.
 * Adding new tools requires code changes.
 */
export const AllowedTool = z.enum([
  // Communication
  "send_email",
  "send_slack_message",
  "schedule_meeting",

  // Document operations
  "create_document",
  "update_document",
  "read_document",

  // CRM operations
  "create_contact",
  "update_contact",
  "search_contacts",

  // Task operations
  "create_task",
  "update_task",
  "complete_task",

  // Calendar operations
  "get_availability",
  "book_slot",

  // Read-only operations (low risk)
  "search_emails",
  "get_calendar_events",
  "get_org_settings",
]);
export type AllowedTool = z.infer<typeof AllowedTool>;

// Tool metadata for risk assessment
export const TOOL_RISK_LEVELS: Record<AllowedTool, RiskLevel> = {
  // High risk - external communication
  send_email: "high",
  send_slack_message: "medium",
  schedule_meeting: "medium",

  // Medium risk - document mutations
  create_document: "medium",
  update_document: "medium",
  read_document: "low",

  // Medium risk - CRM mutations
  create_contact: "low",
  update_contact: "medium",
  search_contacts: "none",

  // Low risk - task operations
  create_task: "low",
  update_task: "low",
  complete_task: "low",

  // Medium risk - calendar mutations
  get_availability: "none",
  book_slot: "medium",

  // No risk - read-only
  search_emails: "none",
  get_calendar_events: "none",
  get_org_settings: "none",
};

// =============================================================================
// Tool Call Schema
// =============================================================================

export const ToolCallSchema = z.object({
  id: z.string().uuid().optional(),
  tool: AllowedTool,
  parameters: z.record(z.unknown()),
  reason: z.string().min(1, "Reason is required"),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// =============================================================================
// Planner Output Schema
// =============================================================================

export const PlanActionSchema = z.object({
  step: z.number().int().positive(),
  description: z.string().min(1),
  tool_calls: z.array(ToolCallSchema),
  depends_on: z.array(z.number().int().positive()).optional(),
  estimated_risk: RiskLevel,
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlannerOutputSchema = z.object({
  goal: z.string().min(1, "Goal is required"),
  reasoning: z.string().min(1, "Reasoning is required"),
  actions: z.array(PlanActionSchema).min(1, "At least one action is required"),
  overall_risk: RiskLevel,
  confidence: ConfidenceLevel,
  requires_approval: z.boolean(),
  approval_reason: z.string().optional(),
  estimated_duration_seconds: z.number().positive().optional(),
  warnings: z.array(z.string()).optional(),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// =============================================================================
// Validator Output Schema
// =============================================================================

export const ValidationResultSchema = z.object({
  is_valid: z.boolean(),
  requires_approval: z.boolean(),
  risk_assessment: z.object({
    overall_risk: RiskLevel,
    risk_factors: z.array(z.string()),
    mitigations: z.array(z.string()).optional(),
  }),
  confidence_check: z.object({
    meets_threshold: z.boolean(),
    actual_confidence: ConfidenceLevel,
    required_confidence: ConfidenceLevel,
  }),
  policy_violations: z.array(
    z.object({
      policy: z.string(),
      violation: z.string(),
      severity: z.enum(["warning", "error", "critical"]),
    })
  ),
  approved_actions: z.array(z.number().int().positive()),
  blocked_actions: z.array(
    z.object({
      step: z.number().int().positive(),
      reason: z.string(),
    })
  ),
  decision: z.enum(["approve", "require_human_approval", "reject"]),
  decision_reason: z.string(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// =============================================================================
// Writer Output Schema
// =============================================================================

export const DraftContentSchema = z.object({
  type: z.enum(["email", "slack_message", "document", "calendar_invite"]),
  subject: z.string().optional(),
  body: z.string().min(1, "Body is required"),
  recipients: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type DraftContent = z.infer<typeof DraftContentSchema>;

export const WriterOutputSchema = z.object({
  draft: DraftContentSchema,
  alternatives: z.array(DraftContentSchema).optional(),
  tone: z.enum(["formal", "casual", "professional", "friendly"]),
  confidence: ConfidenceLevel,
  suggestions: z.array(z.string()).optional(),
  word_count: z.number().int().positive(),
  estimated_read_time_seconds: z.number().int().positive().optional(),
});
export type WriterOutput = z.infer<typeof WriterOutputSchema>;

// =============================================================================
// Agent Run Context
// =============================================================================

export const AgentContextSchema = z.object({
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  conversation_id: z.string().uuid().optional(),
  preferences: z.record(z.unknown()).optional(),
  recent_actions: z.array(z.string()).optional(),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

// =============================================================================
// Agent Run Record
// =============================================================================

export const AgentRunRecordSchema = z.object({
  id: z.string().uuid(),
  agent_type: z.enum(["planner", "validator", "writer"]),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  tokens_used: z.number().int().nonnegative().nullable(),
  cost_cents: z.number().int().nonnegative().nullable(),
});
export type AgentRunRecord = z.infer<typeof AgentRunRecordSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

export class SchemaValidationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly errors: z.ZodError
  ) {
    super(`Schema validation failed for ${schemaName}: ${errors.message}`);
    this.name = "SchemaValidationError";
  }
}

/**
 * Validate data against a schema, throwing on failure.
 */
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  schemaName: string
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new SchemaValidationError(schemaName, result.error);
  }

  return result.data;
}

/**
 * Safely parse JSON and validate against schema.
 */
export function parseAndValidate<T>(
  schema: z.ZodSchema<T>,
  jsonString: string,
  schemaName: string
): T {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Invalid JSON in ${schemaName}: ${error}`);
  }

  return validateSchema(schema, parsed, schemaName);
}
