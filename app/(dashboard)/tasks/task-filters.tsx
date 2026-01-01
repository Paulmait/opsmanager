"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type TaskFilters } from "@/lib/actions/tasks";

interface TaskFiltersBarProps {
  filters: TaskFilters;
}

export function TaskFiltersBar({ filters }: TaskFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/tasks?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/tasks");
  }

  const hasFilters = filters.status || filters.priority || filters.search;

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
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </NativeSelect>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="priority-filter" className="text-sm font-medium">
          Priority:
        </label>
        <NativeSelect
          id="priority-filter"
          value={filters.priority ?? "all"}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilter("priority", e.target.value)}
          className="w-[120px]"
        >
          <option value="all">All</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </NativeSelect>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="search"
          placeholder="Search tasks..."
          defaultValue={filters.search ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            // Debounce search
            const timeout = setTimeout(() => updateFilter("search", value), 300);
            return () => clearTimeout(timeout);
          }}
          className="w-[200px]"
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
