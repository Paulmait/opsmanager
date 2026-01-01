"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type AuditFilters } from "@/lib/actions/audit";

interface AuditFiltersBarProps {
  filters: AuditFilters;
  resourceTypes: string[];
}

export function AuditFiltersBar({ filters, resourceTypes }: AuditFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Reset to page 1 when filters change
    params.delete("page");
    router.push(`/audit?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/audit");
  }

  const hasFilters = filters.resource_type || filters.action || filters.date_from || filters.date_to;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="resource-filter" className="text-sm font-medium">
          Resource:
        </label>
        <NativeSelect
          id="resource-filter"
          value={filters.resource_type ?? "all"}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilter("resource_type", e.target.value)}
          className="w-[160px]"
        >
          <option value="all">All</option>
          {resourceTypes.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, " ")}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="action-filter" className="text-sm font-medium">
          Action:
        </label>
        <Input
          id="action-filter"
          type="text"
          placeholder="e.g. approval"
          defaultValue={filters.action ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            const timeout = setTimeout(() => updateFilter("action", value), 300);
            return () => clearTimeout(timeout);
          }}
          className="w-[150px]"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="date-from" className="text-sm font-medium">
          From:
        </label>
        <Input
          id="date-from"
          type="date"
          value={filters.date_from ?? ""}
          onChange={(e) => updateFilter("date_from", e.target.value)}
          className="w-[150px]"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="date-to" className="text-sm font-medium">
          To:
        </label>
        <Input
          id="date-to"
          type="date"
          value={filters.date_to ?? ""}
          onChange={(e) => updateFilter("date_to", e.target.value)}
          className="w-[150px]"
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
