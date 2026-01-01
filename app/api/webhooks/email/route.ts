import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { processInboundEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { EmailProvider } from "@/lib/email/types";

const logger = createLogger({ module: "email-webhook-route" });

/**
 * Inbound Email Webhook Handler
 *
 * SECURITY:
 * - Verifies webhook signature from email provider
 * - Prevents email spoofing
 * - Rate limits processing
 * - Logs all attempts to audit trail
 *
 * Endpoint: POST /api/webhooks/email
 * Headers:
 *   - Provider-specific signature headers
 *   - X-Webhook-Secret (for simple auth)
 *
 * Note: This endpoint MUST be excluded from middleware auth.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get email webhook configuration
    const provider = serverEnv.EMAIL_PROVIDER as EmailProvider;
    const webhookSecret = serverEnv.EMAIL_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error("EMAIL_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    // Get content type to determine parsing method
    const contentType = request.headers.get("content-type") ?? "";

    let payload: unknown;

    if (contentType.includes("application/json")) {
      // JSON payload (Postmark, some SendGrid events)
      payload = await request.json();
    } else if (contentType.includes("multipart/form-data")) {
      // Form data (SendGrid Inbound Parse, Mailgun)
      const formData = await request.formData();
      payload = Object.fromEntries(formData.entries());
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // URL-encoded form (some Mailgun webhooks)
      const text = await request.text();
      const params = new URLSearchParams(text);
      payload = Object.fromEntries(params.entries());
    } else {
      // Try to parse as JSON by default
      try {
        payload = await request.json();
      } catch {
        logger.warn("Unknown content type for email webhook", { contentType });
        return NextResponse.json(
          { error: "Unsupported content type" },
          { status: 415 }
        );
      }
    }

    // Collect headers for signature verification
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Process the inbound email
    const result = await processInboundEmail(
      {
        provider,
        webhookSecret,
      },
      payload,
      headers
    );

    const duration = Date.now() - startTime;

    if (!result.success) {
      logger.warn("Email webhook processing failed", {
        error: result.error,
        duration,
      });

      // Return 200 to prevent retries for non-retryable errors
      // Provider will retry on non-2xx responses
      return NextResponse.json({
        received: true,
        processed: false,
        error: result.error,
      });
    }

    if (result.skipped) {
      logger.info("Email webhook skipped", {
        reason: result.skipReason,
        emailId: result.emailId,
        duration,
      });

      return NextResponse.json({
        received: true,
        processed: true,
        skipped: true,
        reason: result.skipReason,
      });
    }

    logger.info("Email webhook processed successfully", {
      emailId: result.emailId,
      agentRunId: result.agentRunId,
      duration,
    });

    return NextResponse.json({
      received: true,
      processed: true,
      emailId: result.emailId,
      agentRunId: result.agentRunId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const duration = Date.now() - startTime;

    logger.error("Email webhook handler error", {
      error: message,
      duration,
    });

    // Return 500 for unexpected errors - provider will retry
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Email webhooks should not be cached
export const dynamic = "force-dynamic";

// Allow larger payloads for emails with attachments metadata
export const maxDuration = 30; // 30 seconds timeout
