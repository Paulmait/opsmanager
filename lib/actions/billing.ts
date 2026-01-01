"use server";

import { redirect } from "next/navigation";
import { requireActiveOrg } from "@/lib/guards";
import { stripe, PLANS, type PlanId, getOrgEntitlements, getCurrentUsage } from "@/lib/stripe";
import { clientEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Types
// =============================================================================

export interface BillingInfo {
  plan: PlanId;
  planName: string;
  priceMonthly: number;
  subscriptionStatus: string;
  periodEnd: string | null;
  usage: {
    runsToday: number;
    sendsToday: number;
    runsLimit: number;
    sendsLimit: number;
  };
  limits: {
    maxIntegrations: number;
    maxTeamMembers: number;
    maxContacts: number;
  };
  features: {
    autoSend: boolean;
    apiAccess: boolean;
    customBranding: boolean;
    prioritySupport: boolean;
    sso: boolean;
    auditExport: boolean;
  };
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get current billing information.
 */
export async function getBillingInfo(): Promise<{
  billing: BillingInfo | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    // Get org with billing info
    const { data: org } = await supabase
      .from("organizations")
      .select("plan, plan_limits, subscription_status, subscription_period_end")
      .eq("id", profile.organization_id)
      .single();

    if (!org) {
      return { billing: null, error: "Organization not found" };
    }

    const plan = (org.plan as PlanId) ?? "free";
    const planConfig = PLANS[plan];
    const limits = org.plan_limits as Record<string, unknown> ?? {};
    const features = (limits.features as Record<string, boolean>) ?? {};

    // Get current usage
    const usage = await getCurrentUsage(profile.organization_id);

    const billing: BillingInfo = {
      plan,
      planName: planConfig.name,
      priceMonthly: planConfig.price_monthly,
      subscriptionStatus: org.subscription_status ?? "none",
      periodEnd: org.subscription_period_end,
      usage: usage ?? {
        runsToday: 0,
        sendsToday: 0,
        runsLimit: planConfig.limits.runs_per_day,
        sendsLimit: planConfig.limits.sends_per_day,
      },
      limits: {
        maxIntegrations: (limits.max_integrations as number) ?? planConfig.limits.max_integrations,
        maxTeamMembers: (limits.max_team_members as number) ?? planConfig.limits.max_team_members,
        maxContacts: (limits.max_contacts as number) ?? planConfig.limits.max_contacts,
      },
      features: {
        autoSend: features.auto_send ?? planConfig.limits.features.auto_send,
        apiAccess: features.api_access ?? planConfig.limits.features.api_access,
        customBranding: features.custom_branding ?? planConfig.limits.features.custom_branding,
        prioritySupport: features.priority_support ?? planConfig.limits.features.priority_support,
        sso: features.sso ?? planConfig.limits.features.sso,
        auditExport: features.audit_export ?? planConfig.limits.features.audit_export,
      },
    };

    return { billing, error: null };
  } catch (error) {
    console.error("getBillingInfo error:", error);
    return { billing: null, error: "Failed to fetch billing info" };
  }
}

/**
 * Create Stripe checkout session for upgrading.
 *
 * SECURITY:
 * - Requires admin/owner role
 * - Validates plan exists and has price
 */
export async function createCheckoutSession(
  planId: PlanId
): Promise<{ url: string | null; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { url: null, error: "Insufficient permissions" };
    }

    // Get plan
    const plan = PLANS[planId];
    if (!plan || !plan.stripe_price_id) {
      return { url: null, error: "Invalid plan or plan not available" };
    }

    // Get org
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", profile.organization_id)
      .single();

    // Create or reuse Stripe customer
    let customerId = org?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        metadata: {
          org_id: profile.organization_id,
          user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", profile.organization_id);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price: plan.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings?billing=success`,
      cancel_url: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings?billing=canceled`,
      metadata: {
        org_id: profile.organization_id,
        user_id: user.id,
        plan_id: planId,
      },
      subscription_data: {
        metadata: {
          org_id: profile.organization_id,
        },
      },
    });

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "billing.checkout_started",
      resource_type: "subscription",
      metadata: {
        plan_id: planId,
        session_id: session.id,
      },
    });

    return { url: session.url, error: null };
  } catch (error) {
    console.error("createCheckoutSession error:", error);
    return { url: null, error: "Failed to create checkout session" };
  }
}

/**
 * Create Stripe billing portal session.
 *
 * SECURITY:
 * - Requires admin/owner role
 * - Must have existing Stripe customer
 */
export async function createBillingPortalSession(): Promise<{
  url: string | null;
  error: string | null;
}> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { url: null, error: "Insufficient permissions" };
    }

    // Get org
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", profile.organization_id)
      .single();

    if (!org?.stripe_customer_id) {
      return { url: null, error: "No billing account found" };
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${clientEnv.NEXT_PUBLIC_APP_URL}/settings`,
    });

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "billing.portal_accessed",
      resource_type: "subscription",
    });

    return { url: session.url, error: null };
  } catch (error) {
    console.error("createBillingPortalSession error:", error);
    return { url: null, error: "Failed to access billing portal" };
  }
}

/**
 * Cancel subscription.
 *
 * SECURITY:
 * - Requires owner role
 */
export async function cancelSubscription(): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role - only owners can cancel
    if (profile.role !== "owner") {
      return { success: false, error: "Only organization owners can cancel subscriptions" };
    }

    // Get org
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_subscription_id")
      .eq("id", profile.organization_id)
      .single();

    if (!org?.stripe_subscription_id) {
      return { success: false, error: "No active subscription found" };
    }

    // Cancel at period end
    await stripe.subscriptions.update(org.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "billing.subscription_canceled",
      resource_type: "subscription",
    });

    return { success: true, error: null };
  } catch (error) {
    console.error("cancelSubscription error:", error);
    return { success: false, error: "Failed to cancel subscription" };
  }
}

/**
 * Resume canceled subscription.
 */
export async function resumeSubscription(): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Get org
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_subscription_id")
      .eq("id", profile.organization_id)
      .single();

    if (!org?.stripe_subscription_id) {
      return { success: false, error: "No subscription found" };
    }

    // Resume subscription
    await stripe.subscriptions.update(org.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    // Log to audit
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      actor_id: user.id,
      action: "billing.subscription_resumed",
      resource_type: "subscription",
    });

    return { success: true, error: null };
  } catch (error) {
    console.error("resumeSubscription error:", error);
    return { success: false, error: "Failed to resume subscription" };
  }
}
