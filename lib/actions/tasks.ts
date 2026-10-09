"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export interface TaskInput {
  lead_id: string
  description: string
  due_date: string
  completed?: boolean
}

function isTableNotFoundError(error: any): boolean {
  return error?.code === "PGRST205" || error?.message?.includes("Could not find the table")
}

export async function createTask(input: TaskInput) {
  try {
    const supabase = await createClient()

    console.log("[v0] Creating task with input:", input)

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        lead_id: input.lead_id,
        description: input.description,
        due_date: input.due_date,
        completed: input.completed || false,
      })
      .select()
      .single()

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
        throw new Error("Tasks table not found. Please run the database migration script.")
      }
      console.error("[v0] Error creating task:", error)
      throw new Error("Failed to create task: " + error.message)
    }

    console.log("[v0] Task created successfully:", data)

    revalidatePath("/calendar")
    revalidatePath("/leads")
    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")

    return data
  } catch (error) {
    console.error("[v0] Error in createTask:", error)
    throw error
  }
}

export async function updateTask(id: string, updates: Partial<TaskInput>) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase.from("tasks").update(updates).eq("id", id).select().single()

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
        throw new Error("Tasks table not found")
      }
      console.error("[v0] Error updating task:", error)
      throw new Error("Failed to update task")
    }

    revalidatePath("/calendar")
    revalidatePath("/leads")
    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")

    return data
  } catch (error) {
    console.error("[v0] Error in updateTask:", error)
    throw error
  }
}

export async function deleteTask(id: string) {
  try {
    if (!(await isCurrentUserAdmin())) throw new Error("Somente administradores podem excluir registros")
    const supabase = await createClient()

    const { error } = await supabase.from("tasks").delete().eq("id", id)

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
        return
      }
      console.error("[v0] Error deleting task:", error)
      throw new Error("Failed to delete task")
    }

    revalidatePath("/calendar")
    revalidatePath("/leads")
    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")
  } catch (error) {
    console.error("[v0] Error in deleteTask:", error)
    throw error
  }
}

export async function getTasksByLeadId(leadId: string) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("lead_id", leadId)
      .order("due_date", { ascending: true })

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found")
        return []
      }
      console.error("[v0] Error fetching tasks:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Error in getTasksByLeadId:", error)
    return []
  }
}

export async function getTasksForCurrentUser() {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.log("[v0] No user found")
      return []
    }

    // Get user's profile to check their role
    const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).single()

    if (!profile) {
      console.log("[v0] No profile found for user")
      return []
    }

    console.log("[v0] User role:", profile.role)

    // Build query based on user role
    const query = supabase
      .from("tasks")
      .select(
        `
        *,
        leads:lead_id (
          id,
          name,
          company,
          sdr_id,
          closer_id,
          sd_id
        )
      `,
      )
      .order("due_date", { ascending: true })

    // If not admin, filter by assigned leads
    if (profile.role !== "admin") {
      // First get the tasks, then filter by lead assignment
      const { data: allTasks, error: tasksError } = await query

      if (tasksError) {
        if (isTableNotFoundError(tasksError)) {
          console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
          return []
        }
        console.error("[v0] Error fetching tasks:", tasksError)
        return []
      }

      // Filter tasks based on user role
      const filteredTasks = (allTasks || []).filter((task: any) => {
        if (!task.leads) return false

        if (profile.role === "sdr") {
          return task.leads.sdr_id === user.id
        } else if (profile.role === "closer") {
          return task.leads.closer_id === user.id
        } else if (profile.role === "sd") {
          return task.leads.sd_id === user.id
        }

        return true
      })

      console.log("[v0] Filtered tasks for", profile.role, ":", filteredTasks.length)
      return filteredTasks
    }

    // Admin gets all tasks
    const { data, error } = await query

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
        return []
      }
      console.error("[v0] Error fetching user tasks:", error)
      return []
    }

    console.log("[v0] Admin tasks fetched:", data?.length || 0)
    return data || []
  } catch (error) {
    console.error("[v0] Error in getTasksForCurrentUser:", error)
    return []
  }
}

export async function getAllTasks() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        *,
        leads:lead_id (
          id,
          name,
          company
        )
      `,
      )
      .order("due_date", { ascending: true })

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found")
        return []
      }
      console.error("[v0] Error fetching all tasks:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Error in getAllTasks:", error)
    return []
  }
}

export async function toggleTaskCompletion(id: string, completed: boolean) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase.from("tasks").update({ completed }).eq("id", id).select().single()

    if (error) {
      if (isTableNotFoundError(error)) {
        console.warn("[v0] Tasks table not found. Please run script: 009_create_tasks_table_v2.sql")
        throw new Error("Tasks table not found")
      }
      console.error("[v0] Error toggling task completion:", error)
      throw new Error("Failed to toggle task completion")
    }

    revalidatePath("/calendar")
    revalidatePath("/leads")
    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")

    return data
  } catch (error) {
    console.error("[v0] Error in toggleTaskCompletion:", error)
    throw error
  }
}
