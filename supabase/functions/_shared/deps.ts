/**
 * Shared dependencies for Edge Functions
 *
 * All external imports centralized here for consistency.
 * Deno uses URL imports.
 */

// Supabase client
export { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
export type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Zod for validation
export { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
export type { ZodSchema, ZodError } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Crypto for signatures and idempotency
export * as crypto from "https://deno.land/std@0.208.0/crypto/mod.ts";
export { encodeHex } from "https://deno.land/std@0.208.0/encoding/hex.ts";
