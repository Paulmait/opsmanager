import { Suspense } from "react";
import { getAuditLogs, getResourceTypes, type AuditFilters } from "@/lib/actions/audit";
import { PageHeader } from "@/components/dashboard/page-header";
import { AuditLogsTable } from "./audit-table";
import { AuditFiltersBar } from "./audit-filters";
import { AuditPagination } from "./audit-pagination";

interface AuditPageProps {
  searchParams: Promise<{
    resource_type?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    page?: string;
  }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const params = await searchParams;

  const filters: AuditFilters = {
    resource_type: params.resource_type,
    action: params.action,
    date_from: params.date_from,
    date_to: params.date_to,
  };

  const page = parseInt(params.page ?? "1", 10);
  const limit = 50;

  const [{ logs, total, error }, resourceTypes] = await Promise.all([
    getAuditLogs(filters, { page, limit }),
    getResourceTypes(),
  ]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Immutable record of all actions taken in your organization"
      />

      <AuditFiltersBar filters={filters} resourceTypes={resourceTypes} />

      <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading audit logs...</div>}>
        {error ? (
          <div className="py-10 text-center text-destructive">{error}</div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Showing {logs.length} of {total} entries
            </div>
            <AuditLogsTable logs={logs} />
            {totalPages > 1 && (
              <AuditPagination
                currentPage={page}
                totalPages={totalPages}
              />
            )}
          </>
        )}
      </Suspense>
    </div>
  );
}
