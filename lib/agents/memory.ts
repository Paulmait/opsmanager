import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ module: "agent-memory" });

// =============================================================================
// Types
// =============================================================================

export interface OrgMemory {
  preferences: Record<string, unknown>;
  recent_actions: RecentAction[];
  settings: OrgSettings;
  user_name?: string;
}

export interface RecentAction {
  id: string;
  agent_type: string;
  action: string;
  timestamp: string;
  success: boolean;
}

export interface OrgSettings {
  auto_approve_low_risk: boolean;
  max_auto_approve_risk: "none" | "low" | "medium";
  min_confidence_threshold: "very_low" | "low" | "medium" | "high" | "very_high";
  blocked_tools: string[];
  require_approval_tools: string[];
  default_tone: "formal" | "casual" | "professional" | "friendly";
  signature_template?: string;
}

// Default settings
const DEFAULT_ORG_SETTINGS: OrgSettings = {
  auto_approve_low_risk: true,
  max_auto_approve_risk: "low",
  min_confidence_threshold: "medium",
  blocked_tools: [],
  require_approval_tools: ["send_email"],
  default_tone: "professional",
};

// In-memory cache for org memory (production would use Redis)
const memoryCache = new Map<
  string,
  { data: OrgMemory; expires: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Memory Functions
// =============================================================================

/**
 * Get organization memory including preferences and recent actions.
 */
export async function getOrgMemory(orgId: string): Promise<OrgMemory> {
  // Check cache
  const cached = memoryCache.get(orgId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const supabase = createAdminClient();

  // Fetch org settings
  const settings = await getOrgSettings(orgId);

  // Fetch recent agent runs
  const { data: recentRuns, error: runsError } = await supabase
    .from("agent_runs")
    .select("id, agent_type, status, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (runsError) {
    logger.error("Failed to fetch recent runs", { error: runsError.message });
  }

  // Fetch org preferences (stored in org metadata or separate table)
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  const recentActions: RecentAction[] = (recentRuns ?? []).map((run) => ({
    id: run.id,
    agent_type: run.agent_type,
    action: `${run.agent_type}_run`,
    timestamp: run.created_at,
    success: run.status === "completed",
  }));

  const memory: OrgMemory = {
    preferences: {},
    recent_actions: recentActions,
    settings,
    user_name: org?.name,
  };

  // Cache the result
  memoryCache.set(orgId, {
    data: memory,
    expires: Date.now() + CACHE_TTL_MS,
  });

  return memory;
}

/**
 * Get organization settings for agent execution.
 */
export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  // In production, this would fetch from a settings table
  // For now, return defaults
  // TODO: Implement org_settings table

  return DEFAULT_ORG_SETTINGS;
}

/**
 * Update organization memory with new action.
 */
export async function recordAction(
  orgId: string,
  action: {
    agent_type: string;
    action_name: string;
    success: boolean;
  }
): Promise<void> {
  // Invalidate cache
  memoryCache.delete(orgId);

  // The action is already recorded in agent_runs table by the base agent
  // This function can be used for additional memory updates

  logger.debug("Action recorded", {
    orgId,
    ...action,
  });
}

/**
 * Store a preference for the organization.
 */
export async function setOrgPreference(
  orgId: string,
  key: string,
  value: unknown
): Promise<void> {
  // In production, this would update a preferences table
  // For now, just invalidate cache

  memoryCache.delete(orgId);

  logger.debug("Preference updated", { orgId, key });
}

/**
 * Get recent actions for context.
 */
export async function getRecentActions(
  orgId: string,
  limit = 10
): Promise<RecentAction[]> {
  const memory = await getOrgMemory(orgId);
  return memory.recent_actions.slice(0, limit);
}

/**
 * Clear memory cache for an organization.
 */
export function invalidateOrgMemory(orgId: string): void {
  memoryCache.delete(orgId);
}

/**
 * Clear entire memory cache.
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

// =============================================================================
// Context Building
// =============================================================================

/**
 * Build agent context from org memory.
 */
export async function buildAgentContext(
  orgId: string,
  userId: string,
  taskId?: string
): Promise<{
  organization_id: string;
  user_id: string;
  task_id?: string;
  preferences: Record<string, unknown>;
  recent_actions: string[];
}> {
  const memory = await getOrgMemory(orgId);

  return {
    organization_id: orgId,
    user_id: userId,
    task_id: taskId,
    preferences: memory.preferences,
    recent_actions: memory.recent_actions.map(
      (a) => `${a.agent_type}: ${a.action} (${a.success ? "success" : "failed"})`
    ),
  };
}
