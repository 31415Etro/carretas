import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

// Helper function to build user filter based on role
async function getUserFilter(supabase: any) {
  const authClient = await createClient()
  const { data: { user: authUser } } = await authClient.auth.getUser()
  
  if (!authUser) return { userIds: null, isAdmin: true }
  
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authUser.id)
    .single()
  
  const userRole = profile?.role || "user"
  
  // Admin vê tudo
  if (userRole === "admin") {
    return { userIds: null, isAdmin: true }
  }
  
  // Gerente vê seus leads + leads da equipe (representantes)
  if (userRole === "manager" || userRole === "gerente") {
    const { data: teamMembers } = await supabase
      .from("profiles")
      .select("id")
      .eq("manager_id", authUser.id)
    
    const allIds = [authUser.id, ...(teamMembers?.map((tm: any) => tm.id) || [])]
    return { userIds: allIds, isAdmin: false }
  }
  
  // Outros roles veem apenas seus próprios leads
  return { userIds: [authUser.id], isAdmin: false }
}

function getDateRanges(period: string) {
  const now = new Date()
  let currentStart: Date
  let currentEnd: Date = now
  let previousStart: Date
  let previousEnd: Date

  switch (period) {
    case "today":
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      previousStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      break
    case "this-week": {
      const dayOfWeek = now.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
      const prevMonday = new Date(currentStart)
      prevMonday.setDate(prevMonday.getDate() - 7)
      previousStart = prevMonday
      previousEnd = new Date(currentStart)
      break
    }
    case "this-month":
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      break
    case "this-quarter": {
      const quarter = Math.floor(now.getMonth() / 3)
      currentStart = new Date(now.getFullYear(), quarter * 3, 1)
      previousStart = new Date(now.getFullYear(), (quarter - 1) * 3, 1)
      previousEnd = new Date(now.getFullYear(), quarter * 3, 0, 23, 59, 59)
      break
    }
    case "this-year":
      currentStart = new Date(now.getFullYear(), 0, 1)
      previousStart = new Date(now.getFullYear() - 1, 0, 1)
      previousEnd = new Date(now.getFullYear(), 0, 0, 23, 59, 59)
      break
    default:
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
  }

  return { currentStart, currentEnd, previousStart, previousEnd }
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const period = searchParams.get("period") || "this-month"
    const { currentStart, currentEnd, previousStart, previousEnd } = getDateRanges(period)

    // Get user filter based on role
    const { userIds, isAdmin } = await getUserFilter(supabase)
    
    // Helper to apply user filter to queries
    // Filtra por created_by OU sdr_id/closer_id/sd_id para cobrir leads antigos sem created_by
    const applyUserFilter = (query: any) => {
      if (isAdmin || !userIds) return query
      const idList = userIds.join(",")
      return query.or(
        `created_by.in.(${idList}),sdr_id.in.(${idList}),closer_id.in.(${idList}),sd_id.in.(${idList})`
      )
    }

    // --- KPIs ---

    // Total de leads: todos os leads do usuário (sem filtro de período)
    const totalLeadsQuery = supabase.from("leads").select("*", { count: "exact", head: true })
    const { count: totalLeadsNow } = await applyUserFilter(totalLeadsQuery)

    // Total de leads do período anterior
    const totalLeadsPrevQuery = supabase.from("leads").select("*", { count: "exact", head: true }).lte("created_at", previousEnd.toISOString())
    const { count: totalLeadsPrevious } = await applyUserFilter(totalLeadsPrevQuery)

    // Leads fechados em todo o histórico
    const closedLeadsNowQuery = supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "fechado")
    const { count: closedLeadsNow } = await applyUserFilter(closedLeadsNowQuery)

    const closedLeadsPrevQuery = supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "fechado").lte("created_at", previousEnd.toISOString())
    const { count: closedLeadsPrevious } = await applyUserFilter(closedLeadsPrevQuery)

    // Reuniões agendadas no período atual
    const meetingsNowQuery = supabase.from("leads").select("*", { count: "exact", head: true }).not("meeting_date", "is", null).gte("meeting_date", currentStart.toISOString()).lte("meeting_date", currentEnd.toISOString())
    const { count: meetingsNow } = await applyUserFilter(meetingsNowQuery)

    const meetingsPrevQuery = supabase.from("leads").select("*", { count: "exact", head: true }).not("meeting_date", "is", null).gte("meeting_date", previousStart.toISOString()).lte("meeting_date", previousEnd.toISOString())
    const { count: meetingsPrev } = await applyUserFilter(meetingsPrevQuery)

    // Valor Total dos Ganhos
    const closedDealsNowQuery = supabase.from("leads").select("deal_value").eq("status", "fechado")
    const { data: closedDealsNowData } = await applyUserFilter(closedDealsNowQuery)

    const closedDealsPrevQuery = supabase.from("leads").select("deal_value").eq("status", "fechado").lte("created_at", previousEnd.toISOString())
    const { data: closedDealsPrevData } = await applyUserFilter(closedDealsPrevQuery)

    const closedRevenueNow = (closedDealsNowData || []).reduce((s: number, l: any) => s + (Number(l.deal_value) || 0), 0)
    const closedRevenuePrev = (closedDealsPrevData || []).reduce((s: number, l: any) => s + (Number(l.deal_value) || 0), 0)

    // Valor Total dos Projetos
    const leadsValueQuery = supabase.from("leads").select("value_parts, value_services, value_maintenance_contracts, value_equipment_sales, value_projects, deal_value")
    const { data: leadsValueData } = await applyUserFilter(leadsValueQuery)

    const expectedRevenue = (leadsValueData || []).reduce((s: number, l: any) => {
      const parts = Number(l.value_parts) || 0
      const services = Number(l.value_services) || 0
      const maintenance = Number(l.value_maintenance_contracts) || 0
      const equipment = Number(l.value_equipment_sales) || 0
      const projects = Number(l.value_projects) || 0
      const deal = Number(l.deal_value) || 0
      const detailed = parts + services + maintenance + equipment + projects
      return s + (detailed > 0 ? detailed : deal)
    }, 0)

    const leadsValuePrevQuery = supabase.from("leads").select("value_parts, value_services, value_maintenance_contracts, value_equipment_sales, value_projects, deal_value").lte("created_at", previousEnd.toISOString())
    const { data: leadsValuePrevData } = await applyUserFilter(leadsValuePrevQuery)

    const expectedRevenuePrev = (leadsValuePrevData || []).reduce((s, l) => {
      const parts = Number(l.value_parts) || 0
      const services = Number(l.value_services) || 0
      const maintenance = Number(l.value_maintenance_contracts) || 0
      const equipment = Number(l.value_equipment_sales) || 0
      const projects = Number(l.value_projects) || 0
      const deal = Number(l.deal_value) || 0
      const detailed = parts + services + maintenance + equipment + projects
      return s + (detailed > 0 ? detailed : deal)
    }, 0)

    const pctChange = (now: number, prev: number) =>
      prev > 0 ? ((now - prev) / prev) * 100 : now > 0 ? 100 : 0
    const trend = (c: number) => (c > 0 ? "up" : c < 0 ? "down" : "neutral")

    const tLC = pctChange(totalLeadsNow || 0, totalLeadsPrevious || 0)
    const convNow = (totalLeadsNow || 0) > 0 ? ((closedLeadsNow || 0) / (totalLeadsNow || 1)) * 100 : 0
    const convPrev = (totalLeadsPrevious || 0) > 0 ? ((closedLeadsPrevious || 0) / (totalLeadsPrevious || 1)) * 100 : 0
    const convC = convPrev > 0 ? convNow - convPrev : convNow
    const mtgC = pctChange(meetingsNow || 0, meetingsPrev || 0)
    const revC = pctChange(closedRevenueNow, closedRevenuePrev)
    const expRevC = pctChange(expectedRevenue, expectedRevenuePrev)

    const kpis = {
      totalLeads: { value: totalLeadsNow || 0, change: tLC, trend: trend(tLC) },
      conversionRate: { value: convNow, change: convC, trend: trend(convC) },
      scheduledMeetings: { value: meetingsNow || 0, change: mtgC, trend: trend(mtgC) },
      expectedRevenue: { value: expectedRevenue, change: expRevC, trend: trend(expRevC) },
      closedDealsRevenue: { value: closedRevenueNow, change: revC, trend: trend(revC) },
    }

    // --- Funil: todos os leads do usuário para mostrar pipeline completo ---
    const funnelQuery = supabase.from("leads").select("status")
    const { data: funnelLeads } = await applyUserFilter(funnelQuery)

    const fl = funnelLeads || []
    const totalFunnel = fl.length
    const newLeads = fl.filter((l) => ["em_atendimento", "outbound"].includes(l.status)).length
    const qualified = fl.filter((l) => ["follow_up", "reuniao_remarcada"].includes(l.status)).length
    const meetings = fl.filter((l) =>
      ["reuniao_agendada", "reuniao_marcada", "reuniao_realizada"].includes(l.status),
    ).length
    const negotiation = fl.filter((l) => l.status === "em_negociacao").length
    const closed = fl.filter((l) => l.status === "fechado").length

    const rate = (n: number) => (totalFunnel > 0 ? Math.round((n / totalFunnel) * 100) : 0)
    const funnelData = [
      { stage: "Novos Leads", count: newLeads, rate: rate(newLeads) },
      { stage: "Qualificados", count: qualified, rate: rate(qualified) },
      { stage: "Reunioes", count: meetings, rate: rate(meetings) },
      { stage: "Negociacao", count: negotiation, rate: rate(negotiation) },
      { stage: "Fechados", count: closed, rate: rate(closed) },
    ]

    // --- Qualification Funnel: leads do usuário com scores ---
    const qualQuery = supabase.from("leads").select("id, name, company, total_score, project_code, sdr_id, closer_id, sd_id").not("total_score", "is", null).order("total_score", { ascending: false }).limit(1000)
    const { data: qualLeads } = await applyUserFilter(qualQuery)

    const ql = qualLeads || []
    
    // Fetch user names for the leads
    const qualificationUserIds = [...new Set(ql.flatMap(l => [l.sdr_id, l.closer_id, l.sd_id].filter(Boolean)))]
    const { data: users } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", qualificationUserIds)
    
    const userMap = new Map(users?.map(u => [u.id, u.full_name]) || [])
    
    // Classify by score ranges
    const aClass = ql.filter((l) => (l.total_score || 0) >= 80)
    const bClass = ql.filter((l) => (l.total_score || 0) >= 60 && (l.total_score || 0) < 80)
    const cClass = ql.filter((l) => (l.total_score || 0) >= 40 && (l.total_score || 0) < 60)
    const dClass = ql.filter((l) => (l.total_score || 0) < 40)

    const mapLead = (l: any) => ({
      id: l.id,
      name: l.name,
      company: l.company,
      score: l.total_score,
      projectCode: l.project_code,
      userName: userMap.get(l.sdr_id) || userMap.get(l.closer_id) || userMap.get(l.sd_id) || null,
    })

    const qualificationData = [
      {
        classification: "A",
        minScore: 80,
        maxScore: 100,
        count: aClass.length,
        percentage: ql.length > 0 ? Math.round((aClass.length / ql.length) * 100) : 0,
        color: "#10b981",
        bgColor: "#d1fae5",
        leads: aClass.slice(0, 20).map(mapLead),
      },
      {
        classification: "B",
        minScore: 60,
        maxScore: 79,
        count: bClass.length,
        percentage: ql.length > 0 ? Math.round((bClass.length / ql.length) * 100) : 0,
        color: "#3b82f6",
        bgColor: "#dbeafe",
        leads: bClass.slice(0, 20).map(mapLead),
      },
      {
        classification: "C",
        minScore: 40,
        maxScore: 59,
        count: cClass.length,
        percentage: ql.length > 0 ? Math.round((cClass.length / ql.length) * 100) : 0,
        color: "#f59e0b",
        bgColor: "#fef3c7",
        leads: cClass.slice(0, 20).map(mapLead),
      },
      {
        classification: "D",
        minScore: 0,
        maxScore: 39,
        count: dClass.length,
        percentage: ql.length > 0 ? Math.round((dClass.length / ql.length) * 100) : 0,
        color: "#ef4444",
        bgColor: "#fee2e2",
        leads: dClass.slice(0, 20).map(mapLead),
      },
    ]

    return NextResponse.json({ kpis, funnelData, qualificationData })
  } catch (error: any) {
    console.error("Dashboard API error:", error?.message || error)
    // Return default data instead of error so the page always renders
    return NextResponse.json({
      kpis: {
        totalLeads: { value: 0, change: 0, trend: "neutral" },
        conversionRate: { value: 0, change: 0, trend: "neutral" },
        scheduledMeetings: { value: 0, change: 0, trend: "neutral" },
        expectedRevenue: { value: 0, change: 0, trend: "neutral" },
        closedDealsRevenue: { value: 0, change: 0, trend: "neutral" },
      },
      funnelData: [],
      qualificationData: [],
    })
  }
}
