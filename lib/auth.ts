import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Get the current authenticated user.
 * Returns null if not authenticated.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Require authentication. Redirects to login if not authenticated.
 * Use in Server Components or Route Handlers.
 *
 * @example
 * ```tsx
 * export default async function ProtectedPage() {
 *   const user = await requireAuth();
 *   return <div>Hello {user.email}</div>;
 * }
 * ```
 */
export async function requireAuth() {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Get the current user's profile with organization context.
 * Returns null if not authenticated or profile doesn't exist.
 */
export async function getUserProfile(): Promise<Profile | null> {
  const user = await getUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

/**
 * Require authentication with profile. Redirects if not found.
 *
 * @example
 * ```tsx
 * export default async function DashboardPage() {
 *   const profile = await requireProfile();
 *   return <div>Org: {profile.organization_id}</div>;
 * }
 * ```
 */
export async function requireProfile() {
  const profile = await getUserProfile();

  if (!profile) {
    redirect("/login");
  }

  return profile;
}

/**
 * Check if the current user has a specific role.
 *
 * @example
 * ```tsx
 * if (await hasRole("admin")) {
 *   // Show admin UI
 * }
 * ```
 */
export async function hasRole(
  role: "owner" | "admin" | "member"
): Promise<boolean> {
  const profile = await getUserProfile();

  if (!profile) {
    return false;
  }

  const roleHierarchy = { owner: 3, admin: 2, member: 1 };
  return roleHierarchy[profile.role] >= roleHierarchy[role];
}

/**
 * Sign out the current user and redirect to login.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
