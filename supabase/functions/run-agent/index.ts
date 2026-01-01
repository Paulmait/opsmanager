/**
 * run_agent Edge Function
 *
 * Executes the agent pipeline: Planner -> Validator -> (Optional) Executor
 *
 * SECURITY:
 * - Verifies caller authentication and org membership
 * - Enforces rate limits (runs/day, actions/day)
 * - Uses idempotency keys to prevent duplicate execution
 * - Logs all invocations to audit trail
 * - Validates all inputs with Zod schemas
 *
 * Endpoint: POST /functions/v1/run-agent
 * Headers:
 *   - Authorization: Bearer <jwt>
 *   - Idempotency-Key: <optional-client-key>
 * Body: { org_id, trigger_payload }
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
  checkRunLimit,
  checkActionLimit,
  checkMaxActionsPerRun,
  checkAndIncrementUsage,
  checkFeature,
  RateLimitError,
  getIdempotencyKey,
  checkIdempotency,
  storeIdempotencyResponse,
  logFunctionStart,
  logFunctionSuccess,
  logFunctionError,
  logRateLimitExceeded,
  successResponse,
  errorResponse,
  handleCors,
  rateLimitResponse,
  idempotentResponse,
  createAdminClient,
} from "../_shared/index.ts";

// =============================================================================
// Input Schema
// =============================================================================

const TriggerPayloadSchema = z.object({
  goal: z.string().min(1, "Goal is required").max(1000),
  constraints: z.array(z.string()).optional(),
  max_actions: z.number().int().positive().max(20).default(10),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  context: z.record(z.unknown()).optional(),
  task_id: z.string().uuid().optional(),
});

const RunAgentInputSchema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  trigger_payload: TriggerPayloadSchema,
  auto_approve: z.boolean().default(false),
});

type RunAgentInput = z.infer<typeof RunAgentInputSchema>;

// =============================================================================
// Response Types
// =============================================================================

interface AgentRunResponse {
  run_id: string;
  status: "completed" | "pending_approval" | "rejected";
  plan: {
    goal: string;
    actions_count: number;
    overall_risk: string;
    confidence: string;
  } | null;
  validation: {
    decision: string;
    requires_approval: boolean;
    reason: string;
  } | null;
  approval_id?: string;
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
    const input = await validateBody(req, RunAgentInputSchema);
    orgId = input.org_id;

    // Step 3: Verify org membership (requires at least member role)
    const orgAuth = await verifyOrgMembership(auth, orgId);
    requireRole(orgAuth, "member");

    // Step 4: Log function start
    await logFunctionStart("run_agent", orgId, userId, {
      goal: input.trigger_payload.goal,
      max_actions: input.trigger_payload.max_actions,
    });

    // Step 5: Check idempotency
    const idempotencyKey = await getIdempotencyKey(
      req,
      "run_agent",
      orgId,
      input.trigger_payload
    );

    const idempotencyResult = await checkIdempotency(idempotencyKey);

    if (!idempotencyResult.isNew && idempotencyResult.existingResponse) {
      // Return cached response
      return idempotentResponse(
        idempotencyResult.existingResponse,
        idempotencyKey,
        true
      );
    }

    // Step 6: Check rate limits and atomically increment usage
    // First do a pre-flight check
    const runLimitResult = await checkRunLimit(orgId);

    if (!runLimitResult.allowed) {
      await logRateLimitExceeded("run_agent", orgId, userId, {
        current: runLimitResult.current.runs_today,
        max: runLimitResult.limits.runs_per_day,
        type: "runs_per_day",
      });

      return rateLimitResponse(
        runLimitResult.current.runs_today,
        runLimitResult.limits.runs_per_day
      );
    }

    // Atomic increment - this is the authoritative check
    const usageResult = await checkAndIncrementUsage(orgId, "runs", 1);

    if (!usageResult.allowed) {
      await logRateLimitExceeded("run_agent", orgId, userId, {
        current: usageResult.currentCount,
        max: usageResult.limit,
        type: "runs_per_day",
      });

      return rateLimitResponse(usageResult.currentCount, usageResult.limit);
    }

    // Step 7: Execute agent pipeline
    const result = await executeAgentPipeline(input, orgAuth.userId);

    // Step 8: Store idempotency response
    await storeIdempotencyResponse(idempotencyKey, result);

    // Step 9: Log success
    await logFunctionSuccess("run_agent", orgId, userId, result.run_id, {
      status: result.status,
      actions_count: result.plan?.actions_count,
    });

    return idempotentResponse(result, idempotencyKey, false);
  } catch (error) {
    // Log error if we have context
    if (orgId && userId) {
      await logFunctionError(
        "run_agent",
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

    if (error instanceof RateLimitError) {
      return rateLimitResponse(
        error.result.current.runs_today,
        error.result.limits.runs_per_day
      );
    }

    console.error("Unexpected error in run_agent:", error);
    return errorResponse("Internal server error", 500);
  }
});

// =============================================================================
// Agent Pipeline Execution
// =============================================================================

async function executeAgentPipeline(
  input: RunAgentInput,
  userId: string
): Promise<AgentRunResponse> {
  const supabase = createAdminClient();
  const { org_id, trigger_payload, auto_approve } = input;

  // Create agent run record
  const { data: runRecord, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: org_id,
      agent_type: "planner",
      input_data: trigger_payload,
      status: "running",
      triggered_by: userId,
    })
    .select("id")
    .single();

  if (runError || !runRecord) {
    throw new Error(`Failed to create run record: ${runError?.message}`);
  }

  const runId = runRecord.id;

  try {
    // Step 1: Generate plan (simulated - in production, call LLM)
    const plan = await generatePlan(trigger_payload);

    // Step 2: Check action count against limits
    const limits = await import("../_shared/rate-limit.ts").then((m) =>
      m.getOrgLimits(org_id)
    );

    const actionCheck = checkMaxActionsPerRun(
      plan.actions.length,
      limits
    );

    if (!actionCheck.allowed) {
      await updateRunStatus(supabase, runId, "failed", actionCheck.reason);

      return {
        run_id: runId,
        status: "rejected",
        plan: null,
        validation: null,
        error: actionCheck.reason,
      };
    }

    // Step 3: Validate plan
    const validation = await validatePlan(plan, org_id);

    // Step 4: Update run record with output
    await supabase
      .from("agent_runs")
      .update({
        output_data: { plan, validation },
        tokens_used: 500, // Simulated
        cost_cents: 1, // Simulated
      })
      .eq("id", runId);

    // Step 5: Handle validation decision
    if (validation.decision === "reject") {
      await updateRunStatus(supabase, runId, "failed", validation.decision_reason);

      return {
        run_id: runId,
        status: "rejected",
        plan: {
          goal: plan.goal,
          actions_count: plan.actions.length,
          overall_risk: plan.overall_risk,
          confidence: plan.confidence,
        },
        validation: {
          decision: validation.decision,
          requires_approval: false,
          reason: validation.decision_reason,
        },
        error: validation.decision_reason,
      };
    }

    if (validation.decision === "require_human_approval" && !auto_approve) {
      // Create approval request
      const { data: approval } = await supabase
        .from("approvals")
        .insert({
          organization_id: org_id,
          agent_run_id: runId,
          action_type: plan.actions[0]?.tool_calls?.[0]?.tool ?? "agent_action",
          action_summary: `${plan.actions.length} action(s) for: ${plan.goal}`,
          action_details: { actions: plan.actions, risk_level: plan.overall_risk },
          status: "pending",
          requested_by: userId,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        })
        .select("id")
        .single();

      await updateRunStatus(supabase, runId, "pending_approval");

      return {
        run_id: runId,
        status: "pending_approval",
        plan: {
          goal: plan.goal,
          actions_count: plan.actions.length,
          overall_risk: plan.overall_risk,
          confidence: plan.confidence,
        },
        validation: {
          decision: validation.decision,
          requires_approval: true,
          reason: validation.decision_reason,
        },
        approval_id: approval?.id,
      };
    }

    // Auto-approved or approved decision
    await updateRunStatus(supabase, runId, "completed");

    return {
      run_id: runId,
      status: "completed",
      plan: {
        goal: plan.goal,
        actions_count: plan.actions.length,
        overall_risk: plan.overall_risk,
        confidence: plan.confidence,
      },
      validation: {
        decision: validation.decision,
        requires_approval: false,
        reason: validation.decision_reason,
      },
    };
  } catch (error) {
    await updateRunStatus(
      supabase,
      runId,
      "failed",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

async function updateRunStatus(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  await supabase
    .from("agent_runs")
    .update({
      status,
      ...(errorMessage && { error_message: errorMessage }),
      ...(status === "completed" && { completed_at: new Date().toISOString() }),
    })
    .eq("id", runId);
}

/**
 * Generate plan from trigger payload.
 * In production, this would call the LLM via the PlannerAgent.
 */
async function generatePlan(payload: z.infer<typeof TriggerPayloadSchema>) {
  // Simulated plan generation
  // In production: call plannerAgent.run()

  const actions = [];
  const goal = payload.goal.toLowerCase();

  // Simple rule-based plan for demo
  if (goal.includes("email")) {
    actions.push({
      step: 1,
      description: "Compose and send email",
      tool_calls: [
        {
          tool: "send_email",
          parameters: { to: "recipient@example.com", subject: payload.goal },
          reason: "User requested email",
        },
      ],
      estimated_risk: "high",
    });
  } else if (goal.includes("task")) {
    actions.push({
      step: 1,
      description: "Create task",
      tool_calls: [
        {
          tool: "create_task",
          parameters: { title: payload.goal },
          reason: "User requested task creation",
        },
      ],
      estimated_risk: "low",
    });
  } else {
    actions.push({
      step: 1,
      description: "Search for information",
      tool_calls: [
        {
          tool: "search_contacts",
          parameters: { query: payload.goal },
          reason: "Gather relevant information",
        },
      ],
      estimated_risk: "none",
    });
  }

  // Determine overall risk
  const riskLevels = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const maxRisk = Math.max(
    ...actions.map((a) => riskLevels[a.estimated_risk as keyof typeof riskLevels] ?? 0)
  );
  const overallRisk = Object.entries(riskLevels).find(([_, v]) => v === maxRisk)?.[0] ?? "low";

  return {
    goal: payload.goal,
    reasoning: `User requested: ${payload.goal}`,
    actions,
    overall_risk: overallRisk,
    confidence: payload.context ? "high" : "medium",
    requires_approval: maxRisk >= 3,
    approval_reason: maxRisk >= 3 ? "High risk action detected" : undefined,
  };
}

/**
 * Validate plan against policies.
 * In production, this would call the ValidatorAgent.
 */
async function validatePlan(
  plan: Awaited<ReturnType<typeof generatePlan>>,
  _orgId: string
) {
  // Simulated validation
  // In production: call validatorAgent.run()

  const riskLevels = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const riskScore = riskLevels[plan.overall_risk as keyof typeof riskLevels] ?? 0;

  // Reject critical risk
  if (riskScore >= 4) {
    return {
      is_valid: false,
      decision: "reject" as const,
      decision_reason: "Critical risk level not allowed",
      requires_approval: false,
      risk_assessment: {
        overall_risk: plan.overall_risk,
        risk_factors: ["Critical risk detected"],
      },
      confidence_check: {
        meets_threshold: false,
        actual_confidence: plan.confidence,
        required_confidence: "high",
      },
      policy_violations: ["Critical risk policy"],
      approved_actions: [],
      blocked_actions: plan.actions.map((_, i) => i + 1),
    };
  }

  // Require approval for high risk
  if (riskScore >= 3 || plan.requires_approval) {
    return {
      is_valid: true,
      decision: "require_human_approval" as const,
      decision_reason: "High risk actions require approval",
      requires_approval: true,
      risk_assessment: {
        overall_risk: plan.overall_risk,
        risk_factors: ["High risk action detected"],
      },
      confidence_check: {
        meets_threshold: true,
        actual_confidence: plan.confidence,
        required_confidence: "medium",
      },
      policy_violations: [],
      approved_actions: [],
      blocked_actions: [],
    };
  }

  // Auto-approve low risk
  return {
    is_valid: true,
    decision: "approve" as const,
    decision_reason: "All checks passed",
    requires_approval: false,
    risk_assessment: {
      overall_risk: plan.overall_risk,
      risk_factors: [],
    },
    confidence_check: {
      meets_threshold: true,
      actual_confidence: plan.confidence,
      required_confidence: "medium",
    },
    policy_violations: [],
    approved_actions: plan.actions.map((_, i) => i + 1),
    blocked_actions: [],
  };
}
