"use server"

import { createClient } from "@/lib/supabase/server"

export interface SDActivityInput {
  id?: string
  activity_date: string
  project_code?: string
  lead_id?: string
  revision_count?: number
  client_name?: string
  seller_id?: string
  resource_name?: string
  activity_type?: string
  hours_spent?: number
  is_priority?: boolean
  delay_notes?: string
  is_reallocated?: boolean
  sd_cost?: number
  travel_cost?: number
  sale_value?: number
  notes?: string
}

// Get all SD activities with filters
export async function getSDActivities(params?: {
  startDate?: string
  endDate?: string
  sellerId?: string
  activityType?: string
}) {
  try {
    const supabase = await createClient()
    
    let query = supabase
      .from("sd_activities")
      .select(`
        *,
        seller:profiles!sd_activities_seller_id_fkey(id, full_name, email),
        lead:leads!sd_activities_lead_id_fkey(id, name, company, project_code)
      `)
      .order("activity_date", { ascending: false })
      .order("created_at", { ascending: false })

    if (params?.startDate) {
      query = query.gte("activity_date", params.startDate)
    }
    if (params?.endDate) {
      query = query.lte("activity_date", params.endDate)
    }
    if (params?.sellerId && params.sellerId !== "all") {
      query = query.eq("seller_id", params.sellerId)
    }
    if (params?.activityType && params.activityType !== "all") {
      query = query.eq("activity_type", params.activityType)
    }

    const { data, error } = await query

    if (error) {
      console.error("[v0] getSDActivities - Error:", error)
      return { data: [], error: error.message }
    }

    return { data: data || [], error: null }
  } catch (error) {
    console.error("[v0] getSDActivities - Error:", error)
    return { data: [], error: "Erro ao buscar atividades SD" }
  }
}

// Create a new SD activity
export async function createSDActivity(input: SDActivityInput) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { data: null, error: "Usuário não autenticado" }
    }

    const { data, error } = await supabase
      .from("sd_activities")
      .insert({
        activity_date: input.activity_date,
        project_code: input.project_code || null,
        lead_id: input.lead_id || null,
        revision_count: input.revision_count || 0,
        client_name: input.client_name || null,
        seller_id: input.seller_id || null,
        resource_name: input.resource_name || null,
        activity_type: input.activity_type || null,
        hours_spent: input.hours_spent || 0,
        is_priority: input.is_priority || false,
        delay_notes: input.delay_notes || null,
        is_reallocated: input.is_reallocated || false,
        sd_cost: input.sd_cost || 0,
        travel_cost: input.travel_cost || 0,
        sale_value: input.sale_value || 0,
        notes: input.notes || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] createSDActivity - Error:", error)
      return { data: null, error: error.message }
    }

    return { data, error: null }
  } catch (error) {
    console.error("[v0] createSDActivity - Error:", error)
    return { data: null, error: "Erro ao criar atividade SD" }
  }
}

// Update an SD activity
export async function updateSDActivity(id: string, input: Partial<SDActivityInput>) {
  try {
    const supabase = await createClient()
    
    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (input.activity_date !== undefined) updateData.activity_date = input.activity_date
    if (input.project_code !== undefined) updateData.project_code = input.project_code || null
    if (input.lead_id !== undefined) updateData.lead_id = input.lead_id || null
    if (input.revision_count !== undefined) updateData.revision_count = input.revision_count
    if (input.client_name !== undefined) updateData.client_name = input.client_name || null
    if (input.seller_id !== undefined) updateData.seller_id = input.seller_id || null
    if (input.resource_name !== undefined) updateData.resource_name = input.resource_name || null
    if (input.activity_type !== undefined) updateData.activity_type = input.activity_type || null
    if (input.hours_spent !== undefined) updateData.hours_spent = input.hours_spent
    if (input.is_priority !== undefined) updateData.is_priority = input.is_priority
    if (input.delay_notes !== undefined) updateData.delay_notes = input.delay_notes || null
    if (input.is_reallocated !== undefined) updateData.is_reallocated = input.is_reallocated
    if (input.sd_cost !== undefined) updateData.sd_cost = input.sd_cost
    if (input.travel_cost !== undefined) updateData.travel_cost = input.travel_cost
    if (input.sale_value !== undefined) updateData.sale_value = input.sale_value
    if (input.notes !== undefined) updateData.notes = input.notes || null

    const { data, error } = await supabase
      .from("sd_activities")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("[v0] updateSDActivity - Error:", error)
      return { data: null, error: error.message }
    }

    return { data, error: null }
  } catch (error) {
    console.error("[v0] updateSDActivity - Error:", error)
    return { data: null, error: "Erro ao atualizar atividade SD" }
  }
}

// Delete an SD activity
export async function deleteSDActivity(id: string) {
  try {
    const supabase = await createClient()

    const { error } = await supabase
      .from("sd_activities")
      .delete()
      .eq("id", id)

    if (error) {
      console.error("[v0] deleteSDActivity - Error:", error)
      return { error: error.message }
    }

    return { error: null }
  } catch (error) {
    console.error("[v0] deleteSDActivity - Error:", error)
    return { error: "Erro ao excluir atividade SD" }
  }
}

// Get projects/leads for selection dropdown
export async function getProjectsForSelection() {
  try {
    const supabase = await createClient()
    
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, project_code, company, name")
      .not("project_code", "is", null)
      .order("project_code", { ascending: false })
      .limit(500)

    if (error) {
      console.error("[v0] getProjectsForSelection - Error:", error)
      return { data: [], error: error.message }
    }

    return { data: leads || [], error: null }
  } catch (error) {
    console.error("[v0] getProjectsForSelection - Error:", error)
    return { data: [], error: "Erro ao buscar projetos" }
  }
}

// Get activity types
export async function getActivityTypes() {
  return [
    { value: "interna", label: "Interna" },
    { value: "reuniao", label: "Reunião" },
    { value: "analise_dados", label: "Análise de Dados" },
    { value: "layout", label: "Layout" },
    { value: "precificacao", label: "Precificação" },
    { value: "layout_3d", label: "Layout 3D" },
    { value: "proposta", label: "Proposta" },
    { value: "visita", label: "Visita" },
  ]
}

// Get aggregated metrics from activities
export async function getAggregatedMetrics(params?: {
  startDate?: string
  endDate?: string
  sellerId?: string
}) {
  try {
    const supabase = await createClient()
    
    let query = supabase
      .from("sd_activities")
      .select("*")

    if (params?.startDate) {
      query = query.gte("activity_date", params.startDate)
    }
    if (params?.endDate) {
      query = query.lte("activity_date", params.endDate)
    }
    if (params?.sellerId && params.sellerId !== "all") {
      query = query.eq("seller_id", params.sellerId)
    }

    const { data: activities, error } = await query

    if (error) {
      console.error("[v0] getAggregatedMetrics - Error:", error)
      return { data: null, error: error.message }
    }

    if (!activities || activities.length === 0) {
      return {
        data: {
          totalHours: 0,
          totalSDCost: 0,
          totalTravelCost: 0,
          totalSaleValue: 0,
          priorityCount: 0,
          reallocatedCount: 0,
          byActivity: [],
          bySeller: [],
        },
        error: null,
      }
    }

    // Calculate totals
    const totalHours = activities.reduce((sum, a) => sum + (a.hours_spent || 0), 0)
    const totalSDCost = activities.reduce((sum, a) => sum + (a.sd_cost || 0), 0)
    const totalTravelCost = activities.reduce((sum, a) => sum + (a.travel_cost || 0), 0)
    const totalSaleValue = activities.reduce((sum, a) => sum + (a.sale_value || 0), 0)
    const priorityCount = activities.filter(a => a.is_priority).length
    const reallocatedCount = activities.filter(a => a.is_reallocated).length

    // Group by activity type
    const byActivityMap = new Map<string, { hours: number; count: number }>()
    for (const activity of activities) {
      if (activity.activity_type) {
        const current = byActivityMap.get(activity.activity_type) || { hours: 0, count: 0 }
        byActivityMap.set(activity.activity_type, {
          hours: current.hours + (activity.hours_spent || 0),
          count: current.count + 1,
        })
      }
    }
    const byActivity = Array.from(byActivityMap.entries()).map(([type, data]) => ({
      activity: type,
      hours: data.hours,
      count: data.count,
      percentage: totalHours > 0 ? (data.hours / totalHours) * 100 : 0,
    }))

    // Group by seller
    const bySellerMap = new Map<string, { hours: number; sdCost: number; travelCost: number; saleValue: number }>()
    for (const activity of activities) {
      if (activity.seller_id) {
        const current = bySellerMap.get(activity.seller_id) || { hours: 0, sdCost: 0, travelCost: 0, saleValue: 0 }
        bySellerMap.set(activity.seller_id, {
          hours: current.hours + (activity.hours_spent || 0),
          sdCost: current.sdCost + (activity.sd_cost || 0),
          travelCost: current.travelCost + (activity.travel_cost || 0),
          saleValue: current.saleValue + (activity.sale_value || 0),
        })
      }
    }

    // Get seller names
    const sellerIds = Array.from(bySellerMap.keys())
    const { data: sellers } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", sellerIds)

    const sellerNameMap = new Map((sellers || []).map(s => [s.id, s.full_name || s.email || "Sem nome"]))

    const bySeller = Array.from(bySellerMap.entries()).map(([sellerId, data]) => ({
      sellerId,
      sellerName: sellerNameMap.get(sellerId) || "Desconhecido",
      hours: data.hours,
      sdCost: data.sdCost,
      travelCost: data.travelCost,
      saleValue: data.saleValue,
    }))

    return {
      data: {
        totalHours,
        totalSDCost,
        totalTravelCost,
        totalSaleValue,
        priorityCount,
        reallocatedCount,
        byActivity,
        bySeller,
      },
      error: null,
    }
  } catch (error) {
    console.error("[v0] getAggregatedMetrics - Error:", error)
    return { data: null, error: "Erro ao calcular métricas agregadas" }
  }
}
