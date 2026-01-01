import "server-only";

import { z } from "zod";
import { BaseAgent, type AgentType } from "./base";
import {
  type AgentContext,
  type PlannerOutput,
  PlannerOutputSchema,
  RISK_SCORES,
  CONFIDENCE_SCORES,
  TOOL_RISK_LEVELS,
  type AllowedTool,
  type RiskLevel,
  type ConfidenceLevel,
} from "./schemas";
import { getOrgMemory } from "./memory";

// =============================================================================
// Planner Input Schema
// =============================================================================

export const PlannerInputSchema = z.object({
  goal: z.string().min(1, "Goal is required"),
  constraints: z.array(z.string()).optional(),
  preferences: z.record(z.unknown()).optional(),
  max_actions: z.number().int().positive().default(10),
  urgency: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});
export type PlannerInput = z.infer<typeof PlannerInputSchema>;

// =============================================================================
// Planner Agent
// =============================================================================

/**
 * Planner Agent
 *
 * Produces execution plans with:
 * - Structured actions with tool calls
 * - Risk assessment per action and overall
 * - Confidence scoring
 * - Approval requirements
 *
 * SECURITY:
 * - Only uses tools from the allowlist
 * - Calculates risk based on tool types
 * - Flags high-risk plans for approval
 */
export class PlannerAgent extends BaseAgent<PlannerInput, PlannerOutput> {
  protected readonly agentType: AgentType = "planner";
  protected readonly inputSchema = PlannerInputSchema;
  protected readonly outputSchema = PlannerOutputSchema;

  // Thresholds for automatic approval
  private readonly APPROVAL_THRESHOLDS = {
    // Minimum confidence for auto-approval
    minConfidence: "medium" as ConfidenceLevel,
    // Maximum risk for auto-approval
    maxRisk: "medium" as RiskLevel,
    // High-risk tools that always require approval
    alwaysApproveTools: ["send_email", "update_document"] as AllowedTool[],
  };

  protected async execute(
    input: PlannerInput,
    context: AgentContext
  ): Promise<{ output: PlannerOutput; tokens: number; cost: number }> {
    // Get org memory for context
    const memory = await getOrgMemory(context.organization_id);

    // In production, this would call an LLM API
    // For now, we create a structured plan based on the goal

    const plan = await this.generatePlan(input, context, memory);

    // Calculate overall metrics
    const { overallRisk, confidence, requiresApproval, approvalReason } =
      this.assessPlan(plan, input);

    const output: PlannerOutput = {
      goal: input.goal,
      reasoning: `Plan created to achieve: ${input.goal}. Analysis based on ${plan.length} actions with consideration for constraints and org preferences.`,
      actions: plan,
      overall_risk: overallRisk,
      confidence,
      requires_approval: requiresApproval,
      approval_reason: approvalReason,
      estimated_duration_seconds: plan.length * 30, // Rough estimate
      warnings: this.generateWarnings(plan),
    };

    // Simulate token usage
    const tokens = 500 + input.goal.length * 2;
    const cost = Math.ceil(tokens * 0.002); // $0.002 per token in cents

    return { output, tokens, cost };
  }

  /**
   * Generate a plan based on the input goal.
   * In production, this would use an LLM with structured output.
   */
  private async generatePlan(
    input: PlannerInput,
    _context: AgentContext,
    memory: Record<string, unknown>
  ): Promise<PlannerOutput["actions"]> {
    // Parse the goal to determine required actions
    const goal = input.goal.toLowerCase();
    const actions: PlannerOutput["actions"] = [];

    // Simple goal parsing (would be LLM-driven in production)
    if (goal.includes("email") || goal.includes("send")) {
      actions.push({
        step: actions.length + 1,
        description: "Draft and send email",
        tool_calls: [
          {
            tool: "send_email",
            parameters: {
              subject: "Regarding: " + input.goal,
              body: "To be drafted by Writer agent",
            },
            reason: "User requested email communication",
          },
        ],
        estimated_risk: "high",
      });
    }

    if (goal.includes("meeting") || goal.includes("schedule")) {
      actions.push({
        step: actions.length + 1,
        description: "Check availability and schedule meeting",
        tool_calls: [
          {
            tool: "get_availability",
            parameters: {},
            reason: "Need to find available time slots",
          },
          {
            tool: "schedule_meeting",
            parameters: {},
            reason: "Book the meeting",
          },
        ],
        depends_on: actions.length > 0 ? [actions.length] : undefined,
        estimated_risk: "medium",
      });
    }

    if (goal.includes("contact") || goal.includes("crm")) {
      actions.push({
        step: actions.length + 1,
        description: "Search and update contact information",
        tool_calls: [
          {
            tool: "search_contacts",
            parameters: {},
            reason: "Find relevant contacts",
          },
        ],
        estimated_risk: "none",
      });
    }

    if (goal.includes("task") || goal.includes("todo")) {
      actions.push({
        step: actions.length + 1,
        description: "Create task for tracking",
        tool_calls: [
          {
            tool: "create_task",
            parameters: {
              title: input.goal,
              priority: input.urgency,
            },
            reason: "Track progress of this request",
          },
        ],
        estimated_risk: "low",
      });
    }

    if (goal.includes("document") || goal.includes("doc")) {
      actions.push({
        step: actions.length + 1,
        description: "Create or update document",
        tool_calls: [
          {
            tool: "create_document",
            parameters: {},
            reason: "Document creation requested",
          },
        ],
        estimated_risk: "medium",
      });
    }

    // If no specific actions matched, create a generic task
    if (actions.length === 0) {
      actions.push({
        step: 1,
        description: "Create task to track this request",
        tool_calls: [
          {
            tool: "create_task",
            parameters: {
              title: input.goal,
            },
            reason: "No specific automation matched; creating task for manual handling",
          },
        ],
        estimated_risk: "low",
      });
    }

    return actions;
  }

  /**
   * Assess the plan for risk and approval requirements.
   */
  private assessPlan(
    actions: PlannerOutput["actions"],
    input: PlannerInput
  ): {
    overallRisk: RiskLevel;
    confidence: ConfidenceLevel;
    requiresApproval: boolean;
    approvalReason?: string;
  } {
    // Calculate highest risk from all actions
    let maxRiskScore = 0;
    let hasHighRiskTool = false;

    for (const action of actions) {
      const riskScore = RISK_SCORES[action.estimated_risk];
      maxRiskScore = Math.max(maxRiskScore, riskScore);

      // Check for always-approve tools
      for (const toolCall of action.tool_calls) {
        if (
          this.APPROVAL_THRESHOLDS.alwaysApproveTools.includes(toolCall.tool)
        ) {
          hasHighRiskTool = true;
        }

        // Also consider individual tool risk
        const toolRisk = TOOL_RISK_LEVELS[toolCall.tool];
        const toolRiskScore = RISK_SCORES[toolRisk];
        maxRiskScore = Math.max(maxRiskScore, toolRiskScore);
      }
    }

    // Determine overall risk
    const overallRisk: RiskLevel =
      maxRiskScore >= 4
        ? "critical"
        : maxRiskScore >= 3
          ? "high"
          : maxRiskScore >= 2
            ? "medium"
            : maxRiskScore >= 1
              ? "low"
              : "none";

    // Calculate confidence based on goal clarity and action count
    const goalWords = input.goal.split(" ").length;
    const hasConstraints = (input.constraints?.length ?? 0) > 0;

    let confidence: ConfidenceLevel;
    if (goalWords < 3) {
      confidence = "low";
    } else if (goalWords < 6) {
      confidence = "medium";
    } else if (hasConstraints) {
      confidence = "high";
    } else {
      confidence = "medium";
    }

    // Determine if approval is required
    let requiresApproval = false;
    let approvalReason: string | undefined;

    // Check risk threshold
    if (
      RISK_SCORES[overallRisk] >
      RISK_SCORES[this.APPROVAL_THRESHOLDS.maxRisk]
    ) {
      requiresApproval = true;
      approvalReason = `Risk level (${overallRisk}) exceeds auto-approval threshold`;
    }

    // Check confidence threshold
    if (
      CONFIDENCE_SCORES[confidence] <
      CONFIDENCE_SCORES[this.APPROVAL_THRESHOLDS.minConfidence]
    ) {
      requiresApproval = true;
      approvalReason = approvalReason
        ? `${approvalReason}; confidence too low (${confidence})`
        : `Confidence level (${confidence}) below threshold`;
    }

    // Check high-risk tools
    if (hasHighRiskTool && !requiresApproval) {
      requiresApproval = true;
      approvalReason = "Plan includes high-risk external actions";
    }

    return { overallRisk, confidence, requiresApproval, approvalReason };
  }

  /**
   * Generate warnings about the plan.
   */
  private generateWarnings(actions: PlannerOutput["actions"]): string[] {
    const warnings: string[] = [];

    // Check for multiple external communications
    const externalTools = ["send_email", "send_slack_message"];
    const externalCount = actions
      .flatMap((a) => a.tool_calls)
      .filter((tc) => externalTools.includes(tc.tool)).length;

    if (externalCount > 1) {
      warnings.push(
        `Plan includes ${externalCount} external communications - review carefully`
      );
    }

    // Check for document modifications
    const docTools = ["update_document", "create_document"];
    const docCount = actions
      .flatMap((a) => a.tool_calls)
      .filter((tc) => docTools.includes(tc.tool)).length;

    if (docCount > 0) {
      warnings.push(
        `Plan modifies ${docCount} document(s) - changes may be difficult to undo`
      );
    }

    return warnings;
  }
}

// Export singleton instance
export const plannerAgent = new PlannerAgent();
