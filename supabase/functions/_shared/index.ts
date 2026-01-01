/**
 * Shared utilities for Edge Functions
 *
 * Central export for all shared functionality.
 */

// Dependencies
export { z, type ZodSchema } from "./deps.ts";

// Auth
export {
  createAdminClient,
  createUserClient,
  verifyAuth,
  verifyOrgMembership,
  verifyWebhookSignature,
  requireRole,
  AuthError,
  type AuthContext,
  type OrgAuthContext,
} from "./auth.ts";

// Validation
export {
  validateBody,
  validate,
  ValidationError,
  UUIDSchema,
  OrgIdSchema,
  PaginationSchema,
} from "./validation.ts";

// Rate Limiting & Entitlements
export {
  getOrgLimits,
  getUsageCounts,
  checkRunLimit,
  checkActionLimit,
  checkMaxActionsPerRun,
  checkAndIncrementUsage,
  checkFeature,
  checkCountLimit,
  RateLimitError,
  type PlanLimits,
  type UsageCounts,
  type RateLimitResult,
  type UsageIncrementResult,
} from "./rate-limit.ts";

// Idempotency
export {
  generateIdempotencyKey,
  checkIdempotency,
  storeIdempotencyResponse,
  cleanupExpiredKeys,
  getIdempotencyKey,
  type IdempotencyResult,
} from "./idempotency.ts";

// Audit Logging
export {
  logAudit,
  logFunctionStart,
  logFunctionSuccess,
  logFunctionError,
  logRateLimitExceeded,
  type AuditLogEntry,
} from "./audit.ts";

// Response Helpers
export {
  jsonResponse,
  successResponse,
  errorResponse,
  handleCors,
  rateLimitResponse,
  idempotentResponse,
} from "./response.ts";

// SSRF Protection
export {
  validateOutboundUrl,
  safeFetch,
  addAllowedDomain,
  isDomainAllowed,
  SSRFError,
} from "./ssrf.ts";
