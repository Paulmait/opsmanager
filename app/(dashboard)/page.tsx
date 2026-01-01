import { requireActiveOrg } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  // Guard already verified in layout, but we can get fresh context
  const { profile, organization } = await requireActiveOrg();

  const supabase = await createClient();

  // Get counts for dashboard stats (RLS-protected)
  const [tasksResult, contactsResult, approvalsResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .in("status", ["pending", "in_progress", "waiting_approval"]),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("status", "pending"),
  ]);

  const activeTasks = tasksResult.count ?? 0;
  const totalContacts = contactsResult.count ?? 0;
  const pendingApprovals = approvalsResult.count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back{profile.full_name ? `, ${profile.full_name}` : ""}!
          You&apos;re viewing <span className="font-medium">{organization.name}</span>.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="text-sm font-medium text-muted-foreground">
            Active Tasks
          </div>
          <div className="mt-2 text-3xl font-bold">{activeTasks}</div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="text-sm font-medium text-muted-foreground">
            Pending Approvals
          </div>
          <div className="mt-2 text-3xl font-bold">{pendingApprovals}</div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="text-sm font-medium text-muted-foreground">
            Contacts
          </div>
          <div className="mt-2 text-3xl font-bold">{totalContacts}</div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="text-sm font-medium text-muted-foreground">
            Your Role
          </div>
          <div className="mt-2 text-3xl font-bold capitalize">{profile.role}</div>
        </div>
      </div>

      {/* Getting Started */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">Getting Started</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Complete these steps to set up your workspace:
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-center gap-3 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-muted" />
            <span>Connect your first integration</span>
          </li>
          <li className="flex items-center gap-3 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-muted" />
            <span>Create your first task</span>
          </li>
          <li className="flex items-center gap-3 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-muted" />
            <span>Invite team members</span>
          </li>
        </ul>
      </div>

      {/* Role-based content */}
      {(profile.role === "admin" || profile.role === "owner") && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-6">
          <h2 className="text-lg font-semibold">Admin Panel</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            As an {profile.role}, you have access to additional settings and
            integrations.
          </p>
        </div>
      )}
    </div>
  );
}
