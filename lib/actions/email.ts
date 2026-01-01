"use server";

import { requireActiveOrg } from "@/lib/guards";
import { getOrCreateEmailAlias, getEmailAlias, deactivateEmailAlias } from "@/lib/email";
import { serverEnv } from "@/lib/env";

// =============================================================================
// Types
// =============================================================================

export interface EmailAliasInfo {
  aliasAddress: string;
  aliasKey: string;
  isNew: boolean;
}

export interface InboundEmailSummary {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  status: string;
  hasAttachments: boolean;
  receivedAt: string;
  agentRunId: string | null;
}

export interface InboundEmailDetail extends InboundEmailSummary {
  messageId: string;
  threadId: string | null;
  toAddresses: string[];
  attachmentCount: number;
  processingError: string | null;
  processedAt: string | null;
  emailDate: string | null;
  provider: string;
}

// =============================================================================
// Email Alias Actions
// =============================================================================

/**
 * Get the email alias for the current org.
 * Creates one if it doesn't exist.
 */
export async function getOrgEmailAlias(): Promise<{
  alias: EmailAliasInfo | null;
  error: string | null;
}> {
  try {
    const { profile } = await requireActiveOrg();

    // Check if alias already exists
    const existing = await getEmailAlias(profile.organization_id);

    if (existing) {
      return {
        alias: {
          aliasAddress: existing.aliasAddress,
          aliasKey: existing.aliasKey,
          isNew: false,
        },
        error: null,
      };
    }

    // Create new alias
    const domain = serverEnv.EMAIL_DOMAIN;
    const result = await getOrCreateEmailAlias(profile.organization_id, domain);

    if (!result) {
      return { alias: null, error: "Failed to create email alias" };
    }

    return {
      alias: {
        aliasAddress: result.aliasAddress,
        aliasKey: result.aliasKey,
        isNew: result.isNew,
      },
      error: null,
    };
  } catch (error) {
    console.error("getOrgEmailAlias error:", error);
    return { alias: null, error: "Failed to get email alias" };
  }
}

/**
 * Regenerate the email alias for the current org.
 * Deactivates the old alias and creates a new one.
 *
 * SECURITY: Requires admin/owner role
 */
export async function regenerateEmailAlias(): Promise<{
  alias: EmailAliasInfo | null;
  error: string | null;
}> {
  try {
    const { profile } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { alias: null, error: "Insufficient permissions" };
    }

    // Deactivate existing alias
    await deactivateEmailAlias(profile.organization_id);

    // Create new alias
    const domain = serverEnv.EMAIL_DOMAIN;
    const result = await getOrCreateEmailAlias(profile.organization_id, domain);

    if (!result) {
      return { alias: null, error: "Failed to create new email alias" };
    }

    return {
      alias: {
        aliasAddress: result.aliasAddress,
        aliasKey: result.aliasKey,
        isNew: true,
      },
      error: null,
    };
  } catch (error) {
    console.error("regenerateEmailAlias error:", error);
    return { alias: null, error: "Failed to regenerate email alias" };
  }
}

// =============================================================================
// Inbound Email Actions
// =============================================================================

/**
 * Get list of inbound emails for the current org.
 */
export async function getInboundEmails(options: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<{
  emails: InboundEmailSummary[];
  total: number;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { limit = 20, offset = 0, status } = options;

    // Build query
    let query = supabase
      .from("inbound_emails")
      .select(
        `
        id,
        from_address,
        from_name,
        subject,
        snippet,
        status,
        has_attachments,
        received_at,
        agent_run_id
      `,
        { count: "exact" }
      )
      .eq("organization_id", profile.organization_id)
      .order("received_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("getInboundEmails error:", error);
      return { emails: [], total: 0, error: "Failed to fetch emails" };
    }

    const emails: InboundEmailSummary[] = (data ?? []).map((e) => ({
      id: e.id,
      fromAddress: e.from_address,
      fromName: e.from_name,
      subject: e.subject,
      snippet: e.snippet,
      status: e.status,
      hasAttachments: e.has_attachments,
      receivedAt: e.received_at,
      agentRunId: e.agent_run_id,
    }));

    return { emails, total: count ?? 0, error: null };
  } catch (error) {
    console.error("getInboundEmails error:", error);
    return { emails: [], total: 0, error: "Failed to fetch emails" };
  }
}

/**
 * Get details of a specific inbound email.
 */
export async function getInboundEmailDetail(
  emailId: string
): Promise<{
  email: InboundEmailDetail | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("inbound_emails")
      .select(
        `
        id,
        message_id,
        thread_id,
        from_address,
        from_name,
        to_addresses,
        subject,
        snippet,
        status,
        has_attachments,
        attachment_count,
        received_at,
        processed_at,
        email_date,
        agent_run_id,
        processing_error,
        provider
      `
      )
      .eq("id", emailId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (error || !data) {
      return { email: null, error: "Email not found" };
    }

    const email: InboundEmailDetail = {
      id: data.id,
      messageId: data.message_id,
      threadId: data.thread_id,
      fromAddress: data.from_address,
      fromName: data.from_name,
      toAddresses: data.to_addresses ?? [],
      subject: data.subject,
      snippet: data.snippet,
      status: data.status,
      hasAttachments: data.has_attachments,
      attachmentCount: data.attachment_count,
      receivedAt: data.received_at,
      processedAt: data.processed_at,
      emailDate: data.email_date,
      agentRunId: data.agent_run_id,
      processingError: data.processing_error,
      provider: data.provider,
    };

    return { email, error: null };
  } catch (error) {
    console.error("getInboundEmailDetail error:", error);
    return { email: null, error: "Failed to fetch email details" };
  }
}

/**
 * Get email statistics for the current org.
 */
export async function getEmailStats(): Promise<{
  stats: {
    totalReceived: number;
    processed: number;
    pending: number;
    failed: number;
    todayCount: number;
  } | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get counts by status
    const { data: statusCounts, error: countError } = await supabase
      .from("inbound_emails")
      .select("status", { count: "exact" })
      .eq("organization_id", profile.organization_id);

    if (countError) {
      return { stats: null, error: "Failed to fetch email stats" };
    }

    // Get today's count
    const { count: todayCount } = await supabase
      .from("inbound_emails")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .gte("received_at", today.toISOString());

    // Count by status
    const counts = {
      totalReceived: statusCounts?.length ?? 0,
      processed: 0,
      pending: 0,
      failed: 0,
    };

    for (const row of statusCounts ?? []) {
      if (row.status === "processed") counts.processed++;
      else if (row.status === "received" || row.status === "processing")
        counts.pending++;
      else if (row.status === "failed") counts.failed++;
    }

    return {
      stats: {
        ...counts,
        todayCount: todayCount ?? 0,
      },
      error: null,
    };
  } catch (error) {
    console.error("getEmailStats error:", error);
    return { stats: null, error: "Failed to fetch email stats" };
  }
}

/**
 * Retry processing a failed email.
 *
 * SECURITY: Requires admin/owner role
 */
export async function retryEmailProcessing(
  emailId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Get email
    const { data: email, error: fetchError } = await supabase
      .from("inbound_emails")
      .select("id, status")
      .eq("id", emailId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (fetchError || !email) {
      return { success: false, error: "Email not found" };
    }

    if (email.status !== "failed") {
      return { success: false, error: "Email is not in failed status" };
    }

    // Reset to received status for reprocessing
    const { error: updateError } = await supabase
      .from("inbound_emails")
      .update({
        status: "received",
        processing_error: null,
        processed_at: null,
        agent_run_id: null,
      })
      .eq("id", emailId);

    if (updateError) {
      return { success: false, error: "Failed to reset email status" };
    }

    // Note: In production, you would trigger reprocessing here
    // For MVP, the email will be picked up by a background job

    // Log audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: profile.id,
      action: "email.retry_processing",
      resource_type: "inbound_email",
      resource_id: emailId,
    });

    return { success: true, error: null };
  } catch (error) {
    console.error("retryEmailProcessing error:", error);
    return { success: false, error: "Failed to retry email processing" };
  }
}
