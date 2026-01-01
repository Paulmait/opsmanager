import { notFound } from "next/navigation";
import Link from "next/link";
import { getTask } from "@/lib/actions/tasks";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge, PriorityBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { TaskActions } from "./task-actions";

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const { task, error } = await getTask(id);

  if (error || !task) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={task.title}
        actions={
          <div className="flex items-center gap-2">
            <TaskActions task={task} />
            <Link href="/tasks">
              <Button variant="outline">Back to Tasks</Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={task.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Priority</dt>
              <dd className="mt-1">
                <PriorityBadge priority={task.priority} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1">{formatDateTime(task.created_at)}</dd>
            </div>
            {task.due_date && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Due Date</dt>
                <dd className="mt-1">{formatDateTime(task.due_date)}</dd>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            {task.description ? (
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description provided</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
