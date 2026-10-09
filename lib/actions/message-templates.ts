"use server"

import { createServerClient } from "@/lib/supabase/server"
import type { MessageTemplate } from "@/lib/types"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export async function getMessageTemplates(): Promise<MessageTemplate[]> {
  const supabase = await createServerClient()
  const { data: user } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User not authenticated")
  }

  const { data, error } = await supabase
    .from("message_templates")
    .select("*")
    .eq("user_id", user.user.id)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching templates:", error)
    throw error
  }

  return (data || []).map((template) => ({
    ...template,
    userId: template.user_id,
  }))
}

export async function createMessageTemplate(
  title: string,
  content: string,
  category: MessageTemplate["category"],
  variables: string[],
): Promise<MessageTemplate> {
  const supabase = await createServerClient()
  const { data: user } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("User not authenticated")
  }

  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      user_id: user.user.id,
      title,
      content,
      category,
      variables,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Error creating template:", error)
    throw error
  }

  return {
    ...data,
    userId: data.user_id,
  }
}

export async function updateMessageTemplate(
  id: string,
  title: string,
  content: string,
  category: MessageTemplate["category"],
  variables: string[],
): Promise<MessageTemplate> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from("message_templates")
    .update({
      title,
      content,
      category,
      variables,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    console.error("[v0] Error updating template:", error)
    throw error
  }

  return {
    ...data,
    userId: data.user_id,
  }
}

export async function deleteMessageTemplate(id: string): Promise<void> {
  if (!(await isCurrentUserAdmin())) throw new Error("Somente administradores podem excluir registros")
  const supabase = await createServerClient()

  const { error } = await supabase.from("message_templates").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting template:", error)
    throw error
  }
}
