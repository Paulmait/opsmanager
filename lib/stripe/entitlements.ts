import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { type PlanLimits, type PlanId, PLANS } from "./config";

const logger = createLogger({ module: "entitlements" });

// =============================================================================
// Types
// =============================================================================

export interface OrgEntitlements {
  orgId: string;
  plan: PlanId;
  limits: PlanLimits;
  subscriptionStatus: string;
  isActive: boolean;
}

export interface UsageCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  remaining: number;
  reason?: string;
}

export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
}

// =============================================================================
// Entitlement Functions
// =============================================================================

/**
 * Get organization entitlements.
 *
 * SECURITY:
 * - Fetches plan from database, never trusts client
 * - Returns verified limits from server
 */
export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements | null> {
  const supabase = createAdminClient();

  const { data: org, error } = await supabase
    .from("organizations")
    .select("plan, plan_limits, subscription_status")
    .eq("id", orgId)
    .single();

  if (error || !org) {
    logger.error("Failed to fetch org entitlements", { orgId, error: error?.message });
    return null;
  }

  const plan = (org.plan as PlanId) ?? "free";
  const planConfig = PLANS[plan] ?? PLANS.free;

  // Merge database limits with plan defaults
  const limits: PlanLimits = {
    ...planConfig.limits,
    ...(org.plan_limits as Partial<PlanLimits>),
  };

  const status = org.subscription_status ?? "none";
  const isActive = ["active", "trialing"].includes(status) || plan === "free";

  return {
    orgId,
    plan,
    limits,
    subscriptionStatus: status,
    isActive,
  };
}

/**
 * Check if usage is within limits and increment counter.
 *
 * SECURITY:
 * - Atomic increment + limit check
 * - Uses database function for consistency
 */
export async function checkAndIncrementUsage(
  orgId: string,
  usageType: "runs" | "sends" | "actions",
  amount: number = 1
): Promise<UsageCheckResult> {
  const supabase = createAdminClient();

  // Use database function for atomic operation
  const { data, error } = await supabase.rpc("increment_usage", {
    p_org_id: orgId,
    p_usage_type: usageType,
    p_amount: amount,
  });

  if (error) {
    logger.error("Failed to increment usage", { orgId, usageType, error: error.message });
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
 * Check current usage without incrementing.
 */
export async function getCurrentUsage(
  orgId: string
): Promise<{
  runsToday: number;
  sendsToday: number;
  runsLimit: number;
  sendsLimit: number;
} | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("get_org_usage", {
    p_org_id: orgId,
  });

  if (error) {
    logger.error("Failed to get usage", { orgId, error: error.message });
    return null;
  }

  const result = data?.[0];
  if (!result) return null;

  return {
    runsToday: result.runs_today,
    sendsToday: result.sends_today,
    runsLimit: result.runs_limit,
    sendsLimit: result.sends_limit,
  };
}

/**
 * Check if organization has a feature enabled.
 */
export async function checkFeature(
  orgId: string,
  feature: keyof PlanLimits["features"]
): Promise<FeatureCheckResult> {
  const entitlements = await getOrgEntitlements(orgId);

  if (!entitlements) {
    return {
      allowed: false,
      reason: "Organization not found",
    };
  }

  if (!entitlements.isActive) {
    return {
      allowed: false,
      reason: "Subscription is not active",
    };
  }

  const hasFeature = entitlements.limits.features[feature] ?? false;

  return {
    allowed: hasFeature,
    reason: hasFeature
      ? undefined
      : `Feature "${feature}" requires ${getRequiredPlanForFeature(feature)} plan or higher`,
  };
}

/**
 * Check limit without incrementing.
 */
export async function checkLimit(
  orgId: string,
  limitType: "integrations" | "team_members" | "contacts",
  currentCount: number
): Promise<UsageCheckResult> {
  const entitlements = await getOrgEntitlements(orgId);

  if (!entitlements) {
    return {
      allowed: false,
      currentCount,
      limit: 0,
      remaining: 0,
      reason: "Organization not found",
    };
  }

  const limitKey = `max_${limitType}` as keyof PlanLimits;
  const limit = entitlements.limits[limitKey] as number;

  const allowed = currentCount < limit;

  return {
    allowed,
    currentCount,
    limit,
    remaining: Math.max(0, limit - currentCount),
    reason: allowed
      ? undefined
      : `${limitType} limit reached (${currentCount}/${limit})`,
  };
}

/**
 * Check if org can perform an action (pre-flight check).
 */
export async function canPerformAction(
  orgId: string,
  action: "run" | "send" | "create_integration" | "add_team_member"
): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const entitlements = await getOrgEntitlements(orgId);

  if (!entitlements) {
    return { allowed: false, reason: "Organization not found" };
  }

  if (!entitlements.isActive && entitlements.plan !== "free") {
    return { allowed: false, reason: "Subscription is not active" };
  }

  // Check specific action limits
  switch (action) {
    case "run": {
      const usage = await getCurrentUsage(orgId);
      if (!usage) return { allowed: false, reason: "Failed to check usage" };
      if (usage.runsToday >= usage.runsLimit) {
        return {
          allowed: false,
          reason: `Daily run limit reached (${usage.runsToday}/${usage.runsLimit})`,
        };
      }
      return { allowed: true };
    }

    case "send": {
      const usage = await getCurrentUsage(orgId);
      if (!usage) return { allowed: false, reason: "Failed to check usage" };
      if (usage.sendsToday >= usage.sendsLimit) {
        return {
          allowed: false,
          reason: `Daily send limit reached (${usage.sendsToday}/${usage.sendsLimit})`,
        };
      }
      return { allowed: true };
    }

    case "create_integration": {
      const supabase = createAdminClient();
      const { count } = await supabase
        .from("integrations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId);

      const result = await checkLimit(orgId, "integrations", count ?? 0);
      return { allowed: result.allowed, reason: result.reason };
    }

    case "add_team_member": {
      const supabase = createAdminClient();
      const { count } = await supabase
        .from("org_members")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId);

      const result = await checkLimit(orgId, "team_members", count ?? 0);
      return { allowed: result.allowed, reason: result.reason };
    }

    default:
      return { allowed: true };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function getRequiredPlanForFeature(feature: keyof PlanLimits["features"]): string {
  // Find lowest plan that has this feature
  for (const plan of ["starter", "pro", "agency"] as PlanId[]) {
    if (PLANS[plan].limits.features[feature]) {
      return PLANS[plan].name;
    }
  }
  return "Agency";
}
