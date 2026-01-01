import "server-only";

import crypto from "crypto";
import { createLogger } from "@/lib/logger";
import type { EmailProvider, WebhookVerificationResult } from "./types";

const logger = createLogger({ module: "email-signature" });

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify webhook signature from email provider.
 *
 * SECURITY:
 * - Each provider has different signing mechanisms
 * - Prevents spoofed webhook requests
 * - Rejects replayed requests via timestamp validation
 */
export function verifyWebhookSignature(
  provider: EmailProvider,
  secret: string,
  payload: string | Buffer,
  headers: Record<string, string | undefined>
): WebhookVerificationResult {
  try {
    switch (provider) {
      case "sendgrid":
        return verifySendGridSignature(secret, payload, headers);
      case "mailgun":
        return verifyMailgunSignature(secret, payload, headers);
      case "postmark":
        return verifyPostmarkSignature(secret, payload, headers);
      case "test":
        return verifyTestSignature(secret, payload, headers);
      default:
        return { valid: false, error: `Unknown provider: ${provider}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Signature verification failed", { provider, error: message });
    return { valid: false, error: message };
  }
}

// =============================================================================
// SendGrid Signature Verification
// =============================================================================

/**
 * Verify SendGrid Inbound Parse webhook signature.
 *
 * SendGrid uses ECDSA signatures with the Event Webhook Signature Verification.
 * For Inbound Parse, we verify using a shared secret in basic auth or custom header.
 *
 * @see https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
function verifySendGridSignature(
  secret: string,
  payload: string | Buffer,
  headers: Record<string, string | undefined>
): WebhookVerificationResult {
  // SendGrid Inbound Parse can use basic auth or custom verification
  // For MVP, we use a custom X-Webhook-Secret header approach
  const providedSecret = headers["x-webhook-secret"] ?? headers["authorization"];

  if (!providedSecret) {
    return { valid: false, error: "Missing webhook secret header" };
  }

  // Handle Bearer token format
  const token = providedSecret.replace(/^Bearer\s+/i, "");

  if (!timingSafeEqual(token, secret)) {
    return { valid: false, error: "Invalid webhook secret" };
  }

  return { valid: true };
}

// =============================================================================
// Mailgun Signature Verification
// =============================================================================

/**
 * Verify Mailgun webhook signature.
 *
 * Mailgun uses HMAC-SHA256 with timestamp.
 *
 * @see https://documentation.mailgun.com/en/latest/user_manual.html#securing-webhooks
 */
function verifyMailgunSignature(
  secret: string,
  payload: string | Buffer,
  headers: Record<string, string | undefined>
): WebhookVerificationResult {
  const timestamp = headers["x-mailgun-timestamp"];
  const token = headers["x-mailgun-token"];
  const signature = headers["x-mailgun-signature"];

  if (!timestamp || !token || !signature) {
    return { valid: false, error: "Missing Mailgun signature headers" };
  }

  // Check timestamp is recent (within 5 minutes)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > 300) {
    return { valid: false, error: "Timestamp too old (possible replay attack)" };
  }

  // Compute expected signature: HMAC-SHA256(timestamp + token)
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(timestamp + token)
    .digest("hex");

  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, error: "Invalid Mailgun signature" };
  }

  return { valid: true };
}

// =============================================================================
// Postmark Signature Verification
// =============================================================================

/**
 * Verify Postmark webhook signature.
 *
 * Postmark uses basic auth credentials in the webhook URL.
 * For additional security, we can check the X-PM-Webhook-Token header.
 *
 * @see https://postmarkapp.com/developer/webhooks/inbound-webhook
 */
function verifyPostmarkSignature(
  secret: string,
  _payload: string | Buffer,
  headers: Record<string, string | undefined>
): WebhookVerificationResult {
  // Postmark uses a token in the webhook URL or X-PM-Webhook-Token header
  const providedToken = headers["x-pm-webhook-token"];

  if (!providedToken) {
    // Fall back to checking authorization header (basic auth)
    const authHeader = headers["authorization"];
    if (!authHeader) {
      return { valid: false, error: "Missing Postmark webhook token" };
    }

    // Parse basic auth
    const base64Credentials = authHeader.replace(/^Basic\s+/i, "");
    const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
    const [, password] = credentials.split(":");

    if (!password || !timingSafeEqual(password, secret)) {
      return { valid: false, error: "Invalid Postmark credentials" };
    }

    return { valid: true };
  }

  if (!timingSafeEqual(providedToken, secret)) {
    return { valid: false, error: "Invalid Postmark webhook token" };
  }

  return { valid: true };
}

// =============================================================================
// Test Provider (Development)
// =============================================================================

/**
 * Verify test webhook signature (development only).
 */
function verifyTestSignature(
  secret: string,
  _payload: string | Buffer,
  headers: Record<string, string | undefined>
): WebhookVerificationResult {
  const providedSecret = headers["x-test-secret"];

  if (!providedSecret) {
    return { valid: false, error: "Missing test secret header" };
  }

  if (!timingSafeEqual(providedSecret, secret)) {
    return { valid: false, error: "Invalid test secret" };
  }

  return { valid: true };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still need to do comparison to prevent timing attack on length
    crypto.timingSafeEqual(
      Buffer.from(a.padEnd(Math.max(a.length, b.length))),
      Buffer.from(b.padEnd(Math.max(a.length, b.length)))
    );
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// =============================================================================
// Signature Generation (for testing)
// =============================================================================

/**
 * Generate a test signature for development.
 */
export function generateTestSignature(secret: string): Record<string, string> {
  return {
    "x-test-secret": secret,
  };
}

/**
 * Generate a Mailgun-style signature for testing.
 */
export function generateMailgunSignature(
  secret: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const token = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(timestamp + token)
    .digest("hex");

  return {
    "x-mailgun-timestamp": timestamp,
    "x-mailgun-token": token,
    "x-mailgun-signature": signature,
  };
}
