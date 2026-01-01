"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveOrg, requireRole } from "@/lib/guards";
import { revalidatePath } from "next/cache";

// =============================================================================
// Types
// =============================================================================

export interface Approval {
  id: string;
  agent_run_id: string;
  requested_actions: Array<{
    step: number;
    description: string;
    tool_calls: Array<{
      tool: string;
      parameters: Record<string, unknown>;
      reason: string;
    }>;
    estimated_risk: string;
  }>;
  risk_level: "none" | "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired";
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  expires_at: string | null;
  created_at: string;
  agent_run?: {
    id: string;
    agent_type: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
  };
}

export interface ApprovalFilters {
  status?: string;
  risk_level?: string;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Fetch approvals for the current organization.
 *
 * SECURITY:
 * - Verifies org membership before fetching
 * - RLS enforces org isolation at database level
 */
export async function getApprovals(filters?: ApprovalFilters): Promise<{
  approvals: Approval[];
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    let query = supabase
      .from("approvals")
      .select(
        `
        *,
        agent_run:agent_runs(id, agent_type, input, output)
      `
      )
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false });

    if (filters?.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters?.risk_level && filters.risk_level !== "all") {
      query = query.eq("risk_level", filters.risk_level);
    }

    const { data, error } = await query.limit(100);

    if (error) {
      console.error("Failed to fetch approvals:", error);
      return { approvals: [], error: error.message };
    }

    return { approvals: data as Approval[], error: null };
  } catch (error) {
    console.error("getApprovals error:", error);
    return { approvals: [], error: "Failed to fetch approvals" };
  }
}

/**
 * Get a single approval by ID.
 */
export async function getApproval(approvalId: string): Promise<{
  approval: Approval | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("approvals")
      .select(
        `
        *,
        agent_run:agent_runs(id, agent_type, input, output)
      `
      )
      .eq("id", approvalId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (error) {
      return { approval: null, error: "Approval not found" };
    }

    return { approval: data as Approval, error: null };
  } catch (error) {
    return { approval: null, error: "Failed to fetch approval" };
  }
}

/**
 * Get pending approvals count for badge display.
 */
export async function getPendingApprovalsCount(): Promise<number> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { count, error } = await supabase
      .from("approvals")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("status", "pending");

    if (error) {
      return 0;
    }

    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Approve a pending approval.
 *
 * SECURITY:
 * - Requires admin or owner role
 * - Validates approval belongs to org
 * - Validates approval is still pending
 */
export async function approveApproval(
  approvalId: string,
  reason?: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role - only admin or owner can approve
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions. Admin role required." };
    }

    // Fetch approval to validate state
    const { data: approval, error: fetchError } = await supabase
      .from("approvals")
      .select("status, expires_at")
      .eq("id", approvalId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (fetchError || !approval) {
      return { success: false, error: "Approval not found" };
    }

    if (approval.status !== "pending") {
      return { success: false, error: `Approval already ${approval.status}` };
    }

    if (approval.expires_at && new Date(approval.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from("approvals")
        .update({ status: "expired" })
        .eq("id", approvalId);
      return { success: false, error: "Approval has expired" };
    }

    // Update approval status
    const { error: updateError } = await supabase
      .from("approvals")
      .update({
        status: "approved",
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_reason: reason ?? null,
      })
      .eq("id", approvalId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "approval.approved",
      resource_type: "approval",
      resource_id: approvalId,
      metadata: { reason },
    });

    revalidatePath("/approvals");
    return { success: true, error: null };
  } catch (error) {
    console.error("approveApproval error:", error);
    return { success: false, error: "Failed to approve" };
  }
}

/**
 * Reject a pending approval.
 *
 * SECURITY:
 * - Requires admin or owner role
 */
export async function rejectApproval(
  approvalId: string,
  reason: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions. Admin role required." };
    }

    // Fetch approval to validate state
    const { data: approval, error: fetchError } = await supabase
      .from("approvals")
      .select("status")
      .eq("id", approvalId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (fetchError || !approval) {
      return { success: false, error: "Approval not found" };
    }

    if (approval.status !== "pending") {
      return { success: false, error: `Approval already ${approval.status}` };
    }

    // Update approval status
    const { error: updateError } = await supabase
      .from("approvals")
      .update({
        status: "rejected",
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_reason: reason,
      })
      .eq("id", approvalId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "approval.rejected",
      resource_type: "approval",
      resource_id: approvalId,
      metadata: { reason },
    });

    revalidatePath("/approvals");
    return { success: true, error: null };
  } catch (error) {
    console.error("rejectApproval error:", error);
    return { success: false, error: "Failed to reject" };
  }
}
