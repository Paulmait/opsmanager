import { createServerClient, type SupabaseClient as BaseSupabaseClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Export typed client for use in other modules
export type SupabaseClient = BaseSupabaseClient<Database>;

/**
 * Supabase client for server-side usage (Server Components, Route Handlers, Server Actions).
 *
 * SECURITY:
 * - Uses anon key with cookie-based auth
 * - Session is derived from HTTP-only cookies
 * - All data access respects RLS policies based on authenticated user
 *
 * Usage:
 * ```tsx
 * // In a Server Component
 * import { createClient } from "@/lib/supabase/server";
 *
 * export default async function Page() {
 *   const supabase = await createClient();
 *   const { data } = await supabase.from("table").select();
 * }
 * ```
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}
