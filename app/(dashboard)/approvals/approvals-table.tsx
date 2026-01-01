"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, RiskBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { type Approval } from "@/lib/actions/approvals";
import { formatDistanceToNow } from "@/lib/format";

interface ApprovalsTableProps {
  approvals: Approval[];
}

export function ApprovalsTable({ approvals }: ApprovalsTableProps) {
  if (approvals.length === 0) {
    return (
      <EmptyState
        title="No approvals found"
        description="When agent actions require approval, they will appear here"
      />
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Request</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Risk Level</TableHead>
            <TableHead>Actions</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approvals.map((approval) => (
            <TableRow key={approval.id}>
              <TableCell>
                <div>
                  <p className="font-medium">
                    {approval.agent_run?.agent_type ?? "Agent"} Request
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {getGoalSummary(approval)}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={approval.status} />
              </TableCell>
              <TableCell>
                <RiskBadge risk={approval.risk_level} />
              </TableCell>
              <TableCell>
                <span className="text-sm">
                  {approval.requested_actions?.length ?? 0} action
                  {(approval.requested_actions?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(approval.created_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {approval.expires_at
                  ? formatDistanceToNow(approval.expires_at)
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/approvals/${approval.id}`}>
                  <Button
                    size="sm"
                    variant={approval.status === "pending" ? "default" : "outline"}
                  >
                    {approval.status === "pending" ? "Review" : "View"}
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function getGoalSummary(approval: Approval): string {
  const input = approval.agent_run?.input as Record<string, unknown> | undefined;
  const goal = input?.goal as string | undefined;

  if (goal) {
    return goal.length > 60 ? goal.substring(0, 60) + "..." : goal;
  }

  return "View details for more information";
}
