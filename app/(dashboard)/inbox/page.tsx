import { requireActiveOrg } from "@/lib/guards";
import { getInboundEmails, getOrgEmailAlias, getEmailStats } from "@/lib/actions/email";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { EmailList } from "./email-list";
import { EmailAliasCard } from "./email-alias-card";

export const metadata = {
  title: "Inbox",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireActiveOrg();
  const params = await searchParams;

  const status = params.status;
  const page = parseInt(params.page ?? "1", 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  // Fetch data in parallel
  const [{ emails, total }, { alias }, { stats }] = await Promise.all([
    getInboundEmails({ limit, offset, status }),
    getOrgEmailAlias(),
    getEmailStats(),
  ]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Inbox"
        description="View and manage inbound emails processed by the agent"
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.todayCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Processed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats?.processed ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats?.pending ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats?.failed ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email Alias Setup */}
      <EmailAliasCard alias={alias} />

      {/* Email List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Emails</CardTitle>
          <CardDescription>
            Emails forwarded to your inbox alias are processed by the agent
          </CardDescription>
        </CardHeader>
        <CardContent>
          {emails.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No emails yet"
              description={
                alias
                  ? "Forward emails to your alias address to get started"
                  : "Set up your email alias to start receiving emails"
              }
            />
          ) : (
            <EmailList
              emails={emails}
              currentPage={page}
              totalPages={totalPages}
              currentStatus={status}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
