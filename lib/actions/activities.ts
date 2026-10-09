"use server"

import { createServerClient } from "@/lib/supabase/server"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"

export interface Activity {
  id: string
  type:
    | "lead-created"
    | "deal-closed"
    | "meeting-scheduled"
    | "comment-added"
    | "payment-received"
    | "interaction-logged"
  userName: string
  description: string
  value?: string
  time: string
  timestamp: Date
}

export async function getRecentActivities(limit = 10): Promise<Activity[]> {
  try {
    const supabase = await createServerClient()

    const activities: Activity[] = []

    const { data: profiles } = await supabase.from("profiles").select("id, full_name")

    const profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || [])

    const { data: allLeads } = await supabase.from("leads").select("id, name")

    const leadMap = new Map(allLeads?.map((l) => [l.id, l.name]) || [])

    // Fetch recent leads
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, created_at, sdr_id, closer_id")
      .order("created_at", { ascending: false })
      .limit(5)

    if (leads) {
      leads.forEach((lead) => {
        const userName = profileMap.get(lead.sdr_id || lead.closer_id || "") || "Usuário"
        activities.push({
          id: `lead-${lead.id}`,
          type: "lead-created",
          userName,
          description: `adicionou novo lead ${lead.name}`,
          time: formatDistanceToNow(new Date(lead.created_at), { addSuffix: true, locale: ptBR }),
          timestamp: new Date(lead.created_at),
        })
      })
    }

    const { data: closedLeads } = await supabase
      .from("leads")
      .select("id, name, deal_value, closed_date, closer_id, updated_at")
      .eq("status", "fechado")
      .not("deal_value", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5)

    if (closedLeads) {
      closedLeads.forEach((lead) => {
        const userName = profileMap.get(lead.closer_id || "") || "Usuário"
        const dateToUse = lead.closed_date || lead.updated_at
        activities.push({
          id: `deal-${lead.id}`,
          type: "deal-closed",
          userName,
          description: `fechou negócio com ${lead.name}`,
          value: lead.deal_value ? `R$ ${Number(lead.deal_value).toLocaleString("pt-BR")}` : undefined,
          time: formatDistanceToNow(new Date(dateToUse), { addSuffix: true, locale: ptBR }),
          timestamp: new Date(dateToUse),
        })
      })
    }

    const { data: meetings } = await supabase
      .from("leads")
      .select("id, name, meeting_date, sdr_id, closer_id")
      .not("meeting_date", "is", null)
      .gte("meeting_date", new Date().toISOString())
      .order("meeting_date", { ascending: true })
      .limit(5)

    if (meetings) {
      meetings.forEach((lead) => {
        const userName = profileMap.get(lead.closer_id || lead.sdr_id || "") || "Usuário"
        activities.push({
          id: `meeting-${lead.id}`,
          type: "meeting-scheduled",
          userName,
          description: `agendou reunião com ${lead.name}`,
          time: formatDistanceToNow(new Date(lead.meeting_date!), { addSuffix: true, locale: ptBR }),
          timestamp: new Date(lead.meeting_date!),
        })
      })
    }

    const { data: comments } = await supabase
      .from("comments")
      .select("id, content, created_at, user_id, lead_id")
      .order("created_at", { ascending: false })
      .limit(5)

    if (comments) {
      comments.forEach((comment) => {
        const userName = profileMap.get(comment.user_id || "") || "Usuário"
        const leadName = leadMap.get(comment.lead_id || "") || "lead"
        activities.push({
          id: `comment-${comment.id}`,
          type: "comment-added",
          userName,
          description: `comentou em ${leadName}`,
          time: formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR }),
          timestamp: new Date(comment.created_at),
        })
      })
    }

    const { data: interactions } = await supabase
      .from("interactions")
      .select("id, type, description, created_at, user_id, lead_id")
      .order("created_at", { ascending: false })
      .limit(5)

    if (interactions) {
      interactions.forEach((interaction) => {
        const userName = profileMap.get(interaction.user_id || "") || "Usuário"
        const leadName = leadMap.get(interaction.lead_id || "") || "lead"
        activities.push({
          id: `interaction-${interaction.id}`,
          type: "interaction-logged",
          userName,
          description: `registrou ${interaction.type} com ${leadName}`,
          time: formatDistanceToNow(new Date(interaction.created_at), { addSuffix: true, locale: ptBR }),
          timestamp: new Date(interaction.created_at),
        })
      })
    }

    // Sort by timestamp and return limited results
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return activities.slice(0, limit)
  } catch (error) {
    console.error("[v0] Error fetching activities:", error)
    return []
  }
}
