import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { clientEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase admin client with service role key.
 *
 * !! DANGER !! DANGER !! DANGER !!
 *
 * This client BYPASSES Row Level Security (RLS).
 * Only use for:
 * - System-level operations (migrations, background jobs)
 * - Admin operations that require elevated privileges
 * - Webhook handlers that need to modify data across orgs
 *
 * NEVER:
 * - Import this in client components (will fail at build time)
 * - Use for regular user operations
 * - Pass user input directly to queries without validation
 *
 * The `server-only` package ensures this file cannot be imported
 * in client bundles - the build will fail.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Type-safe wrapper for admin operations.
 * Use this to make it explicit when you're bypassing RLS.
 *
 * @example
 * ```ts
 * const result = await withAdminClient(async (supabase) => {
 *   return supabase.from("audit_logs").insert({...});
 * });
 * ```
 */
export async function withAdminClient<T>(
  operation: (client: ReturnType<typeof createAdminClient>) => Promise<T>
): Promise<T> {
  const client = createAdminClient();
  return operation(client);
}
