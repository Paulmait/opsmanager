#!/usr/bin/env tsx
/**
 * Environment Variable Validation Script
 *
 * Run this script to validate your .env.local configuration:
 *   pnpm check-env
 *
 * Exits with code 1 if validation fails.
 */

import { z } from "zod";

const requiredEnvSchema = z.object({
  // Client-side (NEXT_PUBLIC_*)
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL")
    .refine(
      (url) => url.includes("supabase"),
      "NEXT_PUBLIC_SUPABASE_URL should be a Supabase URL"
    ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(100, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),

  // Server-side
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(100, "SUPABASE_SERVICE_ROLE_KEY looks too short"),
});

function main() {
  console.log("Checking environment variables...\n");

  const result = requiredEnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Environment validation failed:\n");

    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }

    console.error("\nPlease check your .env.local file.");
    console.error("You can copy .env.example as a starting point:\n");
    console.error("  cp .env.example .env.local\n");
    process.exit(1);
  }

  console.log("All required environment variables are set.");

  // Additional security checks
  const warnings: string[] = [];

  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_PUBLIC_APP_URL?.includes("localhost")) {
      warnings.push(
        "NEXT_PUBLIC_APP_URL contains 'localhost' but NODE_ENV is 'production'"
      );
    }
  }

  if (
    process.env.SUPABASE_SERVICE_ROLE_KEY ===
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    console.error("\nSECURITY ERROR:");
    console.error(
      "  SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are the same!"
    );
    console.error("  The service role key should be different from the anon key.");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("\nEnvironment check passed.");
}

main();
