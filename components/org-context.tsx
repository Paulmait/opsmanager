"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UserRole } from "@/lib/supabase/database.types";

// =============================================================================
// Types
// =============================================================================

interface OrgContextValue {
  profile: {
    id: string;
    role: UserRole;
    fullName: string | null;
  };
  organization: {
    id: string;
    name: string;
  };
}

// =============================================================================
// Context
// =============================================================================

const OrgContext = createContext<OrgContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface OrgProviderProps {
  children: ReactNode;
  value: OrgContextValue;
}

export function OrgProvider({ children, value }: OrgProviderProps) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get the current org context.
 * Throws if used outside of OrgProvider.
 */
export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return context;
}

/**
 * Get the current org context, returns null if not available.
 */
export function useOrgOptional(): OrgContextValue | null {
  return useContext(OrgContext);
}

/**
 * Check if current user has at least the specified role.
 */
export function useHasRole(minRole: UserRole): boolean {
  const ctx = useOrgOptional();
  if (!ctx) return false;

  const hierarchy: Record<UserRole, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1,
  };

  return hierarchy[ctx.profile.role] >= hierarchy[minRole];
}

/**
 * Check if current user is admin or owner.
 */
export function useIsAdmin(): boolean {
  return useHasRole("admin");
}

/**
 * Check if current user is owner.
 */
export function useIsOwner(): boolean {
  return useHasRole("owner");
}
