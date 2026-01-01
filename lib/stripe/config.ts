import "server-only";

import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

// =============================================================================
// Stripe Client
// =============================================================================

/**
 * Stripe client for server-side operations.
 * SECURITY: Only import this in server components/actions.
 */
export const stripe = new Stripe(serverEnv.STRIPE_SECRET_KEY, {
  apiVersion: "2025-05-28.basil",
  typescript: true,
});

// =============================================================================
// Plan Definitions
// =============================================================================

export type PlanId = "free" | "starter" | "pro" | "agency";

export interface PlanLimits {
  runs_per_day: number;
  sends_per_day: number;
  max_actions_per_run: number;
  max_integrations: number;
  max_team_members: number;
  max_contacts: number;
  features: {
    auto_send: boolean;
    api_access: boolean;
    custom_branding: boolean;
    priority_support: boolean;
    sso: boolean;
    audit_export: boolean;
  };
}

export interface PlanConfig {
  id: PlanId;
  name: string;
  description: string;
  stripe_price_id: string | null;
  price_monthly: number;
  limits: PlanLimits;
}

/**
 * Plan configurations.
 * IMPORTANT: stripe_price_id should be set from environment or Stripe dashboard.
 */
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    description: "For trying out the platform",
    stripe_price_id: null, // No Stripe price for free plan
    price_monthly: 0,
    limits: {
      runs_per_day: 10,
      sends_per_day: 5,
      max_actions_per_run: 3,
      max_integrations: 1,
      max_team_members: 1,
      max_contacts: 100,
      features: {
        auto_send: false,
        api_access: false,
        custom_branding: false,
        priority_support: false,
        sso: false,
        audit_export: false,
      },
    },
  },
  starter: {
    id: "starter",
    name: "Starter",
    description: "For small teams getting started",
    stripe_price_id: process.env.STRIPE_STARTER_PRICE_ID ?? null,
    price_monthly: 29,
    limits: {
      runs_per_day: 100,
      sends_per_day: 50,
      max_actions_per_run: 10,
      max_integrations: 3,
      max_team_members: 5,
      max_contacts: 1000,
      features: {
        auto_send: true,
        api_access: false,
        custom_branding: false,
        priority_support: false,
        sso: false,
        audit_export: true,
      },
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "For growing businesses",
    stripe_price_id: process.env.STRIPE_PRO_PRICE_ID ?? null,
    price_monthly: 99,
    limits: {
      runs_per_day: 1000,
      sends_per_day: 500,
      max_actions_per_run: 20,
      max_integrations: 10,
      max_team_members: 20,
      max_contacts: 10000,
      features: {
        auto_send: true,
        api_access: true,
        custom_branding: true,
        priority_support: true,
        sso: false,
        audit_export: true,
      },
    },
  },
  agency: {
    id: "agency",
    name: "Agency",
    description: "For agencies and enterprises",
    stripe_price_id: process.env.STRIPE_AGENCY_PRICE_ID ?? null,
    price_monthly: 299,
    limits: {
      runs_per_day: 10000,
      sends_per_day: 5000,
      max_actions_per_run: 50,
      max_integrations: 50,
      max_team_members: 100,
      max_contacts: 100000,
      features: {
        auto_send: true,
        api_access: true,
        custom_branding: true,
        priority_support: true,
        sso: true,
        audit_export: true,
      },
    },
  },
};

/**
 * Get plan config by ID.
 */
export function getPlan(planId: PlanId): PlanConfig {
  return PLANS[planId] ?? PLANS.free;
}

/**
 * Get plan by Stripe price ID.
 */
export function getPlanByPriceId(priceId: string): PlanConfig | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.stripe_price_id === priceId) {
      return plan;
    }
  }
  return null;
}

/**
 * Get default limits for a plan.
 */
export function getPlanLimits(planId: PlanId): PlanLimits {
  return getPlan(planId).limits;
}
