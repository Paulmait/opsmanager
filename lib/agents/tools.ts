import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import {
  type AllowedTool,
  type ToolCall,
  AllowedTool as AllowedToolSchema,
  TOOL_RISK_LEVELS,
} from "./schemas";

const logger = createLogger({ module: "agent-tools" });

// =============================================================================
// Types
// =============================================================================

export interface ToolExecutionResult {
  success: boolean;
  tool: AllowedTool;
  output: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface ToolContext {
  organizationId: string;
  userId: string;
  approvalId?: string;
  dryRun?: boolean;
}

// Tool handler function type
type ToolHandler = (
  parameters: Record<string, unknown>,
  context: ToolContext
) => Promise<unknown>;

// =============================================================================
// Tool Registry (Allowlist)
// =============================================================================

/**
 * SECURITY: This is the ONLY place where tool handlers are defined.
 * Adding new tools requires explicit code changes.
 * No dynamic tool loading is allowed.
 */
const TOOL_HANDLERS: Record<AllowedTool, ToolHandler> = {
  // Communication tools
  send_email: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", would_send_to: params.to };
    }
    // In production, integrate with email provider
    logger.info("Would send email", { to: params.to, subject: params.subject });
    return { status: "queued", message_id: `msg_${Date.now()}` };
  },

  send_slack_message: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", channel: params.channel };
    }
    logger.info("Would send Slack message", { channel: params.channel });
    return { status: "sent", timestamp: Date.now() };
  },

  schedule_meeting: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", attendees: params.attendees };
    }
    logger.info("Would schedule meeting", { ...params });
    return { status: "scheduled", event_id: `evt_${Date.now()}` };
  },

  // Document tools
  create_document: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", title: params.title };
    }
    logger.info("Would create document", { title: params.title });
    return { status: "created", document_id: `doc_${Date.now()}` };
  },

  update_document: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", document_id: params.document_id };
    }
    logger.info("Would update document", { id: params.document_id });
    return { status: "updated", document_id: params.document_id };
  },

  read_document: async (params, _ctx) => {
    // Read-only, always safe
    logger.info("Reading document", { id: params.document_id });
    return { content: "Document content would be here", format: "markdown" };
  },

  // CRM tools
  create_contact: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", email: params.email };
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        organization_id: ctx.organizationId,
        email: params.email as string,
        full_name: params.name as string,
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create contact: ${error.message}`);
    }

    return { status: "created", contact_id: data.id };
  },

  update_contact: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", contact_id: params.contact_id };
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("contacts")
      .update({
        full_name: params.name as string | undefined,
        email: params.email as string | undefined,
      })
      .eq("id", params.contact_id)
      .eq("organization_id", ctx.organizationId);

    if (error) {
      throw new Error(`Failed to update contact: ${error.message}`);
    }

    return { status: "updated", contact_id: params.contact_id };
  },

  search_contacts: async (params, ctx) => {
    const supabase = createAdminClient();
    const query = params.query as string;

    const { data, error } = await supabase
      .from("contacts")
      .select("id, email, full_name")
      .eq("organization_id", ctx.organizationId)
      .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
      .limit(10);

    if (error) {
      throw new Error(`Failed to search contacts: ${error.message}`);
    }

    return { contacts: data ?? [], count: data?.length ?? 0 };
  },

  // Task tools
  create_task: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", title: params.title };
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        organization_id: ctx.organizationId,
        title: params.title as string,
        description: params.description as string | undefined,
        priority: (params.priority as string) ?? "medium",
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create task: ${error.message}`);
    }

    return { status: "created", task_id: data.id };
  },

  update_task: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", task_id: params.task_id };
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        title: params.title as string | undefined,
        status: params.status as string | undefined,
        priority: params.priority as string | undefined,
      })
      .eq("id", params.task_id)
      .eq("organization_id", ctx.organizationId);

    if (error) {
      throw new Error(`Failed to update task: ${error.message}`);
    }

    return { status: "updated", task_id: params.task_id };
  },

  complete_task: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", task_id: params.task_id };
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", params.task_id)
      .eq("organization_id", ctx.organizationId);

    if (error) {
      throw new Error(`Failed to complete task: ${error.message}`);
    }

    return { status: "completed", task_id: params.task_id };
  },

  // Calendar tools
  get_availability: async (_params, _ctx) => {
    // In production, integrate with calendar API
    return {
      available_slots: [
        { start: "2024-01-15T09:00:00Z", end: "2024-01-15T10:00:00Z" },
        { start: "2024-01-15T14:00:00Z", end: "2024-01-15T15:00:00Z" },
      ],
    };
  },

  book_slot: async (params, ctx) => {
    if (ctx.dryRun) {
      return { status: "dry_run", slot: params.start };
    }
    logger.info("Would book slot", { start: params.start, end: params.end });
    return { status: "booked", event_id: `cal_${Date.now()}` };
  },

  // Read-only tools
  search_emails: async (params, _ctx) => {
    // In production, integrate with email provider
    return {
      emails: [],
      query: params.query,
      message: "Email search not yet implemented",
    };
  },

  get_calendar_events: async (_params, _ctx) => {
    return {
      events: [],
      message: "Calendar integration not yet implemented",
    };
  },

  get_org_settings: async (_params, ctx) => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("organizations")
      .select("id, name, created_at")
      .eq("id", ctx.organizationId)
      .single();

    return { organization: data };
  },
};

// =============================================================================
// Tool Executor
// =============================================================================

/**
 * Execute a tool call with full safety checks.
 *
 * SECURITY:
 * - Only executes tools from the allowlist
 * - Validates tool name against enum
 * - Logs all executions
 * - Supports dry run mode
 */
export async function executeTool(
  toolCall: ToolCall,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const startTime = Date.now();

  // Validate tool is in allowlist
  const toolValidation = AllowedToolSchema.safeParse(toolCall.tool);
  if (!toolValidation.success) {
    logger.error("Attempted to execute non-allowed tool", {
      tool: toolCall.tool,
      orgId: context.organizationId,
    });

    return {
      success: false,
      tool: toolCall.tool,
      output: null,
      error: `Tool "${toolCall.tool}" is not in the allowlist`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const tool = toolValidation.data;
  const handler = TOOL_HANDLERS[tool];

  // Log execution attempt
  logger.info("Executing tool", {
    tool,
    risk: TOOL_RISK_LEVELS[tool],
    orgId: context.organizationId,
    userId: context.userId,
    dryRun: context.dryRun ?? false,
  });

  try {
    const output = await handler(toolCall.parameters, context);

    // Log successful execution
    await logToolExecution(tool, context, true);

    return {
      success: true,
      tool,
      output,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("Tool execution failed", {
      tool,
      error: errorMessage,
      orgId: context.organizationId,
    });

    // Log failed execution
    await logToolExecution(tool, context, false, errorMessage);

    return {
      success: false,
      tool,
      output: null,
      error: errorMessage,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute multiple tool calls in sequence.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  for (const toolCall of toolCalls) {
    const result = await executeTool(toolCall, context);
    results.push(result);

    // Stop on first failure unless dry run
    if (!result.success && !context.dryRun) {
      break;
    }
  }

  return results;
}

/**
 * Validate that all tool calls in a list are allowed.
 */
export function validateToolCalls(
  toolCalls: ToolCall[]
): { valid: boolean; invalidTools: string[] } {
  const invalidTools: string[] = [];

  for (const toolCall of toolCalls) {
    const validation = AllowedToolSchema.safeParse(toolCall.tool);
    if (!validation.success) {
      invalidTools.push(toolCall.tool);
    }
  }

  return {
    valid: invalidTools.length === 0,
    invalidTools,
  };
}

/**
 * Get tool metadata.
 */
export function getToolInfo(tool: AllowedTool): {
  name: AllowedTool;
  risk: string;
  category: string;
} {
  const categories: Record<string, AllowedTool[]> = {
    communication: ["send_email", "send_slack_message", "schedule_meeting"],
    documents: ["create_document", "update_document", "read_document"],
    crm: ["create_contact", "update_contact", "search_contacts"],
    tasks: ["create_task", "update_task", "complete_task"],
    calendar: ["get_availability", "book_slot"],
    readonly: ["search_emails", "get_calendar_events", "get_org_settings"],
  };

  let category = "unknown";
  for (const [cat, tools] of Object.entries(categories)) {
    if (tools.includes(tool)) {
      category = cat;
      break;
    }
  }

  return {
    name: tool,
    risk: TOOL_RISK_LEVELS[tool],
    category,
  };
}

// =============================================================================
// Audit Logging
// =============================================================================

async function logToolExecution(
  tool: AllowedTool,
  context: ToolContext,
  success: boolean,
  error?: string
): Promise<void> {
  const supabase = createAdminClient();

  await supabase.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: `tool.${tool}`,
    resource_type: "tool_execution",
    resource_id: context.approvalId,
    metadata: {
      tool,
      success,
      error,
      dry_run: context.dryRun ?? false,
    },
  });
}
