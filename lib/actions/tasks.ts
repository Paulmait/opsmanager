"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveOrg } from "@/lib/guards";
import { revalidatePath } from "next/cache";

// =============================================================================
// Types
// =============================================================================

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  created_by: string;
}

export interface TaskFilters {
  status?: string;
  priority?: string;
  search?: string;
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Fetch tasks for the current organization.
 *
 * SECURITY:
 * - Verifies org membership before fetching
 * - RLS enforces org isolation at database level
 * - Never exposes tasks from other orgs
 */
export async function getTasks(filters?: TaskFilters): Promise<{
  tasks: Task[];
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    let query = supabase
      .from("tasks")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false });

    if (filters?.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters?.priority && filters.priority !== "all") {
      query = query.eq("priority", filters.priority);
    }

    if (filters?.search) {
      query = query.or(
        `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await query.limit(100);

    if (error) {
      console.error("Failed to fetch tasks:", error);
      return { tasks: [], error: error.message };
    }

    return { tasks: data as Task[], error: null };
  } catch (error) {
    console.error("getTasks error:", error);
    return { tasks: [], error: "Failed to fetch tasks" };
  }
}

/**
 * Get a single task by ID.
 */
export async function getTask(taskId: string): Promise<{
  task: Task | null;
  error: string | null;
}> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (error) {
      return { task: null, error: "Task not found" };
    }

    return { task: data as Task, error: null };
  } catch (error) {
    return { task: null, error: "Failed to fetch task" };
  }
}

/**
 * Create a new task.
 */
export async function createTask(data: {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string;
}): Promise<{ task: Task | null; error: string | null }> {
  try {
    const { user, profile, supabase } = await requireActiveOrg();

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        organization_id: profile.organization_id,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? "medium",
        due_date: data.due_date ?? null,
        status: "pending",
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return { task: null, error: error.message };
    }

    revalidatePath("/tasks");
    return { task: task as Task, error: null };
  } catch (error) {
    return { task: null, error: "Failed to create task" };
  }
}

/**
 * Update task status.
 */
export async function updateTaskStatus(
  taskId: string,
  status: Task["status"]
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    const { error } = await supabase
      .from("tasks")
      .update({
        status,
        ...(status === "completed" && { completed_at: new Date().toISOString() }),
      })
      .eq("id", taskId)
      .eq("organization_id", profile.organization_id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/tasks");
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to update task" };
  }
}

/**
 * Delete a task.
 * Only owners and admins can delete tasks.
 */
export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { profile, supabase } = await requireActiveOrg();

    // Check role
    if (!["owner", "admin"].includes(profile.role)) {
      return { success: false, error: "Insufficient permissions" };
    }

    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .eq("organization_id", profile.organization_id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/tasks");
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: "Failed to delete task" };
  }
}
