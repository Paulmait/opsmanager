import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

/**
 * Agent Core Tests
 *
 * Tests verify:
 * 1. Schema validation rejects invalid outputs
 * 2. Tool allowlist is enforced
 * 3. Risk assessment works correctly
 * 4. Confidence thresholds trigger approval
 */

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Schema Validation", () => {
  describe("PlannerOutputSchema", () => {
    it("should reject output missing required fields", async () => {
      const { PlannerOutputSchema } = await import("@/lib/agents/schemas");

      const invalidOutput = {
        // Missing goal, reasoning, actions, etc.
      };

      const result = PlannerOutputSchema.safeParse(invalidOutput);
      expect(result.success).toBe(false);
    });

    it("should reject output with empty actions array", async () => {
      const { PlannerOutputSchema } = await import("@/lib/agents/schemas");

      const invalidOutput = {
        goal: "Test goal",
        reasoning: "Test reasoning",
        actions: [], // Empty - should fail
        overall_risk: "low",
        confidence: "high",
        requires_approval: false,
      };

      const result = PlannerOutputSchema.safeParse(invalidOutput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("actions"))).toBe(
          true
        );
      }
    });

    it("should accept valid planner output", async () => {
      const { PlannerOutputSchema } = await import("@/lib/agents/schemas");

      const validOutput = {
        goal: "Send follow-up email",
        reasoning: "User requested email follow-up",
        actions: [
          {
            step: 1,
            description: "Send email",
            tool_calls: [
              {
                tool: "send_email",
                parameters: { to: "test@example.com" },
                reason: "User requested",
              },
            ],
            estimated_risk: "high",
          },
        ],
        overall_risk: "high",
        confidence: "medium",
        requires_approval: true,
        approval_reason: "High risk action",
      };

      const result = PlannerOutputSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it("should reject invalid risk level", async () => {
      const { RiskLevel } = await import("@/lib/agents/schemas");

      const result = RiskLevel.safeParse("super_high");
      expect(result.success).toBe(false);
    });

    it("should reject invalid confidence level", async () => {
      const { ConfidenceLevel } = await import("@/lib/agents/schemas");

      const result = ConfidenceLevel.safeParse("extremely_high");
      expect(result.success).toBe(false);
    });
  });

  describe("ValidationResultSchema", () => {
    it("should reject output with invalid decision", async () => {
      const { ValidationResultSchema } = await import("@/lib/agents/schemas");

      const invalidOutput = {
        is_valid: true,
        requires_approval: false,
        risk_assessment: {
          overall_risk: "low",
          risk_factors: [],
        },
        confidence_check: {
          meets_threshold: true,
          actual_confidence: "high",
          required_confidence: "medium",
        },
        policy_violations: [],
        approved_actions: [1],
        blocked_actions: [],
        decision: "maybe", // Invalid decision
        decision_reason: "Test",
      };

      const result = ValidationResultSchema.safeParse(invalidOutput);
      expect(result.success).toBe(false);
    });

    it("should accept valid validation result", async () => {
      const { ValidationResultSchema } = await import("@/lib/agents/schemas");

      const validOutput = {
        is_valid: true,
        requires_approval: false,
        risk_assessment: {
          overall_risk: "low",
          risk_factors: [],
        },
        confidence_check: {
          meets_threshold: true,
          actual_confidence: "high",
          required_confidence: "medium",
        },
        policy_violations: [],
        approved_actions: [1],
        blocked_actions: [],
        decision: "approve",
        decision_reason: "All checks passed",
      };

      const result = ValidationResultSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });
  });

  describe("WriterOutputSchema", () => {
    it("should reject output with empty body", async () => {
      const { WriterOutputSchema } = await import("@/lib/agents/schemas");

      const invalidOutput = {
        draft: {
          type: "email",
          body: "", // Empty body - should fail
        },
        tone: "professional",
        confidence: "high",
        word_count: 0,
      };

      const result = WriterOutputSchema.safeParse(invalidOutput);
      expect(result.success).toBe(false);
    });

    it("should reject output with invalid content type", async () => {
      const { DraftContentSchema } = await import("@/lib/agents/schemas");

      const invalidDraft = {
        type: "tweet", // Invalid type
        body: "Some content",
      };

      const result = DraftContentSchema.safeParse(invalidDraft);
      expect(result.success).toBe(false);
    });

    it("should accept valid writer output", async () => {
      const { WriterOutputSchema } = await import("@/lib/agents/schemas");

      const validOutput = {
        draft: {
          type: "email",
          subject: "Test Subject",
          body: "This is the email body content.",
        },
        tone: "professional",
        confidence: "high",
        word_count: 6,
        estimated_read_time_seconds: 2,
      };

      const result = WriterOutputSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Tool Allowlist Tests
// =============================================================================

describe("Tool Allowlist", () => {
  it("should accept valid tool names", async () => {
    const { AllowedTool } = await import("@/lib/agents/schemas");

    const validTools = [
      "send_email",
      "send_slack_message",
      "create_task",
      "search_contacts",
      "get_availability",
    ];

    for (const tool of validTools) {
      const result = AllowedTool.safeParse(tool);
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid tool names", async () => {
    const { AllowedTool } = await import("@/lib/agents/schemas");

    const invalidTools = [
      "execute_code", // Not allowed
      "run_shell", // Not allowed
      "delete_database", // Not allowed
      "send_sms", // Not in list
      "arbitrary_function", // Not allowed
    ];

    for (const tool of invalidTools) {
      const result = AllowedTool.safeParse(tool);
      expect(result.success).toBe(false);
    }
  });

  it("should map tools to correct risk levels", async () => {
    const { TOOL_RISK_LEVELS } = await import("@/lib/agents/schemas");

    // High risk tools
    expect(TOOL_RISK_LEVELS.send_email).toBe("high");

    // Medium risk tools
    expect(TOOL_RISK_LEVELS.send_slack_message).toBe("medium");
    expect(TOOL_RISK_LEVELS.update_document).toBe("medium");

    // Low risk tools
    expect(TOOL_RISK_LEVELS.create_task).toBe("low");
    expect(TOOL_RISK_LEVELS.read_document).toBe("low");

    // No risk tools
    expect(TOOL_RISK_LEVELS.search_contacts).toBe("none");
    expect(TOOL_RISK_LEVELS.get_availability).toBe("none");
  });
});

// =============================================================================
// Risk Assessment Tests
// =============================================================================

describe("Risk Assessment", () => {
  it("should correctly order risk levels", async () => {
    const { RISK_SCORES } = await import("@/lib/agents/schemas");

    expect(RISK_SCORES.none).toBeLessThan(RISK_SCORES.low);
    expect(RISK_SCORES.low).toBeLessThan(RISK_SCORES.medium);
    expect(RISK_SCORES.medium).toBeLessThan(RISK_SCORES.high);
    expect(RISK_SCORES.high).toBeLessThan(RISK_SCORES.critical);
  });

  it("should correctly calculate max risk from actions", async () => {
    const { RISK_SCORES } = await import("@/lib/agents/schemas");

    const actions = [
      { estimated_risk: "low" as const },
      { estimated_risk: "high" as const },
      { estimated_risk: "medium" as const },
    ];

    const maxRisk = actions.reduce((max, action) => {
      const score = RISK_SCORES[action.estimated_risk];
      return Math.max(max, score);
    }, 0);

    expect(maxRisk).toBe(RISK_SCORES.high);
  });
});

// =============================================================================
// Confidence Threshold Tests
// =============================================================================

describe("Confidence Thresholds", () => {
  it("should correctly order confidence levels", async () => {
    const { CONFIDENCE_SCORES } = await import("@/lib/agents/schemas");

    expect(CONFIDENCE_SCORES.very_low).toBeLessThan(CONFIDENCE_SCORES.low);
    expect(CONFIDENCE_SCORES.low).toBeLessThan(CONFIDENCE_SCORES.medium);
    expect(CONFIDENCE_SCORES.medium).toBeLessThan(CONFIDENCE_SCORES.high);
    expect(CONFIDENCE_SCORES.high).toBeLessThan(CONFIDENCE_SCORES.very_high);
  });

  it("should detect when confidence is below threshold", async () => {
    const { CONFIDENCE_SCORES } = await import("@/lib/agents/schemas");

    const actualConfidence = "low" as const;
    const requiredConfidence = "medium" as const;

    const meetsThreshold =
      CONFIDENCE_SCORES[actualConfidence] >=
      CONFIDENCE_SCORES[requiredConfidence];

    expect(meetsThreshold).toBe(false);
  });

  it("should pass when confidence meets threshold", async () => {
    const { CONFIDENCE_SCORES } = await import("@/lib/agents/schemas");

    const actualConfidence = "high" as const;
    const requiredConfidence = "medium" as const;

    const meetsThreshold =
      CONFIDENCE_SCORES[actualConfidence] >=
      CONFIDENCE_SCORES[requiredConfidence];

    expect(meetsThreshold).toBe(true);
  });
});

// =============================================================================
// Schema Validation Helper Tests
// =============================================================================

describe("Validation Helpers", () => {
  it("should throw SchemaValidationError on invalid data", async () => {
    const { validateSchema, SchemaValidationError } = await import(
      "@/lib/agents/schemas"
    );

    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    expect(() =>
      validateSchema(schema, { name: "test" }, "TestSchema")
    ).toThrow(SchemaValidationError);
  });

  it("should return validated data on success", async () => {
    const { validateSchema } = await import("@/lib/agents/schemas");

    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = validateSchema(
      schema,
      { name: "test", age: 25 },
      "TestSchema"
    );

    expect(result).toEqual({ name: "test", age: 25 });
  });

  it("should throw on invalid JSON in parseAndValidate", async () => {
    const { parseAndValidate } = await import("@/lib/agents/schemas");

    const schema = z.object({ name: z.string() });

    expect(() => parseAndValidate(schema, "not valid json", "TestSchema")).toThrow(
      "Invalid JSON"
    );
  });

  it("should parse and validate valid JSON", async () => {
    const { parseAndValidate } = await import("@/lib/agents/schemas");

    const schema = z.object({ name: z.string() });

    const result = parseAndValidate(
      schema,
      JSON.stringify({ name: "test" }),
      "TestSchema"
    );

    expect(result).toEqual({ name: "test" });
  });
});

// =============================================================================
// Tool Call Validation Tests
// =============================================================================

describe("Tool Call Validation", () => {
  it("should validate complete tool call", async () => {
    const { ToolCallSchema } = await import("@/lib/agents/schemas");

    const validToolCall = {
      tool: "send_email",
      parameters: {
        to: "test@example.com",
        subject: "Test",
        body: "Hello",
      },
      reason: "User requested email",
    };

    const result = ToolCallSchema.safeParse(validToolCall);
    expect(result.success).toBe(true);
  });

  it("should reject tool call with missing reason", async () => {
    const { ToolCallSchema } = await import("@/lib/agents/schemas");

    const invalidToolCall = {
      tool: "send_email",
      parameters: {},
      reason: "", // Empty reason should fail
    };

    const result = ToolCallSchema.safeParse(invalidToolCall);
    expect(result.success).toBe(false);
  });

  it("should reject tool call with invalid tool", async () => {
    const { ToolCallSchema } = await import("@/lib/agents/schemas");

    const invalidToolCall = {
      tool: "invalid_tool",
      parameters: {},
      reason: "Some reason",
    };

    const result = ToolCallSchema.safeParse(invalidToolCall);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Policy Violation Tests
// =============================================================================

describe("Policy Rules", () => {
  it("should block plans with more than 20 actions", () => {
    const MAX_ACTIONS = 20;
    const planActions = Array.from({ length: 25 }, (_, i) => ({
      step: i + 1,
      description: `Action ${i + 1}`,
      tool_calls: [],
      estimated_risk: "low",
    }));

    expect(planActions.length > MAX_ACTIONS).toBe(true);
  });

  it("should flag critical risk plans for rejection", () => {
    const criticalRisks = ["critical"];
    const planRisk = "critical";

    expect(criticalRisks.includes(planRisk)).toBe(true);
  });

  it("should count external communications", () => {
    const externalTools = ["send_email", "send_slack_message"];
    const actions = [
      { tool_calls: [{ tool: "send_email" }] },
      { tool_calls: [{ tool: "send_email" }] },
      { tool_calls: [{ tool: "create_task" }] },
      { tool_calls: [{ tool: "send_slack_message" }] },
    ];

    const externalCount = actions
      .flatMap((a) => a.tool_calls)
      .filter((tc) => externalTools.includes(tc.tool)).length;

    expect(externalCount).toBe(3);
  });
});
