import { Suspense } from "react";
import { getTasks, type TaskFilters } from "@/lib/actions/tasks";
import { PageHeader } from "@/components/dashboard/page-header";
import { TasksTable } from "./tasks-table";
import { TaskFiltersBar } from "./task-filters";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface TasksPageProps {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    search?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;

  const filters: TaskFilters = {
    status: params.status,
    priority: params.priority,
    search: params.search,
  };

  const { tasks, error } = await getTasks(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Manage and track tasks created by agents or manually"
        actions={
          <Link href="/tasks/new">
            <Button>Create Task</Button>
          </Link>
        }
      />

      <TaskFiltersBar filters={filters} />

      <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading tasks...</div>}>
        {error ? (
          <div className="py-10 text-center text-destructive">{error}</div>
        ) : (
          <TasksTable tasks={tasks} />
        )}
      </Suspense>
    </div>
  );
}
