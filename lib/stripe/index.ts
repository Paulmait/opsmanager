/**
 * Stripe Module
 *
 * Exports all Stripe-related functionality.
 *
 * SECURITY:
 * - All exports are server-only
 * - Never import this in client components
 */

export {
  stripe,
  PLANS,
  getPlan,
  getPlanByPriceId,
  getPlanLimits,
  type PlanId,
  type PlanLimits,
  type PlanConfig,
} from "./config";

export {
  verifyWebhookSignature,
  handleWebhookEvent,
  WebhookVerificationError,
  type WebhookResult,
} from "./webhook";

export {
  getOrgEntitlements,
  checkAndIncrementUsage,
  getCurrentUsage,
  checkFeature,
  checkLimit,
  canPerformAction,
  type OrgEntitlements,
  type UsageCheckResult,
  type FeatureCheckResult,
} from "./entitlements";
