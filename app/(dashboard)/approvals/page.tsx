import { Suspense } from "react";
import { getApprovals, type ApprovalFilters } from "@/lib/actions/approvals";
import { PageHeader } from "@/components/dashboard/page-header";
import { ApprovalsTable } from "./approvals-table";
import { ApprovalFiltersBar } from "./approval-filters";

interface ApprovalsPageProps {
  searchParams: Promise<{
    status?: string;
    risk_level?: string;
  }>;
}

export default async function ApprovalsPage({ searchParams }: ApprovalsPageProps) {
  const params = await searchParams;

  const filters: ApprovalFilters = {
    status: params.status,
    risk_level: params.risk_level,
  };

  const { approvals, error } = await getApprovals(filters);

  // Count pending for badge
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description={
          pendingCount > 0
            ? `${pendingCount} pending approval${pendingCount > 1 ? "s" : ""} require your attention`
            : "Review and approve agent actions"
        }
      />

      <ApprovalFiltersBar filters={filters} />

      <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading approvals...</div>}>
        {error ? (
          <div className="py-10 text-center text-destructive">{error}</div>
        ) : (
          <ApprovalsTable approvals={approvals} />
        )}
      </Suspense>
    </div>
  );
}
