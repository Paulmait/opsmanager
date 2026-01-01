"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentUser,
  setActiveOrgId,
  clearActiveOrgId,
  requireActiveOrg,
  withRoleContext,
} from "@/lib/guards";
import type { Organization } from "@/lib/supabase/database.types";

// =============================================================================
// Schemas
// =============================================================================

const switchOrgSchema = z.object({
  orgId: z.string().uuid("Invalid organization ID"),
});

const updateOrgSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
});

// =============================================================================
// Actions
// =============================================================================

/**
 * Switch to a different organization.
 * Verifies membership before switching.
 */
export async function switchOrganization(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const rawData = {
    orgId: formData.get("orgId"),
  };

  const parsed = switchOrgSchema.safeParse(rawData);
  if (!parsed.success) {
    return { success: false, error: "Invalid organization ID" };
  }

  const { orgId } = parsed.data;
  const supabase = await createClient();

  // SECURITY: Verify membership before switching
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .eq("organization_id", orgId)
    .single();

  if (error || !profile) {
    return { success: false, error: "You are not a member of this organization" };
  }

  // Set the active org cookie
  await setActiveOrgId(orgId);

  // Revalidate dashboard to reflect new org
  revalidatePath("/dashboard");

  return { success: true };
}

/**
 * Get list of organizations the current user belongs to.
 */
export async function getUserOrganizations(): Promise<Organization[]> {
  const user = await getCurrentUser();
  if (!user) {
    return [];
  }

  const supabase = await createClient();

  // Get all orgs where user has a profile
  // Note: In current schema, user has one profile per org
  // For multi-org, you'd query org_members instead
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return [];
  }

  const { data: orgs } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.organization_id);

  return orgs ?? [];
}

/**
 * Update organization details.
 * Requires admin role.
 */
export async function updateOrganization(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  return withRoleContext("admin", async (ctx) => {
    const rawData = {
      name: formData.get("name"),
    };

    const parsed = updateOrgSchema.safeParse(rawData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.errors[0]?.message ?? "Invalid data",
      };
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from("organizations")
      .update({ name: parsed.data.name })
      .eq("id", ctx.organization.id);

    if (error) {
      return { success: false, error: "Failed to update organization" };
    }

    revalidatePath("/dashboard");
    return { success: true };
  });
}

/**
 * Sign out and clear org context.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearActiveOrgId();
  redirect("/login");
}

/**
 * Get the current active org context for client components.
 */
export async function getActiveOrgContext(): Promise<{
  profile: { id: string; role: string; full_name: string | null };
  organization: { id: string; name: string };
} | null> {
  try {
    const ctx = await requireActiveOrg({ returnNull: true });
    if (!ctx) return null;

    return {
      profile: {
        id: ctx.profile.id,
        role: ctx.profile.role,
        full_name: ctx.profile.full_name,
      },
      organization: {
        id: ctx.organization.id,
        name: ctx.organization.name,
      },
    };
  } catch {
    return null;
  }
}
