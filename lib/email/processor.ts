import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { checkAndIncrementUsage } from "@/lib/stripe/entitlements";
import { parseInboundEmail, extractAliasKey } from "./parser";
import { verifyWebhookSignature } from "./signature";
import type {
  EmailProvider,
  InboundEmailPayload,
  EmailProcessingResult,
} from "./types";

const logger = createLogger({ module: "email-processor" });

// =============================================================================
// Configuration
// =============================================================================

interface EmailProcessorConfig {
  provider: EmailProvider;
  webhookSecret: string;
}

// =============================================================================
// Main Processor
// =============================================================================

/**
 * Process inbound email webhook.
 *
 * SECURITY:
 * - Verifies webhook signature first
 * - Checks idempotency before processing
 * - Validates org ownership via alias
 * - Enforces rate limits before agent trigger
 */
export async function processInboundEmail(
  config: EmailProcessorConfig,
  payload: unknown,
  headers: Record<string, string | undefined>
): Promise<EmailProcessingResult> {
  const supabase = createAdminClient();

  // Step 1: Verify webhook signature
  const signatureResult = verifyWebhookSignature(
    config.provider,
    config.webhookSecret,
    typeof payload === "string" ? payload : JSON.stringify(payload),
    headers
  );

  if (!signatureResult.valid) {
    logger.warn("Invalid webhook signature", {
      provider: config.provider,
      error: signatureResult.error,
    });
    return {
      success: false,
      error: signatureResult.error ?? "Invalid signature",
    };
  }

  // Step 2: Parse email payload
  const parsed = parseInboundEmail(config.provider, payload);

  if (!parsed) {
    logger.error("Failed to parse email payload", { provider: config.provider });
    return {
      success: false,
      error: "Failed to parse email payload",
    };
  }

  // Step 3: Check idempotency
  const { data: isNew } = await supabase.rpc("check_email_webhook_idempotency", {
    p_provider: config.provider,
    p_event_id: parsed.providerEventId,
  });

  if (!isNew) {
    logger.info("Duplicate email webhook event", {
      provider: config.provider,
      eventId: parsed.providerEventId,
    });
    return {
      success: true,
      skipped: true,
      skipReason: "Duplicate event",
    };
  }

  // Step 4: Extract alias key and look up org
  const aliasKey = extractAliasKey(parsed.recipientAlias);

  if (!aliasKey) {
    logger.warn("Invalid email alias format", {
      recipient: parsed.recipientAlias,
    });
    return {
      success: false,
      error: "Invalid email alias format",
    };
  }

  const { data: orgId } = await supabase.rpc("get_org_by_alias_key", {
    p_alias_key: aliasKey,
  });

  if (!orgId) {
    logger.warn("No org found for alias", { aliasKey });
    return {
      success: false,
      error: "Unknown email alias",
    };
  }

  // Step 5: Store email record
  const result = await storeAndProcessEmail(supabase, orgId, parsed);

  return result;
}

// =============================================================================
// Store and Process Email
// =============================================================================

async function storeAndProcessEmail(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  parsed: InboundEmailPayload
): Promise<EmailProcessingResult> {
  const email = parsed.parsedEmail;

  // Insert email record
  const { data: emailRecord, error: insertError } = await supabase
    .from("inbound_emails")
    .insert({
      organization_id: orgId,
      message_id: email.messageId,
      thread_id: email.threadId,
      in_reply_to: email.inReplyTo,
      from_address: email.from.address,
      from_name: email.from.name,
      to_addresses: email.to,
      subject: email.subject,
      snippet: email.snippet,
      has_attachments: email.hasAttachments,
      attachment_count: email.attachmentCount,
      status: "received",
      email_date: email.date?.toISOString(),
      provider: parsed.provider,
      provider_event_id: parsed.providerEventId,
      raw_headers: email.headers,
    })
    .select("id")
    .single();

  if (insertError) {
    // Check if duplicate
    if (insertError.code === "23505") {
      logger.info("Duplicate email message", {
        orgId,
        messageId: email.messageId,
      });
      return {
        success: true,
        skipped: true,
        skipReason: "Duplicate message",
      };
    }

    logger.error("Failed to insert email record", {
      orgId,
      error: insertError.message,
    });
    return {
      success: false,
      error: "Failed to store email",
    };
  }

  const emailId = emailRecord.id;

  // Update status to processing
  await supabase
    .from("inbound_emails")
    .update({ status: "processing" })
    .eq("id", emailId);

  // Check rate limits for runs
  const usageResult = await checkAndIncrementUsage(orgId, "runs", 1);

  if (!usageResult.allowed) {
    logger.warn("Rate limit exceeded for email processing", {
      orgId,
      emailId,
      reason: usageResult.reason,
    });

    await supabase
      .from("inbound_emails")
      .update({
        status: "ignored",
        processing_error: usageResult.reason,
        processed_at: new Date().toISOString(),
      })
      .eq("id", emailId);

    return {
      success: true,
      emailId,
      skipped: true,
      skipReason: usageResult.reason,
    };
  }

  // Trigger agent run
  try {
    const agentRunId = await triggerAgentRun(supabase, orgId, emailId, email);

    // Update email with agent run reference
    await supabase
      .from("inbound_emails")
      .update({
        status: "processed",
        agent_run_id: agentRunId,
        processed_at: new Date().toISOString(),
      })
      .eq("id", emailId);

    logger.info("Email processed successfully", {
      orgId,
      emailId,
      agentRunId,
    });

    return {
      success: true,
      emailId,
      agentRunId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await supabase
      .from("inbound_emails")
      .update({
        status: "failed",
        processing_error: message,
        processed_at: new Date().toISOString(),
      })
      .eq("id", emailId);

    logger.error("Failed to trigger agent run", {
      orgId,
      emailId,
      error: message,
    });

    return {
      success: false,
      emailId,
      error: message,
    };
  }
}

// =============================================================================
// Agent Trigger
// =============================================================================

/**
 * Trigger agent run for email processing.
 */
async function triggerAgentRun(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  emailId: string,
  email: InboundEmailPayload["parsedEmail"]
): Promise<string> {
  // Build goal from email content
  const goal = buildGoalFromEmail(email);

  // Create agent run record
  const { data: runRecord, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: orgId,
      agent_type: "planner",
      input: {
        goal,
        source: "email",
        email: {
          id: emailId,
          from: email.from.address,
          subject: email.subject,
          snippet: email.snippet,
          hasAttachments: email.hasAttachments,
        },
        constraints: [
          "This request came from an inbound email",
          "Any outbound action requires human approval",
          "Verify sender identity before taking action",
        ],
      },
      status: "pending",
      created_by: "email-ingestion",
    })
    .select("id")
    .single();

  if (runError || !runRecord) {
    throw new Error(`Failed to create agent run: ${runError?.message}`);
  }

  // Log to audit
  await supabase.from("audit_logs").insert({
    organization_id: orgId,
    actor_id: "email-ingestion",
    action: "email.processed",
    resource_type: "inbound_email",
    resource_id: emailId,
    metadata: {
      from: email.from.address,
      subject: email.subject,
      agent_run_id: runRecord.id,
    },
  });

  return runRecord.id;
}

/**
 * Build agent goal from email content.
 */
function buildGoalFromEmail(
  email: InboundEmailPayload["parsedEmail"]
): string {
  const parts: string[] = [];

  parts.push(`Process inbound email from ${email.from.address}`);

  if (email.subject) {
    parts.push(`Subject: "${email.subject}"`);
  }

  if (email.snippet) {
    parts.push(`Content preview: "${email.snippet}"`);
  }

  if (email.hasAttachments) {
    parts.push(`(${email.attachmentCount} attachment${email.attachmentCount > 1 ? "s" : ""})`);
  }

  return parts.join(". ");
}

// =============================================================================
// Alias Management
// =============================================================================

/**
 * Get or create email alias for organization.
 */
export async function getOrCreateEmailAlias(
  orgId: string,
  domain: string = "mail.opsmanager.app"
): Promise<{ aliasAddress: string; aliasKey: string; isNew: boolean } | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("create_org_email_alias", {
    p_org_id: orgId,
    p_domain: domain,
  });

  if (error || !data?.[0]) {
    logger.error("Failed to get/create email alias", {
      orgId,
      error: error?.message,
    });
    return null;
  }

  const result = data[0];
  return {
    aliasAddress: result.alias_address,
    aliasKey: result.alias_key,
    isNew: result.is_new,
  };
}

/**
 * Get existing email alias for organization.
 */
export async function getEmailAlias(
  orgId: string
): Promise<{ aliasAddress: string; aliasKey: string } | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("email_aliases")
    .select("alias_address, alias_key")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    aliasAddress: data.alias_address,
    aliasKey: data.alias_key,
  };
}

/**
 * Deactivate email alias for organization.
 */
export async function deactivateEmailAlias(orgId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("email_aliases")
    .update({ is_active: false })
    .eq("organization_id", orgId)
    .eq("is_active", true);

  if (error) {
    logger.error("Failed to deactivate email alias", {
      orgId,
      error: error.message,
    });
    return false;
  }

  return true;
}
