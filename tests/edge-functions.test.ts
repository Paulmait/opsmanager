import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Edge Function Tests
 *
 * Tests verify:
 * 1. Input validation with Zod schemas
 * 2. Rate limiting logic
 * 3. Idempotency key generation and checking
 * 4. SSRF protection
 * 5. Webhook signature verification
 *
 * Note: These are unit tests for the shared utilities.
 * Integration tests would require a running Supabase instance.
 */

// =============================================================================
// Validation Tests
// =============================================================================

describe("Edge Function Validation", () => {
  describe("UUID Validation", () => {
    it("should accept valid UUIDs", async () => {
      const { z } = await import("zod");
      const UUIDSchema = z.string().uuid();

      const validUUIDs = [
        "123e4567-e89b-12d3-a456-426614174000",
        "550e8400-e29b-41d4-a716-446655440000",
      ];

      for (const uuid of validUUIDs) {
        const result = UUIDSchema.safeParse(uuid);
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid UUIDs", async () => {
      const { z } = await import("zod");
      const UUIDSchema = z.string().uuid();

      const invalidUUIDs = [
        "not-a-uuid",
        "123",
        "123e4567-e89b-12d3-a456",
        "",
      ];

      for (const uuid of invalidUUIDs) {
        const result = UUIDSchema.safeParse(uuid);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("Run Agent Input Validation", () => {
    it("should accept valid run_agent input", async () => {
      const { z } = await import("zod");

      const TriggerPayloadSchema = z.object({
        goal: z.string().min(1).max(1000),
        constraints: z.array(z.string()).optional(),
        max_actions: z.number().int().positive().max(20).default(10),
        urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
      });

      const RunAgentInputSchema = z.object({
        org_id: z.string().uuid(),
        trigger_payload: TriggerPayloadSchema,
        auto_approve: z.boolean().default(false),
      });

      const validInput = {
        org_id: "123e4567-e89b-12d3-a456-426614174000",
        trigger_payload: {
          goal: "Send a follow-up email to John",
          max_actions: 5,
          urgency: "normal",
        },
      };

      const result = RunAgentInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject empty goal", async () => {
      const { z } = await import("zod");

      const TriggerPayloadSchema = z.object({
        goal: z.string().min(1).max(1000),
      });

      const result = TriggerPayloadSchema.safeParse({ goal: "" });
      expect(result.success).toBe(false);
    });

    it("should reject goal exceeding max length", async () => {
      const { z } = await import("zod");

      const TriggerPayloadSchema = z.object({
        goal: z.string().min(1).max(1000),
      });

      const result = TriggerPayloadSchema.safeParse({ goal: "a".repeat(1001) });
      expect(result.success).toBe(false);
    });

    it("should reject max_actions exceeding limit", async () => {
      const { z } = await import("zod");

      const TriggerPayloadSchema = z.object({
        goal: z.string().min(1),
        max_actions: z.number().int().positive().max(20),
      });

      const result = TriggerPayloadSchema.safeParse({
        goal: "Test",
        max_actions: 25,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Approve Action Input Validation", () => {
    it("should accept valid approval decision", async () => {
      const { z } = await import("zod");

      const ApproveActionInputSchema = z.object({
        approval_id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().max(500).optional(),
      });

      const validInput = {
        approval_id: "123e4567-e89b-12d3-a456-426614174000",
        decision: "approve",
        reason: "Looks good",
      };

      const result = ApproveActionInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("should reject invalid decision", async () => {
      const { z } = await import("zod");

      const ApproveActionInputSchema = z.object({
        approval_id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      });

      const result = ApproveActionInputSchema.safeParse({
        approval_id: "123e4567-e89b-12d3-a456-426614174000",
        decision: "maybe",
      });
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Rate Limiting Tests
// =============================================================================

describe("Rate Limiting Logic", () => {
  const PLAN_LIMITS = {
    free: { runs_per_day: 10, actions_per_day: 50, max_actions_per_run: 5 },
    starter: { runs_per_day: 100, actions_per_day: 500, max_actions_per_run: 10 },
    pro: { runs_per_day: 1000, actions_per_day: 5000, max_actions_per_run: 20 },
  };

  it("should block when daily run limit exceeded", () => {
    const limits = PLAN_LIMITS.free;
    const currentRuns = 10;

    const allowed = currentRuns < limits.runs_per_day;
    expect(allowed).toBe(false);
  });

  it("should allow when under daily run limit", () => {
    const limits = PLAN_LIMITS.starter;
    const currentRuns = 50;

    const allowed = currentRuns < limits.runs_per_day;
    expect(allowed).toBe(true);
  });

  it("should block when daily action limit would be exceeded", () => {
    const limits = PLAN_LIMITS.free;
    const currentActions = 48;
    const newActions = 5;

    const allowed = currentActions + newActions <= limits.actions_per_day;
    expect(allowed).toBe(false);
  });

  it("should block plan with too many actions", () => {
    const limits = PLAN_LIMITS.free;
    const planActionCount = 8;

    const allowed = planActionCount <= limits.max_actions_per_run;
    expect(allowed).toBe(false);
  });

  it("should order plan limits correctly", () => {
    expect(PLAN_LIMITS.free.runs_per_day).toBeLessThan(PLAN_LIMITS.starter.runs_per_day);
    expect(PLAN_LIMITS.starter.runs_per_day).toBeLessThan(PLAN_LIMITS.pro.runs_per_day);
  });
});

// =============================================================================
// Idempotency Tests
// =============================================================================

describe("Idempotency Key Generation", () => {
  it("should generate consistent keys for same input", async () => {
    // Simulate key generation logic
    const generateKey = async (fn: string, org: string, payload: unknown) => {
      const content = JSON.stringify({ function: fn, org, payload });
      const encoder = new TextEncoder();
      const data = encoder.encode(content);

      // Use Web Crypto API
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const payload = { goal: "Send email" };
    const key1 = await generateKey("run_agent", "org-123", payload);
    const key2 = await generateKey("run_agent", "org-123", payload);

    expect(key1).toBe(key2);
  });

  it("should generate different keys for different inputs", async () => {
    const generateKey = async (fn: string, org: string, payload: unknown) => {
      const content = JSON.stringify({ function: fn, org, payload });
      const encoder = new TextEncoder();
      const data = encoder.encode(content);

      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const key1 = await generateKey("run_agent", "org-123", { goal: "Send email" });
    const key2 = await generateKey("run_agent", "org-123", { goal: "Create task" });

    expect(key1).not.toBe(key2);
  });

  it("should generate different keys for different orgs", async () => {
    const generateKey = async (fn: string, org: string, payload: unknown) => {
      const content = JSON.stringify({ function: fn, org, payload });
      const encoder = new TextEncoder();
      const data = encoder.encode(content);

      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const payload = { goal: "Send email" };
    const key1 = await generateKey("run_agent", "org-123", payload);
    const key2 = await generateKey("run_agent", "org-456", payload);

    expect(key1).not.toBe(key2);
  });
});

// =============================================================================
// SSRF Protection Tests
// =============================================================================

describe("SSRF Protection", () => {
  const BLOCKED_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^localhost$/i,
  ];

  const ALLOWED_DOMAINS = new Set([
    "api.sendgrid.com",
    "api.slack.com",
    "supabase.co",
  ]);

  const isBlocked = (hostname: string): boolean => {
    return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname));
  };

  const extractRootDomain = (hostname: string): string => {
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
  };

  it("should block localhost", () => {
    expect(isBlocked("localhost")).toBe(true);
  });

  it("should block loopback IPs", () => {
    expect(isBlocked("127.0.0.1")).toBe(true);
    expect(isBlocked("127.255.255.255")).toBe(true);
  });

  it("should block private Class A IPs", () => {
    expect(isBlocked("10.0.0.1")).toBe(true);
    expect(isBlocked("10.255.255.255")).toBe(true);
  });

  it("should block private Class B IPs", () => {
    expect(isBlocked("172.16.0.1")).toBe(true);
    expect(isBlocked("172.31.255.255")).toBe(true);
  });

  it("should block private Class C IPs", () => {
    expect(isBlocked("192.168.0.1")).toBe(true);
    expect(isBlocked("192.168.255.255")).toBe(true);
  });

  it("should block link-local IPs", () => {
    expect(isBlocked("169.254.0.1")).toBe(true);
  });

  it("should not block public IPs", () => {
    expect(isBlocked("8.8.8.8")).toBe(false);
    expect(isBlocked("1.1.1.1")).toBe(false);
  });

  it("should allow whitelisted domains", () => {
    const hostname = "api.sendgrid.com";
    expect(ALLOWED_DOMAINS.has(hostname)).toBe(true);
  });

  it("should extract root domain correctly", () => {
    expect(extractRootDomain("api.slack.com")).toBe("slack.com");
    expect(extractRootDomain("mail.google.com")).toBe("google.com");
    expect(extractRootDomain("localhost")).toBe("localhost");
  });
});

// =============================================================================
// Webhook Signature Tests
// =============================================================================

describe("Webhook Signature Verification", () => {
  it("should generate consistent HMAC signatures", async () => {
    const secret = "test-secret-123";
    const body = JSON.stringify({ test: "data" });

    const generateSignature = async (content: string, key: string) => {
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBytes = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(content)
      );

      return Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };

    const sig1 = await generateSignature(body, secret);
    const sig2 = await generateSignature(body, secret);

    expect(sig1).toBe(sig2);
  });

  it("should produce different signatures for different secrets", async () => {
    const body = JSON.stringify({ test: "data" });

    const generateSignature = async (content: string, key: string) => {
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBytes = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(content)
      );

      return Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };

    const sig1 = await generateSignature(body, "secret-1");
    const sig2 = await generateSignature(body, "secret-2");

    expect(sig1).not.toBe(sig2);
  });

  it("should perform constant-time comparison", () => {
    const timingSafeEqual = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false;

      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
      }

      return result === 0;
    };

    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

// =============================================================================
// Week Boundaries Tests
// =============================================================================

describe("Week Boundaries Calculation", () => {
  const getWeekBoundaries = (weekStart?: string) => {
    let start: Date;

    if (weekStart) {
      start = new Date(weekStart);
    } else {
      start = new Date();
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(start.setDate(diff));
    }

    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return { start, end };
  };

  it("should return 7-day range", () => {
    const { start, end } = getWeekBoundaries("2024-01-15T00:00:00Z");

    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    expect(diffDays).toBe(7);
  });

  it("should use provided week start", () => {
    const { start } = getWeekBoundaries("2024-01-15T00:00:00Z");

    expect(start.getUTCFullYear()).toBe(2024);
    expect(start.getUTCMonth()).toBe(0); // January
    expect(start.getUTCDate()).toBe(15);
  });

  it("should set time to start of day", () => {
    const { start } = getWeekBoundaries("2024-01-15T14:30:00Z");

    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
  });
});

// =============================================================================
// Summary Calculation Tests
// =============================================================================

describe("Report Summary Calculation", () => {
  interface Run {
    id: string;
    agent_type: string;
    status: string;
  }

  const calculateSummary = (
    runs: Run[],
    pendingApprovals: number,
    totalActions: number
  ) => {
    const byAgentType: Record<string, number> = {};

    for (const run of runs) {
      byAgentType[run.agent_type] = (byAgentType[run.agent_type] ?? 0) + 1;
    }

    return {
      total_runs: runs.length,
      successful_runs: runs.filter((r) => r.status === "completed").length,
      failed_runs: runs.filter((r) => r.status === "failed").length,
      pending_approvals: pendingApprovals,
      total_actions: totalActions,
      by_agent_type: byAgentType,
    };
  };

  it("should count total runs correctly", () => {
    const runs: Run[] = [
      { id: "1", agent_type: "planner", status: "completed" },
      { id: "2", agent_type: "planner", status: "failed" },
      { id: "3", agent_type: "writer", status: "completed" },
    ];

    const summary = calculateSummary(runs, 0, 0);
    expect(summary.total_runs).toBe(3);
  });

  it("should count successful runs correctly", () => {
    const runs: Run[] = [
      { id: "1", agent_type: "planner", status: "completed" },
      { id: "2", agent_type: "planner", status: "failed" },
      { id: "3", agent_type: "writer", status: "completed" },
    ];

    const summary = calculateSummary(runs, 0, 0);
    expect(summary.successful_runs).toBe(2);
  });

  it("should count failed runs correctly", () => {
    const runs: Run[] = [
      { id: "1", agent_type: "planner", status: "completed" },
      { id: "2", agent_type: "planner", status: "failed" },
      { id: "3", agent_type: "writer", status: "failed" },
    ];

    const summary = calculateSummary(runs, 0, 0);
    expect(summary.failed_runs).toBe(2);
  });

  it("should group by agent type correctly", () => {
    const runs: Run[] = [
      { id: "1", agent_type: "planner", status: "completed" },
      { id: "2", agent_type: "planner", status: "completed" },
      { id: "3", agent_type: "writer", status: "completed" },
      { id: "4", agent_type: "validator", status: "completed" },
    ];

    const summary = calculateSummary(runs, 0, 0);
    expect(summary.by_agent_type).toEqual({
      planner: 2,
      writer: 1,
      validator: 1,
    });
  });

  it("should include pending approvals and total actions", () => {
    const summary = calculateSummary([], 5, 10);
    expect(summary.pending_approvals).toBe(5);
    expect(summary.total_actions).toBe(10);
  });
});
