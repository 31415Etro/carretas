"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export interface CommentInput {
  lead_id: string
  content: string
}

function isTableOrRelationshipError(error: any): boolean {
  return (
    error?.code === "PGRST205" ||
    error?.code === "PGRST200" ||
    error?.message?.includes("Could not find the table") ||
    error?.message?.includes("Could not find a relationship")
  )
}

export async function getCommentsByLeadId(leadId: string) {
  try {
    const supabase = await createClient()

    const { data: comments, error: commentsError } = await supabase
      .from("comments")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })

    if (commentsError) {
      if (isTableOrRelationshipError(commentsError)) {
        console.warn("[v0] Comments table not found. Please run script: 002_create_comments_table.sql")
        return []
      }
      console.error("[v0] Error fetching comments:", commentsError)
      return []
    }

    if (!comments || comments.length === 0) {
      return []
    }

    const userIds = [...new Set(comments.map((c) => c.user_id))]
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds)

    if (profilesError) {
      console.error("[v0] Error fetching user profiles:", profilesError.message)
      // Return comments without user names if profiles fetch fails
      return comments.map((comment) => ({
        ...comment,
        user_name: "Unknown User",
      }))
    }

    const profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || [])
    const commentsWithNames = comments.map((comment) => ({
      ...comment,
      user_name: profileMap.get(comment.user_id) || "Unknown User",
    }))

    return commentsWithNames
  } catch (error) {
    console.error("[v0] Error in getCommentsByLeadId:", error)
    return []
  }
}

export async function createComment(input: CommentInput) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.warn("[v0] User not authenticated")
      return null
    }

    const { data, error } = await supabase
      .from("comments")
      .insert({
        lead_id: input.lead_id,
        user_id: user.id,
        content: input.content,
      })
      .select()
      .single()

    if (error) {
      if (isTableOrRelationshipError(error)) {
        console.warn(
          "[v0] Comments table not found or relationship issue. Please run script: 002_create_comments_table.sql",
        )
        return null
      }
      console.error("[v0] Error creating comment:", error)
      return null
    }

    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")
    revalidatePath("/leads")
    revalidatePath("/clients")

    return data
  } catch (error) {
    console.error("[v0] Error in createComment:", error)
    return null
  }
}

export async function updateComment(id: string, content: string) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("comments")
      .update({
        content,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      if (isTableOrRelationshipError(error)) {
        console.warn(
          "[v0] Comments table not found or relationship issue. Please run script: 002_create_comments_table.sql",
        )
        return null
      }
      console.error("[v0] Error updating comment:", error)
      return null
    }

    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")
    revalidatePath("/leads")
    revalidatePath("/clients")

    return data
  } catch (error) {
    console.error("[v0] Error in updateComment:", error)
    return null
  }
}

export async function deleteComment(id: string) {
  try {
    if (!(await isCurrentUserAdmin())) return { success: false }
    const supabase = await createClient()

    const { error } = await supabase.from("comments").delete().eq("id", id)

    if (error) {
      if (isTableOrRelationshipError(error)) {
        console.warn(
          "[v0] Comments table not found or relationship issue. Please run script: 002_create_comments_table.sql",
        )
        return { success: false }
      }
      console.error("[v0] Error deleting comment:", error)
      return { success: false }
    }

    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")
    revalidatePath("/leads")
    revalidatePath("/clients")

    return { success: true }
  } catch (error) {
    console.error("[v0] Error in deleteComment:", error)
    return { success: false }
  }
}
