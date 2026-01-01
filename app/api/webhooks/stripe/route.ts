import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  handleWebhookEvent,
  WebhookVerificationError,
} from "@/lib/stripe/webhook";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ module: "stripe-webhook-route" });

/**
 * Stripe Webhook Handler
 *
 * SECURITY:
 * - Verifies Stripe signature before processing
 * - Uses raw body for signature verification
 * - Rejects unsigned requests
 *
 * Note: This endpoint MUST be excluded from middleware auth
 * and use raw body parsing (not JSON).
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const body = await request.text();

    // Get Stripe signature header
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      logger.warn("Missing Stripe signature header");
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 400 }
      );
    }

    // Verify signature - throws if invalid
    let event;
    try {
      event = verifyWebhookSignature(body, signature);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        logger.warn("Webhook signature verification failed");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
      throw error;
    }

    // Process the event
    const result = await handleWebhookEvent(event);

    if (!result.success) {
      // Log error but return 200 to prevent Stripe retries for non-retryable errors
      logger.error("Webhook processing failed", {
        eventId: result.eventId,
        error: result.error,
      });
    }

    // Always return 200 to acknowledge receipt
    // Stripe will retry on non-2xx responses
    return NextResponse.json({
      received: true,
      eventId: result.eventId,
      eventType: result.eventType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Webhook handler error", { error: message });

    // Return 500 for unexpected errors - Stripe will retry
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Stripe webhooks should not be cached
export const dynamic = "force-dynamic";
