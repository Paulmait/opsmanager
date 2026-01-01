"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { type ApprovalFilters } from "@/lib/actions/approvals";

interface ApprovalFiltersBarProps {
  filters: ApprovalFilters;
}

export function ApprovalFiltersBar({ filters }: ApprovalFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/approvals?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/approvals");
  }

  const hasFilters = filters.status || filters.risk_level;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm font-medium">
          Status:
        </label>
        <NativeSelect
          id="status-filter"
          value={filters.status ?? "all"}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilter("status", e.target.value)}
          className="w-[140px]"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </NativeSelect>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="risk-filter" className="text-sm font-medium">
          Risk Level:
        </label>
        <NativeSelect
          id="risk-filter"
          value={filters.risk_level ?? "all"}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilter("risk_level", e.target.value)}
          className="w-[120px]"
        >
          <option value="all">All</option>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </NativeSelect>
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
