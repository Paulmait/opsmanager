import "server-only";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient, type SupabaseClient } from "@/lib/supabase/server";
import type { UserRole, Profile, Organization } from "@/lib/supabase/database.types";

// =============================================================================
// Types
// =============================================================================

export interface AuthContext {
  user: {
    id: string;
    email: string;
  };
}

export interface OrgContext extends AuthContext {
  profile: Profile;
  organization: Organization;
  supabase: SupabaseClient;
}

export interface GuardOptions {
  /** URL to redirect to on failure. Default: /login */
  redirectTo?: string;
  /** If true, returns null instead of redirecting */
  returnNull?: boolean;
}

// Role hierarchy for comparisons
const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

// =============================================================================
// Active Org Context (Cookie-based)
// =============================================================================

const ACTIVE_ORG_COOKIE = "ops_active_org";

/**
 * Get the active organization ID from cookie.
 * Returns null if not set.
 */
export async function getActiveOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(ACTIVE_ORG_COOKIE);
  return cookie?.value ?? null;
}

/**
 * Set the active organization ID in cookie.
 * Should only be called after verifying membership.
 */
export async function setActiveOrgId(orgId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

/**
 * Clear the active organization cookie.
 */
export async function clearActiveOrgId(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
}

// =============================================================================
// Core Guards (Cached for Request Deduplication)
// =============================================================================

/**
 * Get the current authenticated user.
 * Cached per request to avoid duplicate Supabase calls.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email!,
    emailConfirmed: user.email_confirmed_at !== null,
    metadata: user.user_metadata,
  };
});

/**
 * Get the current user's profile.
 * Cached per request.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
});

/**
 * Get profile with organization data.
 * Cached per request.
 */
export const getProfileWithOrg = cache(async (): Promise<{
  profile: Profile;
  organization: Organization;
} | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();

  // Get profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // Get organization
  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.organization_id)
    .single();

  if (!organization) return null;

  return { profile, organization };
});

// =============================================================================
// Authorization Guards
// =============================================================================

/**
 * Require an authenticated user.
 * Redirects to login if not authenticated.
 *
 * @example
 * ```tsx
 * export default async function ProtectedPage() {
 *   const { user } = await requireUser();
 *   return <div>Hello {user.email}</div>;
 * }
 * ```
 */
export async function requireUser(
  options: GuardOptions = {}
): Promise<AuthContext> {
  const { redirectTo = "/login", returnNull = false } = options;

  const user = await getCurrentUser();

  if (!user) {
    if (returnNull) {
      return null as unknown as AuthContext;
    }
    redirect(redirectTo);
  }

  return { user };
}

/**
 * Require the user to be a member of the specified organization.
 * NEVER trusts client-provided orgId - always verifies in database.
 *
 * @param orgId - Organization ID to verify membership for
 * @param options - Guard options
 *
 * @example
 * ```tsx
 * export default async function OrgPage({ params }: { params: { orgId: string } }) {
 *   const { profile, organization } = await requireOrgMember(params.orgId);
 *   return <div>Org: {organization.name}</div>;
 * }
 * ```
 */
export async function requireOrgMember(
  orgId: string,
  options: GuardOptions = {}
): Promise<OrgContext> {
  const { redirectTo = "/login", returnNull = false } = options;

  // First require authentication
  const user = await getCurrentUser();
  if (!user) {
    if (returnNull) return null as unknown as OrgContext;
    redirect(redirectTo);
  }

  const supabase = await createClient();

  // SECURITY: Always verify membership in database, never trust client
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .eq("organization_id", orgId)
    .single();

  if (profileError || !profile) {
    if (returnNull) return null as unknown as OrgContext;
    // User is not a member of this org
    redirect("/dashboard?error=unauthorized");
  }

  // Get organization details
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single();

  if (orgError || !organization) {
    if (returnNull) return null as unknown as OrgContext;
    redirect("/dashboard?error=org_not_found");
  }

  return {
    user,
    profile,
    organization,
    supabase,
  };
}

/**
 * Require the user to have at least the specified role in the organization.
 *
 * @param orgId - Organization ID
 * @param minRole - Minimum required role (viewer < member < admin < owner)
 * @param options - Guard options
 *
 * @example
 * ```tsx
 * export default async function AdminPage({ params }: { params: { orgId: string } }) {
 *   const ctx = await requireRole(params.orgId, "admin");
 *   return <div>Admin Panel for {ctx.organization.name}</div>;
 * }
 * ```
 */
export async function requireRole(
  orgId: string,
  minRole: UserRole,
  options: GuardOptions = {}
): Promise<OrgContext> {
  const { redirectTo = "/dashboard?error=forbidden", returnNull = false } =
    options;

  // First check org membership
  const ctx = await requireOrgMember(orgId, { ...options, returnNull: true });

  if (!ctx) {
    if (returnNull) return null as unknown as OrgContext;
    redirect(options.redirectTo ?? "/login");
  }

  // Check role hierarchy
  const userRoleLevel = ROLE_HIERARCHY[ctx.profile.role];
  const requiredRoleLevel = ROLE_HIERARCHY[minRole];

  if (userRoleLevel < requiredRoleLevel) {
    if (returnNull) return null as unknown as OrgContext;
    redirect(redirectTo);
  }

  return ctx;
}

/**
 * Get the current org context using the active org cookie.
 * Falls back to the user's default org if cookie not set.
 *
 * @example
 * ```tsx
 * export default async function DashboardPage() {
 *   const ctx = await requireActiveOrg();
 *   return <div>Current org: {ctx.organization.name}</div>;
 * }
 * ```
 */
export async function requireActiveOrg(
  options: GuardOptions = {}
): Promise<OrgContext> {
  const { redirectTo = "/login" } = options;

  // Require authentication first
  const user = await getCurrentUser();
  if (!user) {
    redirect(redirectTo);
  }

  // Try to get active org from cookie
  let activeOrgId = await getActiveOrgId();

  // If no active org set, get user's default org from profile
  if (!activeOrgId) {
    const profile = await getCurrentProfile();
    if (!profile) {
      redirect(redirectTo);
    }
    activeOrgId = profile.organization_id;
    // Set it as the active org
    await setActiveOrgId(activeOrgId);
  }

  // Verify membership (NEVER trust the cookie blindly)
  return requireOrgMember(activeOrgId, options);
}

// =============================================================================
// Role Check Utilities (Non-redirecting)
// =============================================================================

/**
 * Check if current user has at least the specified role.
 * Returns false if not authenticated or not a member.
 */
export async function hasRole(orgId: string, role: UserRole): Promise<boolean> {
  const ctx = await requireOrgMember(orgId, { returnNull: true });
  if (!ctx) return false;

  const userLevel = ROLE_HIERARCHY[ctx.profile.role];
  const requiredLevel = ROLE_HIERARCHY[role];

  return userLevel >= requiredLevel;
}

/**
 * Check if current user is an admin or owner.
 */
export async function isAdmin(orgId: string): Promise<boolean> {
  return hasRole(orgId, "admin");
}

/**
 * Check if current user is the owner.
 */
export async function isOwner(orgId: string): Promise<boolean> {
  return hasRole(orgId, "owner");
}

// =============================================================================
// Server Action Helpers
// =============================================================================

/**
 * Wrapper for server actions that require org membership.
 * Use this in server actions to ensure proper authorization.
 *
 * @example
 * ```ts
 * "use server";
 *
 * export async function createTask(formData: FormData) {
 *   return withOrgContext(async (ctx) => {
 *     const title = formData.get("title") as string;
 *     // ctx.profile and ctx.organization are available
 *     // Create task with ctx.organization.id
 *   });
 * }
 * ```
 */
export async function withOrgContext<T>(
  handler: (ctx: OrgContext) => Promise<T>
): Promise<T> {
  const ctx = await requireActiveOrg();
  return handler(ctx);
}

/**
 * Wrapper for server actions that require a specific role.
 *
 * @example
 * ```ts
 * "use server";
 *
 * export async function deleteUser(userId: string) {
 *   return withRoleContext("admin", async (ctx) => {
 *     // Only admins can delete users
 *   });
 * }
 * ```
 */
export async function withRoleContext<T>(
  minRole: UserRole,
  handler: (ctx: OrgContext) => Promise<T>
): Promise<T> {
  const ctx = await requireActiveOrg();

  const userLevel = ROLE_HIERARCHY[ctx.profile.role];
  const requiredLevel = ROLE_HIERARCHY[minRole];

  if (userLevel < requiredLevel) {
    throw new Error(`Forbidden: requires ${minRole} role`);
  }

  return handler(ctx);
}
