"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { type Task, updateTaskStatus, deleteTask } from "@/lib/actions/tasks";

interface TaskActionsProps {
  task: Task;
}

export function TaskActions({ task }: TaskActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleStatusChange(status: Task["status"]) {
    setPending(true);
    const result = await updateTaskStatus(task.id, status);
    if (result.error) {
      alert(result.error);
    }
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this task?")) {
      return;
    }

    setPending(true);
    const result = await deleteTask(task.id);
    if (result.error) {
      alert(result.error);
      setPending(false);
    } else {
      router.push("/tasks");
    }
  }

  return (
    <>
      {task.status === "pending" && (
        <Button
          variant="default"
          disabled={pending}
          onClick={() => handleStatusChange("in_progress")}
        >
          Start Task
        </Button>
      )}
      {task.status === "in_progress" && (
        <Button
          variant="default"
          disabled={pending}
          onClick={() => handleStatusChange("completed")}
        >
          Mark Complete
        </Button>
      )}
      {task.status !== "cancelled" && task.status !== "completed" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => handleStatusChange("cancelled")}
        >
          Cancel
        </Button>
      )}
      <Button variant="destructive" disabled={pending} onClick={handleDelete}>
        Delete
      </Button>
    </>
  );
}
