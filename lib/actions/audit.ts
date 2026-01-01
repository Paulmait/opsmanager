"use server";

import { requireActiveOrg } from "@/lib/guards";

// =============================================================================
// Types
// =============================================================================

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditFilters {
  action?: string;
  resource_type?: string;
  actor_id?: string;
  date_from?: string;
  date_to?: string;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Fetch audit logs for the current organization.
 *
 * SECURITY:
 * - Verifies org membership before fetching
 * - RLS enforces org isolation at database level
 * - Audit logs are append-only (triggers prevent modification)
 */
export async function getAuditLogs(
  filters?: AuditFilters,
  pagination?: { page: number; limit: number }
): Promise<{
  logs: AuditLogEntry[];
  total: number;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 50;
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false });

    // Apply filters
    if (filters?.action) {
      query = query.ilike("action", `%${filters.action}%`);
    }

    if (filters?.resource_type && filters.resource_type !== "all") {
      query = query.eq("resource_type", filters.resource_type);
    }

    if (filters?.actor_id) {
      query = query.eq("actor_id", filters.actor_id);
    }

    if (filters?.date_from) {
      query = query.gte("created_at", filters.date_from);
    }

    if (filters?.date_to) {
      query = query.lte("created_at", filters.date_to);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error("Failed to fetch audit logs:", error);
      return { logs: [], total: 0, error: error.message };
    }

    return {
      logs: data as AuditLogEntry[],
      total: count ?? 0,
      error: null,
    };
  } catch (error) {
    console.error("getAuditLogs error:", error);
    return { logs: [], total: 0, error: "Failed to fetch audit logs" };
  }
}

/**
 * Get unique resource types for filter dropdown.
 */
export async function getResourceTypes(): Promise<string[]> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("resource_type")
      .eq("organization_id", profile.organization_id)
      .limit(1000);

    if (error) {
      return [];
    }

    // Get unique resource types
    const types = [...new Set(data.map((d) => d.resource_type))];
    return types.filter(Boolean).sort();
  } catch {
    return [];
  }
}

/**
 * Get unique action types for filter dropdown.
 */
export async function getActionTypes(): Promise<string[]> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("action")
      .eq("organization_id", profile.organization_id)
      .limit(1000);

    if (error) {
      return [];
    }

    // Get unique action types
    const actions = [...new Set(data.map((d) => d.action))];
    return actions.filter(Boolean).sort();
  } catch {
    return [];
  }
}

/**
 * Export audit logs as JSON.
 *
 * SECURITY:
 * - Only admin/owner can export
 * - Exports only org's logs
 */
export async function exportAuditLogs(
  filters?: AuditFilters
): Promise<{ data: string | null; error: string | null }> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { data: null, error: "Insufficient permissions" };
    }

    // Build query
    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false });

    // Apply filters
    if (filters?.date_from) {
      query = query.gte("created_at", filters.date_from);
    }

    if (filters?.date_to) {
      query = query.lte("created_at", filters.date_to);
    }

    const { data, error } = await query.limit(10000);

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: JSON.stringify(data, null, 2), error: null };
  } catch {
    return { data: null, error: "Failed to export audit logs" };
  }
}
