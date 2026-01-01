"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { type AuditLogEntry } from "@/lib/actions/audit";
import { formatDateTime } from "@/lib/format";

interface AuditLogsTableProps {
  logs: AuditLogEntry[];
}

export function AuditLogsTable({ logs }: AuditLogsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  if (logs.length === 0) {
    return (
      <EmptyState
        title="No audit logs found"
        description="Actions taken in your organization will be recorded here"
      />
    );
  }

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Timestamp</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Resource</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead className="text-right">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <>
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(log.created_at)}
                </TableCell>
                <TableCell>
                  <ActionBadge action={log.action} />
                </TableCell>
                <TableCell>
                  <div>
                    <span className="text-sm capitalize">
                      {log.resource_type.replace(/_/g, " ")}
                    </span>
                    {log.resource_id && (
                      <p className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                        {log.resource_id}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[150px]">
                  {log.actor_id === "system" ? (
                    <Badge variant="secondary">System</Badge>
                  ) : (
                    log.actor_id
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {Object.keys(log.metadata).length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleRow(log.id)}
                    >
                      {expandedRows.has(log.id) ? "Hide" : "Show"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              {expandedRows.has(log.id) && (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/30">
                    <div className="p-2">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Metadata:
                      </p>
                      <pre className="rounded bg-muted p-3 text-xs overflow-x-auto">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  // Parse action for coloring
  const parts = action.split(".");
  const category = parts[0];
  const type = parts[parts.length - 1];

  let variant: "default" | "secondary" | "destructive" | "success" | "warning" | "info" = "secondary";

  if (type === "error" || type === "failed" || type === "rejected") {
    variant = "destructive";
  } else if (type === "success" || type === "completed" || type === "approved") {
    variant = "success";
  } else if (type === "start" || type === "created") {
    variant = "info";
  } else if (type === "updated" || type === "modified") {
    variant = "warning";
  }

  return (
    <Badge variant={variant} className="font-mono text-xs">
      {action}
    </Badge>
  );
}
