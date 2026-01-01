"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InboundEmailSummary } from "@/lib/actions/email";

interface EmailListProps {
  emails: InboundEmailSummary[];
  currentPage: number;
  totalPages: number;
  currentStatus?: string;
}

export function EmailList({
  emails,
  currentPage,
  totalPages,
  currentStatus,
}: EmailListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.set("page", "1");
    router.push(`/inbox?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    router.push(`/inbox?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select
          value={currentStatus ?? "all"}
          onValueChange={handleStatusChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>From</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Received</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((email) => (
            <TableRow key={email.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {email.fromName ?? email.fromAddress}
                  </span>
                  {email.fromName && (
                    <span className="text-sm text-muted-foreground">
                      {email.fromAddress}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {email.hasAttachments && (
                    <svg
                      className="h-4 w-4 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                      />
                    </svg>
                  )}
                  <div className="flex flex-col">
                    <span className="truncate max-w-[300px]">
                      {email.subject ?? "(no subject)"}
                    </span>
                    {email.snippet && (
                      <span className="text-sm text-muted-foreground truncate max-w-[300px]">
                        {email.snippet}
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={email.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatRelativeTime(email.receivedAt)}
              </TableCell>
              <TableCell>
                <Link href={`/inbox/${email.id}`}>
                  <Button variant="ghost" size="sm">
                    View
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    received: "secondary",
    processing: "secondary",
    processed: "default",
    failed: "destructive",
    ignored: "outline",
  };

  return (
    <Badge variant={variants[status] ?? "secondary"}>
      {status}
    </Badge>
  );
}
