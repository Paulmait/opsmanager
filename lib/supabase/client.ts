import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for browser/client-side usage.
 *
 * SECURITY:
 * - Uses only the anon key (public, RLS-protected)
 * - Safe to use in client components
 * - All data access is filtered by RLS policies
 *
 * Usage:
 * ```tsx
 * "use client";
 * import { createClient } from "@/lib/supabase/client";
 *
 * const supabase = createClient();
 * const { data } = await supabase.from("table").select();
 * ```
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
