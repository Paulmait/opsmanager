/**
 * Idempotency utilities for Edge Functions
 *
 * SECURITY:
 * - Prevents duplicate execution of the same request
 * - Uses database for distributed idempotency checks
 * - Automatically cleans up old keys
 */

import { createAdminClient } from "./auth.ts";
import { encodeHex, crypto } from "./deps.ts";

// =============================================================================
// Types
// =============================================================================

export interface IdempotencyResult {
  isNew: boolean;
  existingResponse?: unknown;
  key: string;
}

// =============================================================================
// Idempotency Functions
// =============================================================================

/**
 * Generate idempotency key from request data.
 * Uses SHA-256 hash of the request content.
 */
export async function generateIdempotencyKey(
  functionName: string,
  orgId: string,
  payload: unknown
): Promise<string> {
  const content = JSON.stringify({
    function: functionName,
    org: orgId,
    payload,
  });

  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content)
  );

  return encodeHex(new Uint8Array(hash));
}

/**
 * Check and acquire idempotency lock.
 *
 * Returns existing response if this key was already processed,
 * otherwise acquires lock and allows processing.
 *
 * Uses a simple database table for distributed coordination.
 */
export async function checkIdempotency(
  key: string,
  ttlSeconds: number = 86400 // 24 hours
): Promise<IdempotencyResult> {
  const supabase = createAdminClient();

  // Try to find existing key
  const { data: existing } = await supabase
    .from("idempotency_keys")
    .select("response, created_at")
    .eq("key", key)
    .single();

  if (existing) {
    // Check if it's expired
    const createdAt = new Date(existing.created_at);
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

    if (new Date() < expiresAt) {
      return {
        isNew: false,
        existingResponse: existing.response,
        key,
      };
    }

    // Expired, delete it
    await supabase.from("idempotency_keys").delete().eq("key", key);
  }

  // Try to insert new key (with unique constraint)
  const { error } = await supabase.from("idempotency_keys").insert({
    key,
    response: null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Unique constraint violation means another request got there first
    // Retry the lookup
    const { data: retry } = await supabase
      .from("idempotency_keys")
      .select("response")
      .eq("key", key)
      .single();

    if (retry?.response) {
      return {
        isNew: false,
        existingResponse: retry.response,
        key,
      };
    }
  }

  return {
    isNew: true,
    key,
  };
}

/**
 * Store response for idempotency key after successful processing.
 */
export async function storeIdempotencyResponse(
  key: string,
  response: unknown
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("idempotency_keys")
    .update({ response })
    .eq("key", key);
}

/**
 * Clean up expired idempotency keys.
 * Should be called periodically (e.g., via cron).
 */
export async function cleanupExpiredKeys(
  ttlSeconds: number = 86400
): Promise<number> {
  const supabase = createAdminClient();

  const expirationTime = new Date(Date.now() - ttlSeconds * 1000);

  const { count } = await supabase
    .from("idempotency_keys")
    .delete()
    .lt("created_at", expirationTime.toISOString());

  return count ?? 0;
}

/**
 * Get or create idempotency key from request header.
 * Falls back to generating from payload if not provided.
 */
export async function getIdempotencyKey(
  req: Request,
  functionName: string,
  orgId: string,
  payload: unknown
): Promise<string> {
  // Check for client-provided idempotency key
  const clientKey = req.headers.get("idempotency-key");

  if (clientKey) {
    // Prefix with org to prevent cross-org collisions
    return `${orgId}:${clientKey}`;
  }

  // Generate from payload
  return generateIdempotencyKey(functionName, orgId, payload);
}
