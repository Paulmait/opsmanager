import { requireActiveOrg } from "@/lib/guards";
import { getOrgSettings, getUsageStats } from "@/lib/actions/settings";
import { getBillingInfo } from "@/lib/actions/billing";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoModeSettings } from "./auto-mode-settings";
import { ApprovalSettings } from "./approval-settings";
import { ContentSettings } from "./content-settings";
import { UsageStats } from "./usage-stats";
import { BillingSettings } from "./billing-settings";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const { profile, organization } = await requireActiveOrg();
  const params = await searchParams;
  const [{ settings }, usage, { billing }] = await Promise.all([
    getOrgSettings(),
    getUsageStats(),
    getBillingInfo(),
  ]);

  const isAdmin = ["owner", "admin"].includes(profile.role);

  // Determine default tab - switch to billing if coming from Stripe
  const defaultTab = params.billing ? "billing" : "organization";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure agent behavior and organization preferences"
      />

      {/* Usage Stats */}
      <UsageStats
        runsToday={usage.runs_today}
        sendsToday={usage.sends_today}
        dailyRunLimit={settings?.daily_run_limit ?? 100}
        dailySendLimit={settings?.daily_send_limit ?? 50}
      />

      {/* Billing notification banner */}
      {params.billing === "success" && (
        <div className="rounded-md bg-green-500/10 border border-green-500/20 p-4 text-sm text-green-600">
          Payment successful! Your plan has been updated.
        </div>
      )}
      {params.billing === "canceled" && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-4 text-sm text-yellow-600">
          Payment was canceled. You can try again anytime.
        </div>
      )}

      {/* Settings Tabs */}
      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="auto-mode">Auto Mode</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <div className="space-y-6">
            {/* Organization Section */}
            <Card>
              <CardHeader>
                <CardTitle>Organization</CardTitle>
                <CardDescription>Your organization details</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Organization Name
                    </dt>
                    <dd className="mt-1 text-sm">{organization.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Organization ID
                    </dt>
                    <dd className="mt-1 font-mono text-sm">{organization.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Created
                    </dt>
                    <dd className="mt-1 text-sm">
                      {new Date(organization.created_at).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Profile Section */}
            <Card>
              <CardHeader>
                <CardTitle>Your Profile</CardTitle>
                <CardDescription>Your account information</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Email
                    </dt>
                    <dd className="mt-1 text-sm">{profile.email}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Full Name
                    </dt>
                    <dd className="mt-1 text-sm">
                      {profile.full_name ?? "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">
                      Role
                    </dt>
                    <dd className="mt-1 text-sm capitalize">{profile.role}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="billing">
          {billing ? (
            <BillingSettings billing={billing} isAdmin={isAdmin} />
          ) : (
            <Card>
              <CardContent className="py-8">
                <p className="text-center text-muted-foreground">
                  Unable to load billing information. Please try again later.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="auto-mode">
          <Card>
            <CardHeader>
              <CardTitle>Auto Mode Settings</CardTitle>
              <CardDescription>
                Configure what the agent can do automatically without approval.
                Auto-send requires explicit domain or recipient allowlist for safety.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isAdmin ? (
                <AutoModeSettings settings={settings} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Admin or owner role required to modify these settings.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals">
          <Card>
            <CardHeader>
              <CardTitle>Approval Settings</CardTitle>
              <CardDescription>
                Configure which actions always require human approval
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isAdmin ? (
                <ApprovalSettings settings={settings} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Admin or owner role required to modify these settings.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content">
          <Card>
            <CardHeader>
              <CardTitle>Content Settings</CardTitle>
              <CardDescription>
                Configure default content preferences for generated messages
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isAdmin ? (
                <ContentSettings settings={settings} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Admin or owner role required to modify these settings.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
