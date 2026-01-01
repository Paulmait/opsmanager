"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

interface AuditPaginationProps {
  currentPage: number;
  totalPages: number;
}

export function AuditPagination({ currentPage, totalPages }: AuditPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) {
      params.set("page", String(page));
    } else {
      params.delete("page");
    }
    router.push(`/audit?${params.toString()}`);
  }

  // Calculate page range to show
  const pageRange: number[] = [];
  const maxPages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
  const endPage = Math.min(totalPages, startPage + maxPages - 1);

  if (endPage - startPage < maxPages - 1) {
    startPage = Math.max(1, endPage - maxPages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pageRange.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => goToPage(currentPage - 1)}
      >
        Previous
      </Button>

      {startPage > 1 && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(1)}
          >
            1
          </Button>
          {startPage > 2 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
        </>
      )}

      {pageRange.map((page) => (
        <Button
          key={page}
          variant={page === currentPage ? "default" : "outline"}
          size="sm"
          onClick={() => goToPage(page)}
        >
          {page}
        </Button>
      ))}

      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && (
            <span className="px-2 text-muted-foreground">...</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(totalPages)}
          >
            {totalPages}
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => goToPage(currentPage + 1)}
      >
        Next
      </Button>
    </div>
  );
}
