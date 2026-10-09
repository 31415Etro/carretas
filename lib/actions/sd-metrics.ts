"use server"

import { createClient } from "@/lib/supabase/server"

interface SDMetricsParams {
  period?: number // days
  sellerId?: string
}

interface CloserMetricsInput {
  closerId: string
  month: number
  year: number
  hoursCost?: number
  travelCost?: number
  hoursWorked?: number
  notes?: string
}

// Get all closers from profiles
export async function getClosers() {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("role", "closer")
      .eq("active", true)
      .order("full_name")

    if (error) {
      console.error("[v0] getClosers - Error:", error)
      return { data: [], error: error.message }
    }

    return { data: data || [], error: null }
  } catch (error) {
    console.error("[v0] getClosers - Error:", error)
    return { data: [], error: "Erro ao buscar closers" }
  }
}

// Get or create closer metrics for a specific month/year
export async function getCloserMetrics(closerId: string, month: number, year: number) {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from("sd_closer_metrics")
      .select("*")
      .eq("closer_id", closerId)
      .eq("month", month)
      .eq("year", year)
      .single()

    if (error && error.code !== "PGRST116") { // PGRST116 = no rows found
      console.error("[v0] getCloserMetrics - Error:", error)
      return { data: null, error: error.message }
    }

    return { data: data || null, error: null }
  } catch (error) {
    console.error("[v0] getCloserMetrics - Error:", error)
    return { data: null, error: "Erro ao buscar métricas do closer" }
  }
}

// Save closer metrics
export async function saveCloserMetrics(input: CloserMetricsInput) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { data: null, error: "Usuário não autenticado" }
    }

    // Check if record exists
    const { data: existing } = await supabase
      .from("sd_closer_metrics")
      .select("id")
      .eq("closer_id", input.closerId)
      .eq("month", input.month)
      .eq("year", input.year)
      .single()

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from("sd_closer_metrics")
        .update({
          hours_cost: input.hoursCost || 0,
          travel_cost: input.travelCost || 0,
          hours_worked: input.hoursWorked || 0,
          notes: input.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single()

      if (error) {
        console.error("[v0] saveCloserMetrics - Update error:", error)
        return { data: null, error: error.message }
      }

      return { data, error: null }
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from("sd_closer_metrics")
        .insert({
          closer_id: input.closerId,
          month: input.month,
          year: input.year,
          hours_cost: input.hoursCost || 0,
          travel_cost: input.travelCost || 0,
          hours_worked: input.hoursWorked || 0,
          notes: input.notes || null,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) {
        console.error("[v0] saveCloserMetrics - Insert error:", error)
        return { data: null, error: error.message }
      }

      return { data, error: null }
    }
  } catch (error) {
    console.error("[v0] saveCloserMetrics - Error:", error)
    return { data: null, error: "Erro ao salvar métricas do closer" }
  }
}

// Get all SD metrics with real data from sd_activities table
export async function getSDMetrics(params: SDMetricsParams = {}) {
  try {
    const supabase = await createClient()
    const { period = 30, sellerId } = params

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - period)

    console.log("[v0] getSDMetrics - Fetching real metrics for period:", { startDate, endDate, sellerId })

    // 1. Get all closers
    const { data: closers } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "closer")
      .eq("active", true)
      .order("full_name")

    const closersList = closers || []

    // 2. Get all SD activities for the period
    let activitiesQuery = supabase
      .from("sd_activities")
      .select("*")
      .gte("activity_date", startDate.toISOString().split("T")[0])
      .lte("activity_date", endDate.toISOString().split("T")[0])

    if (sellerId && sellerId !== "all") {
      activitiesQuery = activitiesQuery.eq("seller_id", sellerId)
    }

    const { data: activities } = await activitiesQuery

    const activitiesList = activities || []
    console.log("[v0] getSDMetrics - Found activities:", activitiesList.length)

    // 3. Aggregate costs by seller (closer)
    const costBySeller = new Map<string, { hoursCost: number; travelCost: number }>()
    const hoursBySeller = new Map<string, number>()
    const hoursByProject = new Map<string, number>()
    const activityHours = new Map<string, number>()
    let urgentCount = 0
    let delayedCount = 0
    let reallocatedCount = 0
    const urgentProjects: { projectCode: string; projectName: string; requestDate: string }[] = []

    for (const activity of activitiesList) {
      const sellerId = activity.seller_id
      
      // Costs
      if (sellerId) {
        const current = costBySeller.get(sellerId) || { hoursCost: 0, travelCost: 0 }
        costBySeller.set(sellerId, {
          hoursCost: current.hoursCost + (activity.sd_cost || 0),
          travelCost: current.travelCost + (activity.travel_cost || 0),
        })

        // Hours by seller
        const currentHours = hoursBySeller.get(sellerId) || 0
        hoursBySeller.set(sellerId, currentHours + (activity.hours || 0))
      }

      // Hours by project
      if (activity.project_code) {
        const currentProjectHours = hoursByProject.get(activity.project_code) || 0
        hoursByProject.set(activity.project_code, currentProjectHours + (activity.hours || 0))
      }

      // Hours by activity type
      if (activity.activity_type) {
        const currentActivityHours = activityHours.get(activity.activity_type) || 0
        activityHours.set(activity.activity_type, currentActivityHours + (activity.hours || 0))
      }

      // Priority/Urgent projects
      if (activity.priority) {
        urgentCount++
        if (activity.project_code) {
          const exists = urgentProjects.some(p => p.projectCode === activity.project_code)
          if (!exists) {
            urgentProjects.push({
              projectCode: activity.project_code,
              projectName: activity.client_name || "",
              requestDate: activity.activity_date,
            })
          }
        }
      }

      // Delayed
      if (activity.delay_hours && activity.delay_hours > 0) {
        delayedCount++
      }

      // Reallocated
      if (activity.reallocated) {
        reallocatedCount++
      }
    }

    // 4. Build cost per seller (closer)
    const costPerSeller = closersList.map(closer => ({
      sellerId: closer.id,
      sellerName: closer.full_name || closer.email || "Sem nome",
      hoursCost: costBySeller.get(closer.id)?.hoursCost || 0,
      travelCost: costBySeller.get(closer.id)?.travelCost || 0,
    }))

    // 5. Build hours per seller (closer)
    const hoursPerSeller = closersList.map(closer => ({
      sellerId: closer.id,
      sellerName: closer.full_name || closer.email || "Sem nome",
      hours: hoursBySeller.get(closer.id) || 0,
    }))

    // 6. Hours per project
    const hoursPerProject = Array.from(hoursByProject.entries())
      .slice(0, 20)
      .map(([projectCode, hours]) => ({
        projectId: projectCode,
        projectCode,
        hours,
      }))

    // 7. Get leads that passed through SD and went to closer (projetos liberados)
    const { data: releasedLeads } = await supabase
      .from("leads")
      .select("id, project_code, company, closer_id, deal_value, created_at")
      .not("closer_id", "is", null)
      .not("project_code", "is", null)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .limit(10000)

    const releasedProjectsCount = releasedLeads?.length || 0

    // 8. Calculate value per seller (closer) from released leads
    const valueByCloser = new Map<string, number>()
    for (const lead of releasedLeads || []) {
      if (lead.closer_id) {
        const current = valueByCloser.get(lead.closer_id) || 0
        valueByCloser.set(lead.closer_id, current + (lead.deal_value || 0))
      }
    }

    // Add sale_value from activities
    for (const activity of activitiesList) {
      if (activity.seller_id && activity.sale_value) {
        const current = valueByCloser.get(activity.seller_id) || 0
        valueByCloser.set(activity.seller_id, current + activity.sale_value)
      }
    }

    const valuePerSeller = closersList.map(closer => ({
      sellerId: closer.id,
      sellerName: closer.full_name || closer.email || "Sem nome",
      totalValue: valueByCloser.get(closer.id) || 0,
    }))

    // 9. Time by activity type
    const totalActivityHours = Array.from(activityHours.values()).reduce((sum, h) => sum + h, 0) || 1
    const activityTypes = ["Interna", "Reunião", "Análise de dados", "Layout", "Precificação", "Layout 3D", "Proposta", "Visita"]
    const timeByActivity = activityTypes.map(activity => {
      const hours = activityHours.get(activity) || 0
      return {
        activity,
        hours,
        percentage: Math.round((hours / totalActivityHours) * 100),
      }
    })

    // Filter by seller if specified
    let filteredCostPerSeller = costPerSeller
    let filteredHoursPerSeller = hoursPerSeller
    let filteredValuePerSeller = valuePerSeller

    if (sellerId && sellerId !== "all") {
      filteredCostPerSeller = costPerSeller.filter(s => s.sellerId === sellerId)
      filteredHoursPerSeller = hoursPerSeller.filter(s => s.sellerId === sellerId)
      filteredValuePerSeller = valuePerSeller.filter(s => s.sellerId === sellerId)
    }

    const result = {
      costPerSeller: filteredCostPerSeller,
      hoursPerSeller: filteredHoursPerSeller,
      hoursPerProject,
      urgentProjects,
      releasedProjectsCount,
      delayedProjectsCount: delayedCount,
      reallocatedProjectsCount: reallocatedCount,
      valuePerSeller: filteredValuePerSeller,
      timeByActivity,
    }

    return { data: result, error: null }
  } catch (error) {
    console.error("[v0] getSDMetrics - Error:", error)
    return {
      data: null,
      error: "Erro ao buscar métricas do SD",
    }
  }
}

// Get all closer metrics for a specific month/year
export async function getAllCloserMetrics(month: number, year: number) {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from("sd_closer_metrics")
      .select(`
        *,
        closer:profiles!sd_closer_metrics_closer_id_fkey(id, full_name, email)
      `)
      .eq("month", month)
      .eq("year", year)

    if (error) {
      console.error("[v0] getAllCloserMetrics - Error:", error)
      return { data: [], error: error.message }
    }

    return { data: data || [], error: null }
  } catch (error) {
    console.error("[v0] getAllCloserMetrics - Error:", error)
    return { data: [], error: "Erro ao buscar métricas dos closers" }
  }
}
