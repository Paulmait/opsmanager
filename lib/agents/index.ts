/**
 * Agent Core Module
 *
 * Exports all agent functionality for use in the application.
 *
 * Architecture:
 * - Planner: Creates execution plans with actions and tool calls
 * - Validator: Checks plans against policies and risk thresholds
 * - Writer: Produces content drafts (emails, messages, documents)
 *
 * Security:
 * - All outputs validated against strict Zod schemas
 * - Tool execution limited to allowlist
 * - Confidence thresholds trigger approval requirements
 * - All runs logged to audit_logs
 */

// Schemas and types
export * from "./schemas";

// Base agent
export { BaseAgent, registerAgent, getAgent, type AgentType } from "./base";

// Agent implementations
export { PlannerAgent, plannerAgent, type PlannerInput } from "./planner";
export { ValidatorAgent, validatorAgent, type ValidatorInput } from "./validator";
export { WriterAgent, writerAgent, type WriterInput } from "./writer";

// Memory system
export {
  getOrgMemory,
  getOrgSettings,
  recordAction,
  setOrgPreference,
  getRecentActions,
  buildAgentContext,
  invalidateOrgMemory,
  clearMemoryCache,
  type OrgMemory,
  type OrgSettings,
  type RecentAction,
} from "./memory";

// Tool execution
export {
  executeTool,
  executeToolCalls,
  validateToolCalls,
  getToolInfo,
  type ToolExecutionResult,
  type ToolContext,
} from "./tools";

// =============================================================================
// Convenience Functions
// =============================================================================

import { plannerAgent } from "./planner";
import { validatorAgent } from "./validator";
import { writerAgent } from "./writer";
import { buildAgentContext } from "./memory";
import type { AgentContext, PlannerOutput, ValidationResult, WriterOutput } from "./schemas";
import type { PlannerInput } from "./planner";
import type { WriterInput } from "./writer";

/**
 * Run the full agent pipeline: Plan -> Validate -> Execute
 */
export async function runAgentPipeline(
  orgId: string,
  userId: string,
  goal: string,
  options: {
    taskId?: string;
    constraints?: string[];
    autoApprove?: boolean;
  } = {}
): Promise<{
  plan: PlannerOutput | null;
  validation: ValidationResult | null;
  approved: boolean;
  requiresApproval: boolean;
  error: string | null;
}> {
  // Build context
  const context = await buildAgentContext(orgId, userId, options.taskId);

  // Step 1: Plan
  const planResult = await plannerAgent.run({
    context: context as AgentContext,
    input: {
      goal,
      constraints: options.constraints,
      max_actions: 10,
      urgency: "normal",
    },
  });

  if (!planResult.success || !planResult.output) {
    return {
      plan: null,
      validation: null,
      approved: false,
      requiresApproval: false,
      error: planResult.error ?? "Planning failed",
    };
  }

  const plan = planResult.output;

  // Step 2: Validate
  const validationResult = await validatorAgent.run({
    context: context as AgentContext,
    input: {
      plan,
    },
  });

  if (!validationResult.success || !validationResult.output) {
    return {
      plan,
      validation: null,
      approved: false,
      requiresApproval: false,
      error: validationResult.error ?? "Validation failed",
    };
  }

  const validation = validationResult.output;

  // Determine if approved
  const approved =
    validation.decision === "approve" ||
    (validation.decision === "require_human_approval" &&
      options.autoApprove === true);

  return {
    plan,
    validation,
    approved,
    requiresApproval: validation.decision === "require_human_approval",
    error: validation.decision === "reject" ? validation.decision_reason : null,
  };
}

/**
 * Generate content using the Writer agent.
 */
export async function generateContent(
  orgId: string,
  userId: string,
  input: WriterInput
): Promise<{
  draft: WriterOutput | null;
  error: string | null;
}> {
  const context = await buildAgentContext(orgId, userId);

  const result = await writerAgent.run({
    context: context as AgentContext,
    input,
  });

  if (!result.success || !result.output) {
    return {
      draft: null,
      error: result.error ?? "Content generation failed",
    };
  }

  return {
    draft: result.output,
    error: null,
  };
}
