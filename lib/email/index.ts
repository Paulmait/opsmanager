/**
 * Email Ingestion Module
 *
 * Handles inbound email processing via webhook.
 *
 * SECURITY:
 * - All exports are server-only
 * - Webhook signature verification required
 * - Minimal PII storage
 */

export type {
  EmailProvider,
  ParsedEmail,
  InboundEmailPayload,
  InboundEmail,
  InboundEmailStatus,
  EmailAlias,
  EmailProcessingResult,
} from "./types";

export {
  processInboundEmail,
  getOrCreateEmailAlias,
  getEmailAlias,
  deactivateEmailAlias,
} from "./processor";

export {
  verifyWebhookSignature,
  generateTestSignature,
  generateMailgunSignature,
} from "./signature";

export { parseInboundEmail, extractAliasKey } from "./parser";
