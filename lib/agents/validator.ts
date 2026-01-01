import "server-only";

import { z } from "zod";
import { BaseAgent, type AgentType } from "./base";
import {
  type AgentContext,
  type ValidationResult,
  type PlannerOutput,
  ValidationResultSchema,
  PlannerOutputSchema,
  RISK_SCORES,
  CONFIDENCE_SCORES,
  TOOL_RISK_LEVELS,
  type RiskLevel,
  type ConfidenceLevel,
  type AllowedTool,
} from "./schemas";
import { getOrgSettings } from "./memory";

// =============================================================================
// Validator Input Schema
// =============================================================================

export const ValidatorInputSchema = z.object({
  plan: PlannerOutputSchema,
  org_settings: z
    .object({
      auto_approve_low_risk: z.boolean().default(true),
      max_auto_approve_risk: z.enum(["none", "low", "medium"]).default("low"),
      min_confidence_threshold: z
        .enum(["very_low", "low", "medium", "high", "very_high"])
        .default("medium"),
      blocked_tools: z.array(z.string()).default([]),
      require_approval_tools: z.array(z.string()).default([]),
    })
    .optional(),
});
export type ValidatorInput = z.infer<typeof ValidatorInputSchema>;

// =============================================================================
// Policy Definitions
// =============================================================================

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  check: (
    plan: PlannerOutput,
    settings: ValidatorInput["org_settings"]
  ) => PolicyViolation | null;
}

interface PolicyViolation {
  policy: string;
  violation: string;
  severity: "warning" | "error" | "critical";
}

// =============================================================================
// Built-in Policies
// =============================================================================

const BUILT_IN_POLICIES: PolicyRule[] = [
  {
    id: "max-actions",
    name: "Maximum Actions",
    description: "Limit the number of actions in a single plan",
    check: (plan) => {
      if (plan.actions.length > 20) {
        return {
          policy: "max-actions",
          violation: `Plan has ${plan.actions.length} actions (max: 20)`,
          severity: "error",
        };
      }
      return null;
    },
  },
  {
    id: "critical-risk-block",
    name: "Block Critical Risk",
    description: "Critical risk plans are always blocked",
    check: (plan) => {
      if (plan.overall_risk === "critical") {
        return {
          policy: "critical-risk-block",
          violation: "Critical risk plans require manual review",
          severity: "critical",
        };
      }
      return null;
    },
  },
  {
    id: "external-comm-limit",
    name: "External Communication Limit",
    description: "Limit external communications per plan",
    check: (plan) => {
      const externalTools: AllowedTool[] = ["send_email", "send_slack_message"];
      const externalCount = plan.actions
        .flatMap((a) => a.tool_calls)
        .filter((tc) => externalTools.includes(tc.tool)).length;

      if (externalCount > 5) {
        return {
          policy: "external-comm-limit",
          violation: `Too many external communications (${externalCount}, max: 5)`,
          severity: "error",
        };
      }
      if (externalCount > 2) {
        return {
          policy: "external-comm-limit",
          violation: `Multiple external communications (${externalCount})`,
          severity: "warning",
        };
      }
      return null;
    },
  },
  {
    id: "blocked-tools",
    name: "Blocked Tools",
    description: "Check for org-blocked tools",
    check: (plan, settings) => {
      if (!settings?.blocked_tools?.length) return null;

      for (const action of plan.actions) {
        for (const toolCall of action.tool_calls) {
          if (settings.blocked_tools.includes(toolCall.tool)) {
            return {
              policy: "blocked-tools",
              violation: `Tool "${toolCall.tool}" is blocked by organization policy`,
              severity: "critical",
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: "confidence-threshold",
    name: "Confidence Threshold",
    description: "Ensure minimum confidence level",
    check: (plan, settings) => {
      const minConfidence = settings?.min_confidence_threshold ?? "medium";
      const planConfidence = CONFIDENCE_SCORES[plan.confidence];
      const requiredConfidence = CONFIDENCE_SCORES[minConfidence];

      if (planConfidence < requiredConfidence) {
        return {
          policy: "confidence-threshold",
          violation: `Confidence (${plan.confidence}) below threshold (${minConfidence})`,
          severity: "warning",
        };
      }
      return null;
    },
  },
];

// =============================================================================
// Validator Agent
// =============================================================================

/**
 * Validator Agent
 *
 * Validates plans against:
 * - Built-in security policies
 * - Organization-specific rules
 * - Risk thresholds
 * - Confidence requirements
 *
 * Decides:
 * - approve: Plan can execute automatically
 * - require_human_approval: Plan needs human review
 * - reject: Plan violates critical policies
 */
export class ValidatorAgent extends BaseAgent<ValidatorInput, ValidationResult> {
  protected readonly agentType: AgentType = "validator";
  protected readonly inputSchema = ValidatorInputSchema;
  protected readonly outputSchema = ValidationResultSchema;

  protected async execute(
    input: ValidatorInput,
    context: AgentContext
  ): Promise<{ output: ValidationResult; tokens: number; cost: number }> {
    const { plan, org_settings } = input;

    // Get org settings from DB if not provided
    const settings =
      org_settings ?? (await getOrgSettings(context.organization_id));

    // Run all policy checks
    const violations = this.runPolicyChecks(plan, settings);

    // Assess risk
    const riskAssessment = this.assessRisk(plan);

    // Check confidence
    const confidenceCheck = this.checkConfidence(plan, settings);

    // Determine which actions are approved/blocked
    const { approvedActions, blockedActions } = this.evaluateActions(
      plan,
      settings,
      violations
    );

    // Make final decision
    const { decision, decisionReason } = this.makeDecision(
      violations,
      riskAssessment,
      confidenceCheck,
      settings
    );

    const output: ValidationResult = {
      is_valid: violations.filter((v) => v.severity === "critical").length === 0,
      requires_approval: decision === "require_human_approval",
      risk_assessment: riskAssessment,
      confidence_check: confidenceCheck,
      policy_violations: violations,
      approved_actions: approvedActions,
      blocked_actions: blockedActions,
      decision,
      decision_reason: decisionReason,
    };

    // Minimal token usage for validation (mostly rule-based)
    const tokens = 100;
    const cost = 0; // Rule-based, no LLM cost

    return { output, tokens, cost };
  }

  /**
   * Run all policy checks against the plan.
   */
  private runPolicyChecks(
    plan: PlannerOutput,
    settings: ValidatorInput["org_settings"]
  ): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    for (const policy of BUILT_IN_POLICIES) {
      const violation = policy.check(plan, settings);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Assess overall risk of the plan.
   */
  private assessRisk(plan: PlannerOutput): ValidationResult["risk_assessment"] {
    const riskFactors: string[] = [];
    const mitigations: string[] = [];

    // Analyze each action
    for (const action of plan.actions) {
      for (const toolCall of action.tool_calls) {
        const toolRisk = TOOL_RISK_LEVELS[toolCall.tool];
        if (RISK_SCORES[toolRisk] >= RISK_SCORES.medium) {
          riskFactors.push(
            `Action ${action.step}: ${toolCall.tool} (${toolRisk} risk)`
          );
        }
      }
    }

    // Add risk factors based on plan characteristics
    if (plan.actions.length > 5) {
      riskFactors.push(`Complex plan with ${plan.actions.length} actions`);
      mitigations.push("Consider breaking into smaller tasks");
    }

    if (plan.warnings && plan.warnings.length > 0) {
      riskFactors.push(...plan.warnings.map((w) => `Warning: ${w}`));
    }

    // Suggest mitigations
    if (plan.overall_risk === "high" || plan.overall_risk === "critical") {
      mitigations.push("Require explicit human approval before execution");
      mitigations.push("Review each action individually");
    }

    return {
      overall_risk: plan.overall_risk,
      risk_factors: riskFactors,
      mitigations: mitigations.length > 0 ? mitigations : undefined,
    };
  }

  /**
   * Check if confidence meets threshold.
   */
  private checkConfidence(
    plan: PlannerOutput,
    settings: ValidatorInput["org_settings"]
  ): ValidationResult["confidence_check"] {
    const requiredConfidence: ConfidenceLevel =
      settings?.min_confidence_threshold ?? "medium";
    const meetsThreshold =
      CONFIDENCE_SCORES[plan.confidence] >=
      CONFIDENCE_SCORES[requiredConfidence];

    return {
      meets_threshold: meetsThreshold,
      actual_confidence: plan.confidence,
      required_confidence: requiredConfidence,
    };
  }

  /**
   * Evaluate which actions can proceed.
   */
  private evaluateActions(
    plan: PlannerOutput,
    settings: ValidatorInput["org_settings"],
    violations: PolicyViolation[]
  ): {
    approvedActions: number[];
    blockedActions: { step: number; reason: string }[];
  } {
    const approvedActions: number[] = [];
    const blockedActions: { step: number; reason: string }[] = [];

    const hasCriticalViolation = violations.some(
      (v) => v.severity === "critical"
    );

    for (const action of plan.actions) {
      // If there's a critical violation, block all actions
      if (hasCriticalViolation) {
        blockedActions.push({
          step: action.step,
          reason: "Blocked due to critical policy violation",
        });
        continue;
      }

      // Check for blocked tools in this action
      const blockedTool = action.tool_calls.find((tc) =>
        settings?.blocked_tools?.includes(tc.tool)
      );

      if (blockedTool) {
        blockedActions.push({
          step: action.step,
          reason: `Uses blocked tool: ${blockedTool.tool}`,
        });
        continue;
      }

      // Check for high-risk tools that require approval
      const highRiskTool = action.tool_calls.find(
        (tc) =>
          RISK_SCORES[TOOL_RISK_LEVELS[tc.tool]] >= RISK_SCORES.high ||
          settings?.require_approval_tools?.includes(tc.tool)
      );

      if (highRiskTool) {
        // Don't block, but it will require approval
        approvedActions.push(action.step);
        continue;
      }

      approvedActions.push(action.step);
    }

    return { approvedActions, blockedActions };
  }

  /**
   * Make final decision on the plan.
   */
  private makeDecision(
    violations: PolicyViolation[],
    riskAssessment: ValidationResult["risk_assessment"],
    confidenceCheck: ValidationResult["confidence_check"],
    settings: ValidatorInput["org_settings"]
  ): { decision: ValidationResult["decision"]; decisionReason: string } {
    // Check for critical violations
    const criticalViolations = violations.filter(
      (v) => v.severity === "critical"
    );
    if (criticalViolations.length > 0) {
      return {
        decision: "reject",
        decisionReason: `Critical policy violations: ${criticalViolations.map((v) => v.policy).join(", ")}`,
      };
    }

    // Check for error violations
    const errorViolations = violations.filter((v) => v.severity === "error");
    if (errorViolations.length > 0) {
      return {
        decision: "require_human_approval",
        decisionReason: `Policy errors require review: ${errorViolations.map((v) => v.policy).join(", ")}`,
      };
    }

    // Check risk level
    const maxAutoApproveRisk = settings?.max_auto_approve_risk ?? "low";
    if (
      RISK_SCORES[riskAssessment.overall_risk] >
      RISK_SCORES[maxAutoApproveRisk]
    ) {
      return {
        decision: "require_human_approval",
        decisionReason: `Risk level (${riskAssessment.overall_risk}) exceeds auto-approve threshold (${maxAutoApproveRisk})`,
      };
    }

    // Check confidence
    if (!confidenceCheck.meets_threshold) {
      return {
        decision: "require_human_approval",
        decisionReason: `Confidence (${confidenceCheck.actual_confidence}) below required (${confidenceCheck.required_confidence})`,
      };
    }

    // All checks passed
    if (!settings?.auto_approve_low_risk) {
      return {
        decision: "require_human_approval",
        decisionReason: "Organization requires approval for all plans",
      };
    }

    return {
      decision: "approve",
      decisionReason: "All policy checks passed; risk and confidence within thresholds",
    };
  }
}

// Export singleton instance
export const validatorAgent = new ValidatorAgent();
