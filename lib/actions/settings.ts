"use server";

import { requireActiveOrg, requireRole } from "@/lib/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

export interface OrgSettings {
  id: string;
  organization_id: string;
  // Agent mode settings
  auto_draft_enabled: boolean;
  auto_send_enabled: boolean;
  auto_send_risk_threshold: "none" | "low" | "medium";
  auto_send_allowed_domains: string[];
  auto_send_allowed_recipients: string[];
  // Rate limits
  daily_send_limit: number;
  daily_run_limit: number;
  // Approval settings
  require_approval_tools: string[];
  min_confidence_threshold: "very_low" | "low" | "medium" | "high" | "very_high";
  // Content settings
  default_tone: "formal" | "casual" | "professional" | "friendly";
  signature_template: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

// Default settings
const DEFAULT_SETTINGS: Omit<OrgSettings, "id" | "organization_id" | "created_at" | "updated_at"> = {
  auto_draft_enabled: true,
  auto_send_enabled: false,
  auto_send_risk_threshold: "none",
  auto_send_allowed_domains: [],
  auto_send_allowed_recipients: [],
  daily_send_limit: 50,
  daily_run_limit: 100,
  require_approval_tools: ["send_email"],
  min_confidence_threshold: "medium",
  default_tone: "professional",
  signature_template: null,
};

// =============================================================================
// Validation Schemas
// =============================================================================

const AutoModeSettingsSchema = z.object({
  auto_draft_enabled: z.boolean(),
  auto_send_enabled: z.boolean(),
  auto_send_risk_threshold: z.enum(["none", "low", "medium"]),
  auto_send_allowed_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain format")),
  auto_send_allowed_recipients: z.array(z.string().email("Invalid email format")),
  daily_send_limit: z.number().int().min(0).max(1000),
});

const ApprovalSettingsSchema = z.object({
  require_approval_tools: z.array(z.string()),
  min_confidence_threshold: z.enum(["very_low", "low", "medium", "high", "very_high"]),
});

const ContentSettingsSchema = z.object({
  default_tone: z.enum(["formal", "casual", "professional", "friendly"]),
  signature_template: z.string().max(500).nullable(),
});

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get organization settings.
 *
 * SECURITY:
 * - Verifies org membership before fetching
 */
export async function getOrgSettings(): Promise<{
  settings: OrgSettings | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("org_settings")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .single();

    if (error) {
      // Settings don't exist yet, return defaults
      if (error.code === "PGRST116") {
        return {
          settings: {
            ...DEFAULT_SETTINGS,
            id: "",
            organization_id: profile.organization_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      return { settings: null, error: error.message };
    }

    return { settings: data as OrgSettings, error: null };
  } catch (error) {
    return { settings: null, error: "Failed to fetch settings" };
  }
}

/**
 * Update auto mode settings.
 *
 * SECURITY:
 * - Requires admin or owner role
 * - Validates input with Zod schema
 * - Logs changes to audit
 */
export async function updateAutoModeSettings(
  data: z.infer<typeof AutoModeSettingsSchema>
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions. Admin role required." };
    }

    // Validate input
    const validation = AutoModeSettingsSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid settings data" };
    }

    // Safety check: auto_send requires explicit domain/recipient allowlist
    if (
      validation.data.auto_send_enabled &&
      validation.data.auto_send_allowed_domains.length === 0 &&
      validation.data.auto_send_allowed_recipients.length === 0
    ) {
      return {
        success: false,
        error: "Auto-send requires at least one allowed domain or recipient",
      };
    }

    // Upsert settings
    const { error: upsertError } = await supabase.from("org_settings").upsert(
      {
        organization_id: profile.organization_id,
        ...validation.data,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "organization_id",
      }
    );

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "settings.auto_mode_updated",
      resource_type: "org_settings",
      metadata: {
        auto_draft_enabled: validation.data.auto_draft_enabled,
        auto_send_enabled: validation.data.auto_send_enabled,
        auto_send_risk_threshold: validation.data.auto_send_risk_threshold,
        allowed_domains_count: validation.data.auto_send_allowed_domains.length,
        allowed_recipients_count: validation.data.auto_send_allowed_recipients.length,
        daily_send_limit: validation.data.daily_send_limit,
      },
    });

    revalidatePath("/settings");
    return { success: true, error: null };
  } catch (error) {
    console.error("updateAutoModeSettings error:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Update approval settings.
 *
 * SECURITY:
 * - Requires admin or owner role
 */
export async function updateApprovalSettings(
  data: z.infer<typeof ApprovalSettingsSchema>
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Validate input
    const validation = ApprovalSettingsSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid settings data" };
    }

    // Upsert settings
    const { error: upsertError } = await supabase.from("org_settings").upsert(
      {
        organization_id: profile.organization_id,
        ...validation.data,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "organization_id",
      }
    );

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "settings.approval_updated",
      resource_type: "org_settings",
      metadata: validation.data,
    });

    revalidatePath("/settings");
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Update content settings.
 */
export async function updateContentSettings(
  data: z.infer<typeof ContentSettingsSchema>
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Validate input
    const validation = ContentSettingsSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, error: "Invalid settings data" };
    }

    // Upsert settings
    const { error: upsertError } = await supabase.from("org_settings").upsert(
      {
        organization_id: profile.organization_id,
        ...validation.data,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "organization_id",
      }
    );

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "settings.content_updated",
      resource_type: "org_settings",
      metadata: validation.data,
    });

    revalidatePath("/settings");
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Get current usage stats for rate limit display.
 */
export async function getUsageStats(): Promise<{
  runs_today: number;
  sends_today: number;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Count agent runs today
    const { count: runsCount } = await supabase
      .from("agent_runs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .gte("created_at", todayStart.toISOString());

    // Count sends today (approved email actions)
    const { count: sendsCount } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("action", "tool.send_email")
      .gte("created_at", todayStart.toISOString());

    return {
      runs_today: runsCount ?? 0,
      sends_today: sendsCount ?? 0,
      error: null,
    };
  } catch {
    return { runs_today: 0, sends_today: 0, error: "Failed to fetch usage" };
  }
}
