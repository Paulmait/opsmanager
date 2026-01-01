import Link from "next/link";
import { requireActiveOrg } from "@/lib/guards";
import { OrgProvider } from "@/components/org-context";
import { UserMenu } from "@/components/user-menu";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Dashboard Layout
 *
 * Protected layout that wraps all dashboard pages.
 * Uses requireActiveOrg guard to:
 * 1. Verify authentication
 * 2. Verify org membership
 * 3. Provide org context to child components
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard: Requires authenticated user with valid org membership
  const { profile, organization } = await requireActiveOrg();

  // Prepare context for client components
  const orgContext = {
    profile: {
      id: profile.id,
      role: profile.role as UserRole,
      fullName: profile.full_name,
    },
    organization: {
      id: organization.id,
      name: organization.name,
    },
  };

  return (
    <OrgProvider value={orgContext}>
      <div className="min-h-screen bg-background">
        {/* Navigation Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="font-bold">
                Ops Manager
              </Link>
              <nav className="hidden items-center gap-4 text-sm md:flex">
                <Link
                  href="/dashboard"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/tasks"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Tasks
                </Link>
                <Link
                  href="/dashboard/contacts"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Contacts
                </Link>
                {/* Admin-only links */}
                {(profile.role === "admin" || profile.role === "owner") && (
                  <>
                    <Link
                      href="/dashboard/integrations"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Integrations
                    </Link>
                    <Link
                      href="/dashboard/settings"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Settings
                    </Link>
                  </>
                )}
              </nav>
            </div>

            <UserMenu />
          </div>
        </header>

        {/* Main Content */}
        <main className="container py-6">{children}</main>
      </div>
    </OrgProvider>
  );
}
