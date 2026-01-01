import { notFound } from "next/navigation";
import Link from "next/link";
import { getApproval } from "@/lib/actions/approvals";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge, RiskBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { ApprovalActions } from "./approval-actions";
import { ActionPreview } from "./action-preview";

interface ApprovalDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ApprovalDetailPage({ params }: ApprovalDetailPageProps) {
  const { id } = await params;
  const { approval, error } = await getApproval(id);

  if (error || !approval) {
    notFound();
  }

  const input = approval.agent_run?.input as Record<string, unknown> | undefined;
  const goal = input?.goal as string | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Request"
        actions={
          <Link href="/approvals">
            <Button variant="outline">Back to Approvals</Button>
          </Link>
        }
      />

      {/* Status Banner */}
      {approval.status === "pending" && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                Action Required
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Review the proposed actions below and approve or reject this request.
              </p>
            </div>
            <ApprovalActions approval={approval} />
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Request Details */}
        <Card>
          <CardHeader>
            <CardTitle>Request Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={approval.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Risk Level</dt>
              <dd className="mt-1">
                <RiskBadge risk={approval.risk_level} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Goal</dt>
              <dd className="mt-1 text-sm">{goal ?? "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Requested</dt>
              <dd className="mt-1 text-sm">{formatDateTime(approval.created_at)}</dd>
            </div>
            {approval.expires_at && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Expires</dt>
                <dd className="mt-1 text-sm">{formatDateTime(approval.expires_at)}</dd>
              </div>
            )}
            {approval.decided_at && (
              <>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Decision</dt>
                  <dd className="mt-1 text-sm">{formatDateTime(approval.decided_at)}</dd>
                </div>
                {approval.decision_reason && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Reason</dt>
                    <dd className="mt-1 text-sm">{approval.decision_reason}</dd>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Agent Context */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Context</CardTitle>
            <CardDescription>
              Information about the agent that created this request
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Agent Type</dt>
              <dd className="mt-1 text-sm capitalize">
                {approval.agent_run?.agent_type ?? "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Run ID</dt>
              <dd className="mt-1 font-mono text-xs text-muted-foreground">
                {approval.agent_run_id}
              </dd>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Proposed Actions Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Proposed Actions</CardTitle>
          <CardDescription>
            Review what will happen if you approve this request
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionPreview actions={approval.requested_actions} />
        </CardContent>
      </Card>
    </div>
  );
}
