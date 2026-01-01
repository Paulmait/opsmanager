import "server-only";

import type Stripe from "stripe";
import { stripe, getPlanByPriceId, getPlanLimits, type PlanId } from "./config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import { serverEnv } from "@/lib/env";

const logger = createLogger({ module: "stripe-webhook" });

// =============================================================================
// Types
// =============================================================================

export interface WebhookResult {
  success: boolean;
  eventId: string;
  eventType: string;
  error?: string;
}

// =============================================================================
// Webhook Signature Verification
// =============================================================================

/**
 * Verify Stripe webhook signature.
 *
 * SECURITY:
 * - MUST verify signature before processing any webhook
 * - Uses raw body for signature verification
 * - Rejects replayed events
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      serverEnv.STRIPE_WEBHOOK_SECRET
    );
    return event;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Webhook signature verification failed", { error: message });
    throw new WebhookVerificationError(
      `Webhook signature verification failed: ${message}`
    );
  }
}

// =============================================================================
// Webhook Handler
// =============================================================================

/**
 * Handle Stripe webhook event.
 *
 * SECURITY:
 * - Signature already verified before calling
 * - Idempotent - checks for duplicate events
 * - Updates org plan from server, never trusts client
 */
export async function handleWebhookEvent(
  event: Stripe.Event
): Promise<WebhookResult> {
  const supabase = createAdminClient();

  // Check for duplicate event (idempotency)
  const { data: existingEvent } = await supabase
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", event.id)
    .single();

  if (existingEvent) {
    logger.info("Duplicate webhook event ignored", { eventId: event.id });
    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
    };
  }

  logger.info("Processing webhook event", {
    eventId: event.id,
    eventType: event.type,
  });

  try {
    let orgId: string | null = null;

    // Handle specific event types
    switch (event.type) {
      case "checkout.session.completed":
        orgId = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        orgId = await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        orgId = await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        orgId = await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        orgId = await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.debug("Unhandled event type", { eventType: event.type });
    }

    // Record event for audit/idempotency
    await supabase.from("billing_events").insert({
      organization_id: orgId,
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data.object as Record<string, unknown>,
    });

    // Log to audit if we have an org
    if (orgId) {
      await supabase.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: "stripe",
        action: `billing.${event.type}`,
        resource_type: "subscription",
        metadata: {
          stripe_event_id: event.id,
          event_type: event.type,
        },
      });
    }

    return {
      success: true,
      eventId: event.id,
      eventType: event.type,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error: message,
    });

    return {
      success: false,
      eventId: event.id,
      eventType: event.type,
      error: message,
    };
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handle checkout.session.completed - new subscription created
 */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const supabase = createAdminClient();

  // Get org ID from metadata
  const orgId = session.metadata?.org_id;
  if (!orgId) {
    logger.warn("Checkout session missing org_id metadata", { sessionId: session.id });
    return null;
  }

  // Get customer ID
  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (!customerId) {
    logger.error("Checkout session missing customer", { sessionId: session.id });
    return orgId;
  }

  // Update organization with Stripe customer ID
  await supabase
    .from("organizations")
    .update({
      stripe_customer_id: customerId,
      billing_email: session.customer_email ?? session.customer_details?.email,
    })
    .eq("id", orgId);

  // If subscription was created, it will be handled by subscription.created event
  logger.info("Checkout completed", { orgId, customerId });

  return orgId;
}

/**
 * Handle subscription created or updated
 */
async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const supabase = createAdminClient();

  // Find org by customer ID
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!org) {
    logger.warn("No org found for customer", { customerId });
    return null;
  }

  // Get price ID from subscription items
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    logger.error("Subscription missing price", { subscriptionId: subscription.id });
    return org.id;
  }

  // Determine plan from price
  const plan = getPlanByPriceId(priceId);
  const planId: PlanId = plan?.id ?? "free";
  const limits = getPlanLimits(planId);

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    trialing: "trialing",
    incomplete: "incomplete",
    incomplete_expired: "canceled",
    unpaid: "past_due",
    paused: "canceled",
  };

  const status = statusMap[subscription.status] ?? "none";

  // Update organization
  await supabase
    .from("organizations")
    .update({
      plan: planId,
      plan_limits: limits,
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq("id", org.id);

  logger.info("Subscription updated", {
    orgId: org.id,
    plan: planId,
    status,
    subscriptionId: subscription.id,
  });

  return org.id;
}

/**
 * Handle subscription deleted/canceled
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const supabase = createAdminClient();

  // Find org by subscription ID
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single();

  if (!org) {
    logger.warn("No org found for subscription", { subscriptionId: subscription.id });
    return null;
  }

  // Downgrade to free plan
  const freeLimits = getPlanLimits("free");

  await supabase
    .from("organizations")
    .update({
      plan: "free",
      plan_limits: freeLimits,
      subscription_status: "canceled",
      stripe_subscription_id: null,
    })
    .eq("id", org.id);

  logger.info("Subscription canceled, downgraded to free", { orgId: org.id });

  return org.id;
}

/**
 * Handle successful invoice payment
 */
async function handlePaymentSucceeded(
  invoice: Stripe.Invoice
): Promise<string | null> {
  const supabase = createAdminClient();

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return null;

  // Find org
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!org) return null;

  // Ensure subscription status is active
  if (invoice.subscription) {
    await supabase
      .from("organizations")
      .update({
        subscription_status: "active",
      })
      .eq("id", org.id);
  }

  logger.info("Payment succeeded", { orgId: org.id, invoiceId: invoice.id });

  return org.id;
}

/**
 * Handle failed invoice payment
 */
async function handlePaymentFailed(
  invoice: Stripe.Invoice
): Promise<string | null> {
  const supabase = createAdminClient();

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return null;

  // Find org
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!org) return null;

  // Update status to past_due
  await supabase
    .from("organizations")
    .update({
      subscription_status: "past_due",
    })
    .eq("id", org.id);

  logger.warn("Payment failed", { orgId: org.id, invoiceId: invoice.id });

  return org.id;
}

// =============================================================================
// Error Classes
// =============================================================================

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
