/**
 * approve_action Edge Function
 *
 * Handles approval/rejection of pending agent actions.
 *
 * SECURITY:
 * - Verifies caller authentication and org membership
 * - Requires admin role for approvals
 * - Validates approval belongs to caller's org
 * - Enforces action rate limits before execution
 * - Logs all decisions to audit trail
 *
 * Endpoint: POST /functions/v1/approve-action
 * Headers:
 *   - Authorization: Bearer <jwt>
 * Body: { approval_id, decision, reason? }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  z,
  verifyAuth,
  verifyOrgMembership,
  requireRole,
  validateBody,
  ValidationError,
  AuthError,
  checkActionLimit,
  checkAndIncrementUsage,
  logFunctionStart,
  logFunctionSuccess,
  logFunctionError,
  logRateLimitExceeded,
  logAudit,
  successResponse,
  errorResponse,
  handleCors,
  rateLimitResponse,
  createAdminClient,
} from "../_shared/index.ts";

// =============================================================================
// Input Schema
// =============================================================================

const ApproveActionInputSchema = z.object({
  approval_id: z.string().uuid("Invalid approval ID"),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
  execute_immediately: z.boolean().default(true),
});

type ApproveActionInput = z.infer<typeof ApproveActionInputSchema>;

// =============================================================================
// Response Types
// =============================================================================

interface ApprovalResponse {
  approval_id: string;
  status: "approved" | "rejected" | "executed" | "execution_failed";
  decision_by: string;
  decided_at: string;
  execution_results?: Array<{
    tool: string;
    success: boolean;
    output?: unknown;
    error?: string;
  }>;
  error?: string;
}

// =============================================================================
// Handler
// =============================================================================

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCors();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let orgId = "";
  let userId = "";

  try {
    // Step 1: Authenticate caller
    const auth = await verifyAuth(req);
    userId = auth.userId;

    // Step 2: Validate input
    const input = await validateBody(req, ApproveActionInputSchema);

    // Step 3: Fetch approval and verify ownership
    const supabase = createAdminClient();

    const { data: approval, error: fetchError } = await supabase
      .from("approvals")
      .select(
        `
        id,
        organization_id,
        agent_run_id,
        requested_actions,
        risk_level,
        status,
        requested_by,
        expires_at
      `
      )
      .eq("id", input.approval_id)
      .single();

    if (fetchError || !approval) {
      return errorResponse("Approval not found", 404);
    }

    orgId = approval.organization_id;

    // Step 4: Verify org membership and admin role
    const orgAuth = await verifyOrgMembership(auth, orgId);
    requireRole(orgAuth, "admin"); // Only admins can approve actions

    // Step 5: Log function start
    await logFunctionStart("approve_action", orgId, userId, {
      approval_id: input.approval_id,
      decision: input.decision,
    });

    // Step 6: Validate approval state
    if (approval.status !== "pending") {
      return errorResponse(
        `Approval already ${approval.status}`,
        400
      );
    }

    // Check expiration
    if (new Date(approval.expires_at) < new Date()) {
      await supabase
        .from("approvals")
        .update({ status: "expired" })
        .eq("id", input.approval_id);

      return errorResponse("Approval has expired", 400);
    }

    // Step 7: Process decision
    const result = await processDecision(
      supabase,
      input,
      approval,
      userId
    );

    // Step 8: Log success
    await logFunctionSuccess(
      "approve_action",
      orgId,
      userId,
      input.approval_id,
      { status: result.status }
    );

    // Log audit trail
    await logAudit({
      organization_id: orgId,
      actor_id: userId,
      action: `approval.${input.decision}`,
      resource_type: "approval",
      resource_id: input.approval_id,
      metadata: {
        agent_run_id: approval.agent_run_id,
        risk_level: approval.risk_level,
        reason: input.reason,
        executed: result.status === "executed",
      },
    });

    return successResponse(result);
  } catch (error) {
    // Log error if we have context
    if (orgId && userId) {
      await logFunctionError(
        "approve_action",
        orgId,
        userId,
        error instanceof Error ? error : String(error)
      );
    }

    // Return appropriate error response
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }

    if (error instanceof ValidationError) {
      return errorResponse(error.message, 400, error.details);
    }

    console.error("Unexpected error in approve_action:", error);
    return errorResponse("Internal server error", 500);
  }
});

// =============================================================================
// Decision Processing
// =============================================================================

async function processDecision(
  supabase: ReturnType<typeof createAdminClient>,
  input: ApproveActionInput,
  approval: {
    id: string;
    organization_id: string;
    agent_run_id: string;
    requested_actions: unknown;
    risk_level: string;
    requested_by: string;
  },
  userId: string
): Promise<ApprovalResponse> {
  const now = new Date().toISOString();

  if (input.decision === "reject") {
    // Update approval status
    await supabase
      .from("approvals")
      .update({
        status: "rejected",
        decided_by: userId,
        decided_at: now,
        decision_reason: input.reason,
      })
      .eq("id", input.approval_id);

    // Update agent run status
    await supabase
      .from("agent_runs")
      .update({
        status: "rejected",
        error: input.reason ?? "Rejected by admin",
      })
      .eq("id", approval.agent_run_id);

    return {
      approval_id: input.approval_id,
      status: "rejected",
      decision_by: userId,
      decided_at: now,
    };
  }

  // Approve decision
  const actions = approval.requested_actions as Array<{
    tool_calls: Array<{ tool: string; parameters: Record<string, unknown> }>;
  }>;

  // Count total tool calls (each counts as a "send" action)
  const totalToolCalls = actions.reduce(
    (sum, action) => sum + (action.tool_calls?.length ?? 0),
    0
  );

  // Pre-flight check for sends limit
  const actionLimitResult = await checkActionLimit(approval.organization_id, totalToolCalls);

  if (!actionLimitResult.allowed) {
    await logRateLimitExceeded("approve_action", approval.organization_id, userId, {
      current: actionLimitResult.current.sends_today,
      max: actionLimitResult.limits.sends_per_day,
      type: "sends_per_day",
    });

    // Don't reject, just mark approved without execution
    await supabase
      .from("approvals")
      .update({
        status: "approved",
        decided_by: userId,
        decided_at: now,
        decision_reason: "Approved but execution deferred due to rate limit",
      })
      .eq("id", input.approval_id);

    return {
      approval_id: input.approval_id,
      status: "approved",
      decision_by: userId,
      decided_at: now,
      error: "Execution deferred: daily send limit reached",
    };
  }

  // Atomic increment sends counter before execution
  const sendResult = await checkAndIncrementUsage(
    approval.organization_id,
    "sends",
    totalToolCalls
  );

  if (!sendResult.allowed) {
    await logRateLimitExceeded("approve_action", approval.organization_id, userId, {
      current: sendResult.currentCount,
      max: sendResult.limit,
      type: "sends_per_day",
    });

    // Don't reject, just mark approved without execution
    await supabase
      .from("approvals")
      .update({
        status: "approved",
        decided_by: userId,
        decided_at: now,
        decision_reason: "Approved but execution deferred due to rate limit",
      })
      .eq("id", input.approval_id);

    return {
      approval_id: input.approval_id,
      status: "approved",
      decision_by: userId,
      decided_at: now,
      error: "Execution deferred: daily send limit reached",
    };
  }

  // Update approval status
  await supabase
    .from("approvals")
    .update({
      status: "approved",
      decided_by: userId,
      decided_at: now,
      decision_reason: input.reason,
    })
    .eq("id", input.approval_id);

  // Execute if requested
  if (input.execute_immediately) {
    const executionResults = await executeApprovedActions(
      supabase,
      approval.organization_id,
      userId,
      approval.id,
      actions
    );

    const allSucceeded = executionResults.every((r) => r.success);

    // Update agent run status
    await supabase
      .from("agent_runs")
      .update({
        status: allSucceeded ? "completed" : "failed",
        completed_at: now,
        output: { execution_results: executionResults },
      })
      .eq("id", approval.agent_run_id);

    return {
      approval_id: input.approval_id,
      status: allSucceeded ? "executed" : "execution_failed",
      decision_by: userId,
      decided_at: now,
      execution_results: executionResults,
    };
  }

  // Mark agent run as approved (execution deferred)
  await supabase
    .from("agent_runs")
    .update({
      status: "approved",
    })
    .eq("id", approval.agent_run_id);

  return {
    approval_id: input.approval_id,
    status: "approved",
    decision_by: userId,
    decided_at: now,
  };
}

// =============================================================================
// Action Execution
// =============================================================================

async function executeApprovedActions(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
  approvalId: string,
  actions: Array<{
    tool_calls?: Array<{ tool: string; parameters: Record<string, unknown> }>;
  }>
): Promise<
  Array<{
    tool: string;
    success: boolean;
    output?: unknown;
    error?: string;
  }>
> {
  const results: Array<{
    tool: string;
    success: boolean;
    output?: unknown;
    error?: string;
  }> = [];

  // Flatten all tool calls from all actions
  const toolCalls = actions.flatMap((action) => action.tool_calls ?? []);

  for (const toolCall of toolCalls) {
    try {
      // Execute tool (simulated - in production, would call actual tool handlers)
      const output = await executeToolCall(
        toolCall.tool,
        toolCall.parameters,
        {
          organizationId: orgId,
          userId,
          approvalId,
          dryRun: false,
        }
      );

      results.push({
        tool: toolCall.tool,
        success: true,
        output,
      });

      // Log tool execution
      await supabase.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: userId,
        action: `tool.${toolCall.tool}`,
        resource_type: "tool_execution",
        resource_id: approvalId,
        metadata: {
          tool: toolCall.tool,
          success: true,
          approval_id: approvalId,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      results.push({
        tool: toolCall.tool,
        success: false,
        error: errorMessage,
      });

      // Log failed execution
      await supabase.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: userId,
        action: `tool.${toolCall.tool}.error`,
        resource_type: "tool_execution",
        resource_id: approvalId,
        metadata: {
          tool: toolCall.tool,
          success: false,
          error: errorMessage,
          approval_id: approvalId,
        },
      });

      // Stop on first failure
      break;
    }
  }

  return results;
}

/**
 * Execute a tool call.
 * In production, this would call the actual tool handlers from lib/agents/tools.ts
 */
async function executeToolCall(
  tool: string,
  parameters: Record<string, unknown>,
  context: {
    organizationId: string;
    userId: string;
    approvalId: string;
    dryRun: boolean;
  }
): Promise<unknown> {
  // Simulated tool execution
  // In production: import and call executeTool from lib/agents/tools.ts

  // Allowlist check (redundant with schema but defense in depth)
  const allowedTools = [
    "send_email",
    "send_slack_message",
    "schedule_meeting",
    "create_document",
    "update_document",
    "read_document",
    "create_contact",
    "update_contact",
    "search_contacts",
    "create_task",
    "update_task",
    "complete_task",
    "get_availability",
    "book_slot",
    "search_emails",
    "get_calendar_events",
    "get_org_settings",
  ];

  if (!allowedTools.includes(tool)) {
    throw new Error(`Tool "${tool}" is not in the allowlist`);
  }

  // Simulated execution results
  return {
    status: "success",
    tool,
    timestamp: new Date().toISOString(),
    message: `Tool ${tool} executed successfully`,
  };
}
