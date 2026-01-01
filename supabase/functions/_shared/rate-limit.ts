/**
 * Rate limiting for Edge Functions
 *
 * SECURITY:
 * - Enforces per-plan limits for runs/day, sends/day, and actions/day
 * - Uses database for distributed rate limiting with atomic increments
 * - Fetches limits from org's plan_limits JSONB (never trusts client)
 * - Prevents abuse and runaway costs
 */

import { createAdminClient } from "./auth.ts";

// =============================================================================
// Types
// =============================================================================

export interface PlanLimits {
  runs_per_day: number;
  sends_per_day: number;
  max_actions_per_run: number;
  max_integrations: number;
  max_team_members: number;
  max_contacts: number;
  features: {
    auto_send: boolean;
    api_access: boolean;
    custom_branding: boolean;
    priority_support: boolean;
    sso: boolean;
    audit_export: boolean;
  };
}

export interface UsageCounts {
  runs_today: number;
  sends_today: number;
  actions_today: number;
}

export interface RateLimitResult {
  allowed: boolean;
  current: UsageCounts;
  limits: PlanLimits;
  reason?: string;
}

export interface UsageIncrementResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  remaining: number;
  reason?: string;
}

// =============================================================================
// Default Plan Limits (fallback if DB fetch fails)
// =============================================================================

const DEFAULT_PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    runs_per_day: 10,
    sends_per_day: 5,
    max_actions_per_run: 5,
    max_integrations: 2,
    max_team_members: 2,
    max_contacts: 100,
    features: {
      auto_send: false,
      api_access: false,
      custom_branding: false,
      priority_support: false,
      sso: false,
      audit_export: false,
    },
  },
  starter: {
    runs_per_day: 100,
    sends_per_day: 50,
    max_actions_per_run: 10,
    max_integrations: 5,
    max_team_members: 5,
    max_contacts: 1000,
    features: {
      auto_send: true,
      api_access: false,
      custom_branding: false,
      priority_support: false,
      sso: false,
      audit_export: false,
    },
  },
  pro: {
    runs_per_day: 1000,
    sends_per_day: 500,
    max_actions_per_run: 20,
    max_integrations: 20,
    max_team_members: 20,
    max_contacts: 10000,
    features: {
      auto_send: true,
      api_access: true,
      custom_branding: true,
      priority_support: true,
      sso: false,
      audit_export: true,
    },
  },
  agency: {
    runs_per_day: 10000,
    sends_per_day: 5000,
    max_actions_per_run: 50,
    max_integrations: 100,
    max_team_members: 100,
    max_contacts: 100000,
    features: {
      auto_send: true,
      api_access: true,
      custom_branding: true,
      priority_support: true,
      sso: true,
      audit_export: true,
    },
  },
};

// =============================================================================
// Rate Limit Functions
// =============================================================================

/**
 * Get organization's plan and limits from database.
 *
 * SECURITY:
 * - Fetches actual plan from organizations table
 * - Uses plan_limits JSONB for custom/override limits
 * - Falls back to plan defaults if plan_limits is empty
 */
export async function getOrgLimits(orgId: string): Promise<PlanLimits> {
  const supabase = createAdminClient();

  const { data: org, error } = await supabase
    .from("organizations")
    .select("plan, plan_limits, subscription_status")
    .eq("id", orgId)
    .single();

  if (error || !org) {
    console.error("Failed to fetch org limits:", error?.message);
    return DEFAULT_PLAN_LIMITS.free;
  }

  const plan = (org.plan as string) ?? "free";
  const planDefaults = DEFAULT_PLAN_LIMITS[plan] ?? DEFAULT_PLAN_LIMITS.free;

  // Check subscription status - inactive subscriptions get free limits
  const status = org.subscription_status;
  if (plan !== "free" && !["active", "trialing"].includes(status ?? "")) {
    return DEFAULT_PLAN_LIMITS.free;
  }

  // Merge plan defaults with any custom limits from plan_limits JSONB
  const customLimits = org.plan_limits as Partial<PlanLimits> | null;

  if (!customLimits || Object.keys(customLimits).length === 0) {
    return planDefaults;
  }

  return {
    ...planDefaults,
    ...customLimits,
    features: {
      ...planDefaults.features,
      ...(customLimits.features ?? {}),
    },
  };
}

/**
 * Get today's usage counts using the database function.
 */
export async function getUsageCounts(orgId: string): Promise<UsageCounts> {
  const supabase = createAdminClient();

  // Use database function for consistent counting
  const { data, error } = await supabase.rpc("get_org_usage", {
    p_org_id: orgId,
  });

  if (error || !data?.[0]) {
    console.error("Failed to get usage counts:", error?.message);
    // Return zeros on error - fail open for reads, fail closed for increments
    return {
      runs_today: 0,
      sends_today: 0,
      actions_today: 0,
    };
  }

  const result = data[0];
  return {
    runs_today: result.runs_today ?? 0,
    sends_today: result.sends_today ?? 0,
    actions_today: 0, // Computed from runs for now
  };
}

/**
 * Check if an agent run is allowed within rate limits.
 */
export async function checkRunLimit(orgId: string): Promise<RateLimitResult> {
  const [limits, current] = await Promise.all([
    getOrgLimits(orgId),
    getUsageCounts(orgId),
  ]);

  if (current.runs_today >= limits.runs_per_day) {
    return {
      allowed: false,
      current,
      limits,
      reason: `Daily run limit reached (${current.runs_today}/${limits.runs_per_day})`,
    };
  }

  return {
    allowed: true,
    current,
    limits,
  };
}

/**
 * Check and atomically increment usage counter.
 *
 * SECURITY:
 * - Uses atomic database function to prevent race conditions
 * - Increment happens only if within limits
 * - Returns updated count after increment attempt
 */
export async function checkAndIncrementUsage(
  orgId: string,
  usageType: "runs" | "sends" | "actions",
  amount: number = 1
): Promise<UsageIncrementResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("increment_usage", {
    p_org_id: orgId,
    p_usage_type: usageType,
    p_amount: amount,
  });

  if (error) {
    console.error("Failed to increment usage:", error.message);
    // Fail closed - deny if we can't check
    return {
      allowed: false,
      currentCount: 0,
      limit: 0,
      remaining: 0,
      reason: "Failed to check usage limits",
    };
  }

  const result = data?.[0];
  if (!result) {
    return {
      allowed: false,
      currentCount: 0,
      limit: 0,
      remaining: 0,
      reason: "Invalid usage check result",
    };
  }

  return {
    allowed: result.success,
    currentCount: result.current_count,
    limit: result.limit_value,
    remaining: result.remaining,
    reason: result.success
      ? undefined
      : `${usageType} limit exceeded (${result.current_count}/${result.limit_value})`,
  };
}

/**
 * Check if an action execution is allowed within rate limits.
 */
export async function checkActionLimit(
  orgId: string,
  actionCount: number = 1
): Promise<RateLimitResult> {
  const [limits, current] = await Promise.all([
    getOrgLimits(orgId),
    getUsageCounts(orgId),
  ]);

  // Actions counted as part of sends for now
  if (current.sends_today + actionCount > limits.sends_per_day) {
    return {
      allowed: false,
      current,
      limits,
      reason: `Daily send limit would be exceeded (${limits.sends_per_day}/day)`,
    };
  }

  return {
    allowed: true,
    current,
    limits,
  };
}

/**
 * Check if a plan has valid action count per run.
 */
export function checkMaxActionsPerRun(
  actionCount: number,
  limits: PlanLimits
): { allowed: boolean; reason?: string } {
  if (actionCount > limits.max_actions_per_run) {
    return {
      allowed: false,
      reason: `Plan exceeds maximum actions per run (${actionCount}/${limits.max_actions_per_run})`,
    };
  }

  return { allowed: true };
}

/**
 * Check if org has a specific feature enabled.
 */
export async function checkFeature(
  orgId: string,
  feature: keyof PlanLimits["features"]
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await getOrgLimits(orgId);

  if (!limits.features[feature]) {
    return {
      allowed: false,
      reason: `Feature "${feature}" is not available on your plan`,
    };
  }

  return { allowed: true };
}

/**
 * Check if org is within a count-based limit.
 */
export async function checkCountLimit(
  orgId: string,
  limitType: "integrations" | "team_members" | "contacts",
  currentCount: number
): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
  const limits = await getOrgLimits(orgId);

  const limitKey = `max_${limitType}` as keyof PlanLimits;
  const limit = limits[limitKey] as number;

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `${limitType} limit reached (${currentCount}/${limit})`,
    };
  }

  return {
    allowed: true,
    remaining: limit - currentCount,
  };
}

// =============================================================================
// Error Classes
// =============================================================================

export class RateLimitError extends Error {
  public readonly result: RateLimitResult;

  constructor(result: RateLimitResult) {
    super(result.reason ?? "Rate limit exceeded");
    this.name = "RateLimitError";
    this.result = result;
  }
}
