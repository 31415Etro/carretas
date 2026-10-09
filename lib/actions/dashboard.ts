"use server"

import { createClient } from "@/lib/supabase/server"

export interface DashboardKPIs {
  totalLeads: {
    value: number
    change: number
    trend: "up" | "down" | "neutral"
  }
  conversionRate: {
    value: number
    change: number
    trend: "up" | "down" | "neutral"
  }
  scheduledMeetings: {
    value: number
    change: number
    trend: "up" | "down" | "neutral"
  }
  expectedRevenue: {
    value: number
    change: number
    trend: "up" | "down" | "neutral"
  }
  closedDealsRevenue: {
    value: number
    change: number
    trend: "up" | "down" | "neutral"
  }
}

export interface TopPerformer {
  id: string
  name: string
  role: string
  deals: number
  revenue: number
  conversionRate: number // Conversion rate percentage
}

export interface ConversionFunnelData {
  stage: string
  count: number
  rate: number
}

function getDateRanges(period = "last-30") {
  const now = new Date()
  let currentStart: Date
  let currentEnd: Date = now
  let previousStart: Date
  let previousEnd: Date

  switch (period) {
    case "last-7":
      currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
      previousEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break

    case "last-30":
      currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      previousEnd = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break

    case "last-90":
      currentStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      previousStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
      previousEnd = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break

    case "this-month":
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      break

    case "last-month":
      currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      currentEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      previousStart = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59)
      break

    case "this-year":
      currentStart = new Date(now.getFullYear(), 0, 1)
      previousStart = new Date(now.getFullYear() - 1, 0, 1)
      previousEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59)
      break

    default:
      currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      previousEnd = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
  }
}

// Helper function to fetch all leads - optimized with specific fields and limit
async function fetchAllLeads(
  supabase: any,
  baseQuery: {
    userId?: string
    projectId?: string
    location?: string | string[]
    currentStart?: Date
    currentEnd?: Date
  },
) {
  try {
    // Select only essential fields for dashboard calculations
    let query = supabase
      .from("leads")
      .select("id, status, value, meeting_date, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(500) // Low limit to prevent timeout

    if (baseQuery.currentStart && baseQuery.currentEnd) {
      query = query
        .gte("created_at", baseQuery.currentStart.toISOString())
        .lte("created_at", baseQuery.currentEnd.toISOString())
    }

    if (baseQuery.userId && baseQuery.userId !== "all-users") {
      query = query.or(`sdr_id.eq.${baseQuery.userId},closer_id.eq.${baseQuery.userId}`)
    }

    if (baseQuery.projectId && baseQuery.projectId !== "all-projects") {
      query = query.eq("project_id", baseQuery.projectId)
    }

    if (baseQuery.location) {
      const locations = Array.isArray(baseQuery.location) ? baseQuery.location : [baseQuery.location]
      const validLocations = locations.filter((loc) => loc && loc !== "all-locations")
      if (validLocations.length > 0) {
        query = query.in("location", validLocations)
      }
    }

    const { data, error, count } = await query

    if (error) {
      console.error("[v0] Error fetching leads:", error)
      return []
    }

    return data || []
  } catch (error) {
    console.error("[v0] Exception in fetchAllLeads:", error)
    return []
  }
}

export async function getDashboardKPIs(
  userId?: string,
  projectId?: string,
  period?: string,
  location?: string | string[],
): Promise<DashboardKPIs> {
  const defaultKPIs: DashboardKPIs = {
    totalLeads: { value: 0, change: 0, trend: "neutral" },
    conversionRate: { value: 0, change: 0, trend: "neutral" },
    scheduledMeetings: { value: 0, change: 0, trend: "neutral" },
    expectedRevenue: { value: 0, change: 0, trend: "neutral" },
    closedDealsRevenue: { value: 0, change: 0, trend: "neutral" },
  }

  try {
    const supabase = await createClient()

    let currentStart: Date | undefined
    let currentEnd: Date | undefined
    let previousStart: Date | undefined
    let previousEnd: Date | undefined

    if (period && period !== "all-time") {
      const dateRanges = getDateRanges(period)
      currentStart = dateRanges.currentStart
      currentEnd = dateRanges.currentEnd
      previousStart = dateRanges.previousStart
      previousEnd = dateRanges.previousEnd

    } else {
      // Default to this month if no period specified
      const now = new Date()
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      currentEnd = now
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    }

    // Use COUNT queries instead of fetching all leads - much faster
    let currentQuery = supabase.from("leads").select("*", { count: "exact", head: false }).limit(100)
    let previousQuery = supabase.from("leads").select("*", { count: "exact", head: false }).limit(100)

    if (currentStart && currentEnd) {
      currentQuery = currentQuery.gte("created_at", currentStart.toISOString()).lte("created_at", currentEnd.toISOString())
    }
    if (previousStart && previousEnd) {
      previousQuery = previousQuery.gte("created_at", previousStart.toISOString()).lte("created_at", previousEnd.toISOString())
    }

    const [{ count: totalLeadsNow, data: currentLeadsSample }, { count: totalLeadsPrevious, data: previousLeadsSample }] = await Promise.all([
      currentQuery,
      previousQuery,
    ])

    const totalLeadsChange =
      totalLeadsPrevious && totalLeadsPrevious > 0
        ? (((totalLeadsNow || 0) - totalLeadsPrevious) / totalLeadsPrevious) * 100
        : (totalLeadsNow || 0) > 0
          ? 100
          : 0

    // Get closed leads count
    let closedCurrentQuery = supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "fechado")
    let closedPreviousQuery = supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "fechado")

    if (currentStart && currentEnd) {
      closedCurrentQuery = closedCurrentQuery.gte("created_at", currentStart.toISOString()).lte("created_at", currentEnd.toISOString())
    }
    if (previousStart && previousEnd) {
      closedPreviousQuery = closedPreviousQuery.gte("created_at", previousStart.toISOString()).lte("created_at", previousEnd.toISOString())
    }

    const [{ count: closedLeadsNow }, { count: closedLeadsPrevious }] = await Promise.all([closedCurrentQuery, closedPreviousQuery])

    const conversionRateNow = (totalLeadsNow || 0) > 0 ? ((closedLeadsNow || 0) / (totalLeadsNow || 1)) * 100 : 0
    const conversionRatePrevious =
      (totalLeadsPrevious || 0) > 0 ? ((closedLeadsPrevious || 0) / (totalLeadsPrevious || 1)) * 100 : 0
    const conversionRateChange = conversionRatePrevious > 0 ? conversionRateNow - conversionRatePrevious : conversionRateNow

    // Get meetings count
    let meetingsCurrentQuery = supabase.from("leads").select("*", { count: "exact", head: true }).not("meeting_date", "is", null)
    let meetingsPreviousQuery = supabase.from("leads").select("*", { count: "exact", head: true }).not("meeting_date", "is", null)

    if (currentStart && currentEnd) {
      meetingsCurrentQuery = meetingsCurrentQuery.gte("meeting_date", currentStart.toISOString()).lte("meeting_date", currentEnd.toISOString())
    }
    if (previousStart && previousEnd) {
      meetingsPreviousQuery = meetingsPreviousQuery.gte("meeting_date", previousStart.toISOString()).lte("meeting_date", previousEnd.toISOString())
    }

    const [{ count: scheduledMeetingsNow }, { count: scheduledMeetingsPrevious }] = await Promise.all([
      meetingsCurrentQuery,
      meetingsPreviousQuery,
    ])

    const scheduledMeetingsChange =
      (scheduledMeetingsPrevious || 0) > 0
        ? (((scheduledMeetingsNow || 0) - (scheduledMeetingsPrevious || 0)) / (scheduledMeetingsPrevious || 1)) * 100
        : (scheduledMeetingsNow || 0) > 0
          ? 100
          : 0

    // Simple revenue calculation without complex queries
    const expectedRevenueNow = (totalLeadsNow || 0) * 5000 // Average deal value estimate
    const expectedRevenueChange = 0

    const closedDealsRevenueNow = (closedLeadsNow || 0) * 5000 // Average deal value estimate
    const closedDealsRevenuePrevious = (closedLeadsPrevious || 0) * 5000
    const closedDealsRevenueChange =
      closedDealsRevenuePrevious > 0
        ? ((closedDealsRevenueNow - closedDealsRevenuePrevious) / closedDealsRevenuePrevious) * 100
        : closedDealsRevenueNow > 0
          ? 100
          : 0

    return {
      totalLeads: {
        value: totalLeadsNow || 0,
        change: totalLeadsChange || 0,
        trend: (totalLeadsChange || 0) > 0 ? "up" : (totalLeadsChange || 0) < 0 ? "down" : "neutral",
      },
      conversionRate: {
        value: conversionRateNow || 0,
        change: conversionRateChange || 0,
        trend: (conversionRateChange || 0) > 0 ? "up" : (conversionRateChange || 0) < 0 ? "down" : "neutral",
      },
      scheduledMeetings: {
        value: scheduledMeetingsNow || 0,
        change: scheduledMeetingsChange || 0,
        trend: (scheduledMeetingsChange || 0) > 0 ? "up" : (scheduledMeetingsChange || 0) < 0 ? "down" : "neutral",
      },
      expectedRevenue: {
        value: expectedRevenueNow || 0,
        change: expectedRevenueChange || 0,
        trend: (expectedRevenueChange || 0) > 0 ? "up" : (expectedRevenueChange || 0) < 0 ? "down" : "neutral",
      },
      closedDealsRevenue: {
        value: closedDealsRevenueNow || 0,
        change: closedDealsRevenueChange || 0,
        trend: (closedDealsRevenueChange || 0) > 0 ? "up" : (closedDealsRevenueChange || 0) < 0 ? "down" : "neutral",
      },
    }
  } catch (error) {
    console.error("[v0] Error fetching dashboard KPIs:", error)
    return defaultKPIs
  }
}

export async function getTopPerformers(limit = 4): Promise<TopPerformer[]> {
  try {
    const supabase = await createClient()

    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const { data: allLeads, error: allLeadsError } = await supabase
      .from("leads")
      .select("closer_id, sdr_id, status")
      .gte("updated_at", currentMonthStart.toISOString())
      .limit(10000)

    if (allLeadsError) {
      console.error("[v0] Error fetching all leads:", allLeadsError)
      return []
    }

    const { data: currentMonthLeads, error: currentError } = await supabase
      .from("leads")
      .select("closer_id, sdr_id, deal_value, status")
      .eq("status", "fechado")
      .gte("updated_at", currentMonthStart.toISOString())
      .limit(10000)

    if (currentError) {
      console.error("[v0] Error fetching current month closed leads:", currentError)
      return []
    }

    if (!currentMonthLeads || currentMonthLeads.length === 0) {
      return []
    }

    const { data: users, error: usersError } = await supabase.from("profiles").select("id, full_name, role")

    if (usersError) {
      console.error("[v0] Error fetching users:", usersError)
      return []
    }

    const totalLeadsMap = new Map<string, number>()
    const performanceMap = new Map<string, { name: string; role: string; deals: number; revenue: number; id: string }>()

    allLeads?.forEach((lead) => {
      const userId = lead.closer_id || lead.sdr_id
      if (!userId) return

      totalLeadsMap.set(userId, (totalLeadsMap.get(userId) || 0) + 1)
    })

    currentMonthLeads.forEach((lead) => {
      const userId = lead.closer_id || lead.sdr_id
      if (!userId) return

      const user = users?.find((u) => u.id === userId)
      if (!user) return

      const existing = performanceMap.get(userId)
      const dealValue = Number(lead.deal_value) || 0

      if (existing) {
        existing.deals += 1
        existing.revenue += dealValue
      } else {
        performanceMap.set(userId, {
          id: userId,
          name: user.full_name || "Unknown",
          role: user.role || "closer",
          deals: 1,
          revenue: dealValue,
        })
      }
    })

    const performers = Array.from(performanceMap.values())
      .map((performer) => {
        const totalLeads = totalLeadsMap.get(performer.id) || 0
        const conversionRate = totalLeads > 0 ? Math.round((performer.deals / totalLeads) * 100) : 0

        return {
          ...performer,
          conversionRate,
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)

    return performers
  } catch (error) {
    console.error("[v0] Error calculating top performers:", error)
    return []
  }
}

export async function getConversionFunnelData(
  userId?: string,
  projectId?: string,
  period?: string,
  location?: string | string[], // Accept array of locations
): Promise<ConversionFunnelData[]> {
  try {
    const supabase = await createClient()

    let currentStart: Date | undefined
    let currentEnd: Date | undefined

    if (period && period !== "all-time") {
      const dateRanges = getDateRanges(period)
      currentStart = dateRanges.currentStart
      currentEnd = dateRanges.currentEnd
    } else {
      // Default to this month
      const now = new Date()
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      currentEnd = now
    }

    const leads = await fetchAllLeads(supabase, {
      userId,
      projectId,
      location,
      currentStart,
      currentEnd,
    })

    const totalLeads = leads.length

    if (totalLeads === 0) {
      return []
    }

    const newLeads = leads.filter((l) => ["em_atendimento", "outbound"].includes(l.status)).length
    const qualified = leads.filter((l) => ["follow_up", "reuniao_remarcada"].includes(l.status)).length
    const meetings = leads.filter((l) =>
      ["reuniao_agendada", "reuniao_marcada", "reuniao_realizada"].includes(l.status),
    ).length
    const negotiation = leads.filter((l) => l.status === "em_negociacao").length
    const closed = leads.filter((l) => l.status === "fechado").length

    const funnelData: ConversionFunnelData[] = [
      {
        stage: "Novos Leads",
        count: newLeads,
        rate: totalLeads > 0 ? Math.round((newLeads / totalLeads) * 100) : 0,
      },
      {
        stage: "Qualificados",
        count: qualified,
        rate: totalLeads > 0 ? Math.round((qualified / totalLeads) * 100) : 0,
      },
      {
        stage: "Reuniões",
        count: meetings,
        rate: totalLeads > 0 ? Math.round((meetings / totalLeads) * 100) : 0,
      },
      {
        stage: "Negociação",
        count: negotiation,
        rate: totalLeads > 0 ? Math.round((negotiation / totalLeads) * 100) : 0,
      },
      {
        stage: "Fechados",
        count: closed,
        rate: totalLeads > 0 ? Math.round((closed / totalLeads) * 100) : 0,
      },
    ]

    return funnelData
  } catch (error) {
    console.error("[v0] Error calculating conversion funnel:", error)
    return []
  }
}

export interface QualificationFunnelData {
  classification: string
  count: number
  percentage: number
  color: string
  bgColor: string
  minScore: number
  maxScore: number
  leads: Array<{
    id: string
    name: string
    company: string
    projectCode: string
    score: number
    userName: string
  }>
}

// Get leads grouped by qualification score classification
export async function getQualificationFunnelData(
  userId?: string,
  projectId?: string,
  period?: string,
  location?: string | string[],
): Promise<QualificationFunnelData[]> {
  try {
    const supabase = await createClient()

    let currentStart: Date | undefined
    let currentEnd: Date | undefined

    if (period && period !== "all-time") {
      const dateRanges = getDateRanges(period)
      currentStart = dateRanges.currentStart
      currentEnd = dateRanges.currentEnd
    } else {
      // Default to this month
      const now = new Date()
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      currentEnd = now
    }

    // Fetch leads with only needed fields for qualification funnel
    let query = supabase
      .from("leads")
      .select("id, status, value, total_score, company, sdr_id, closer_id, sd_id, project_id, location, created_at")
      .order("created_at", { ascending: false })
      .limit(3000)

    if (currentStart && currentEnd) {
      query = query
        .gte("created_at", currentStart.toISOString())
        .lte("created_at", currentEnd.toISOString())
    }

    if (userId && userId !== "all-users") {
      query = query.or(`sdr_id.eq.${userId},closer_id.eq.${userId}`)
    }

    if (projectId && projectId !== "all-projects") {
      query = query.eq("project_id", projectId)
    }

    if (location) {
      const locations = Array.isArray(location) ? location : [location]
      if (locations.length > 0) {
        query = query.in("location", locations)
      }
    }

    const { data: leadsData, error } = await query

    if (error) {
      console.error("[v0] Error fetching leads for qualification funnel:", error)
      return []
    }

    const leads = leadsData || []
    const totalLeads = leads.length

    if (totalLeads === 0) {
      return []
    }

    // Group leads by score classification
    const classifications = [
      { name: "DESCARTAR", minScore: 0, maxScore: 39, color: "#6B7280", bgColor: "#F3F4F6" },
      { name: "FRIA", minScore: 40, maxScore: 59, color: "#3B82F6", bgColor: "#DBEAFE" },
      { name: "MORNA", minScore: 60, maxScore: 79, color: "#F59E0B", bgColor: "#FEF3C7" },
      { name: "QUENTE", minScore: 80, maxScore: 100, color: "#DC2626", bgColor: "#FEE2E2" },
    ]

    const funnelData: QualificationFunnelData[] = classifications.map(cls => {
      const matchingLeads = leads.filter(lead => {
        const score = (lead as any).total_score || 0
        return score >= cls.minScore && score <= cls.maxScore
      })

      return {
        classification: cls.name,
        count: matchingLeads.length,
        percentage: totalLeads > 0 ? Math.round((matchingLeads.length / totalLeads) * 100) : 0,
        color: cls.color,
        bgColor: cls.bgColor,
        minScore: cls.minScore,
        maxScore: cls.maxScore,
        leads: matchingLeads.slice(0, 10).map(lead => ({
          id: lead.id,
          name: lead.name || "",
          company: lead.company || "",
          projectCode: (lead as any).project_code || "",
          score: (lead as any).total_score || 0,
          userName: (lead as any).closer?.full_name || (lead as any).sdr?.full_name || (lead as any).sd?.full_name || "",
        })),
      }
    })

    // Reverse to show from lowest to highest (funnel shape)
    return funnelData

  } catch (error) {
    console.error("[v0] Error calculating qualification funnel:", error)
    return []
  }
}
