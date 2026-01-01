"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, PriorityBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { type Task, updateTaskStatus, deleteTask } from "@/lib/actions/tasks";
import { formatDistanceToNow } from "@/lib/format";

interface TasksTableProps {
  tasks: Task[];
}

export function TasksTable({ tasks }: TasksTableProps) {
  const [pending, setPending] = useState<string | null>(null);

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No tasks found"
        description="Create your first task or adjust your filters"
        action={
          <Link href="/tasks/new">
            <Button>Create Task</Button>
          </Link>
        }
      />
    );
  }

  async function handleStatusChange(taskId: string, status: Task["status"]) {
    setPending(taskId);
    await updateTaskStatus(taskId, status);
    setPending(null);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell>
                <Link
                  href={`/tasks/${task.id}`}
                  className="font-medium hover:underline"
                >
                  {task.title}
                </Link>
                {task.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
                    {task.description}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={task.status} />
              </TableCell>
              <TableCell>
                <PriorityBadge priority={task.priority} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(task.created_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {task.due_date ? formatDistanceToNow(task.due_date) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {task.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending === task.id}
                      onClick={() => handleStatusChange(task.id, "in_progress")}
                    >
                      Start
                    </Button>
                  )}
                  {task.status === "in_progress" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending === task.id}
                      onClick={() => handleStatusChange(task.id, "completed")}
                    >
                      Complete
                    </Button>
                  )}
                  <Link href={`/tasks/${task.id}`}>
                    <Button size="sm" variant="ghost">
                      View
                    </Button>
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
