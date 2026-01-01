import { z } from "zod";

/**
 * Environment variable validation using Zod.
 * Fails fast at build/startup if required vars are missing.
 *
 * SECURITY: Never expose server-only vars to client bundles.
 * - NEXT_PUBLIC_* vars are safe for client
 * - All other vars are server-only
 */

// =============================================================================
// Client Environment Schema (safe to expose)
// =============================================================================
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url("NEXT_PUBLIC_APP_URL must be a valid URL")
    .default("http://localhost:3000"),
});

// =============================================================================
// Server Environment Schema (never expose to client)
// =============================================================================
const serverSchema = z.object({
  // Supabase service role key - bypasses RLS, use with extreme caution
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // Node environment
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Stripe - required for billing
  STRIPE_SECRET_KEY: z
    .string()
    .min(1, "STRIPE_SECRET_KEY is required")
    .startsWith("sk_", "STRIPE_SECRET_KEY must start with 'sk_'"),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1, "STRIPE_WEBHOOK_SECRET is required")
    .startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with 'whsec_'"),

  // Email ingestion - provider webhook secrets
  EMAIL_WEBHOOK_SECRET: z
    .string()
    .min(16, "EMAIL_WEBHOOK_SECRET must be at least 16 characters")
    .optional()
    .default(""),
  EMAIL_PROVIDER: z
    .enum(["sendgrid", "mailgun", "postmark", "test"])
    .optional()
    .default("sendgrid"),
  EMAIL_DOMAIN: z
    .string()
    .optional()
    .default("mail.opsmanager.app"),
});

// =============================================================================
// Validation & Export
// =============================================================================

/**
 * Client environment variables.
 * Safe to use anywhere (client or server).
 */
export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Server environment variables.
 * ONLY use in server-side code (API routes, server actions, middleware).
 * Importing this in client code will fail at build time.
 */
function getServerEnv() {
  // Only validate on server
  if (typeof window !== "undefined") {
    throw new Error(
      "Server environment variables cannot be accessed on the client. " +
        "This is a security violation."
    );
  }

  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    EMAIL_WEBHOOK_SECRET: process.env.EMAIL_WEBHOOK_SECRET,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_DOMAIN: process.env.EMAIL_DOMAIN,
  });
}

// Lazy initialization to avoid client-side errors
let _serverEnv: z.infer<typeof serverSchema> | null = null;

export const serverEnv = new Proxy({} as z.infer<typeof serverSchema>, {
  get(_target, prop: string) {
    if (_serverEnv === null) {
      _serverEnv = getServerEnv();
    }
    return _serverEnv[prop as keyof typeof _serverEnv];
  },
});

// =============================================================================
// Type exports for external use
// =============================================================================
export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;
