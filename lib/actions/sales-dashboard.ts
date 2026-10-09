"use server"

import { createClient } from "@/lib/supabase/server"

export interface SellerPerformance {
  sellerId: string
  sellerName: string
  meta: number
  realized: number
  achievementPercentage: number
  byStage: {
    sdrKanban: number
    sdr: number
    closer: number
    clientes: number
  }
}

export interface SalesDashboardData {
  totalMeta: number
  totalRealized: number
  achievementPercentage: number
  gap: number
  sellerPerformance: SellerPerformance[]
  byStage: {
    sdrKanban: { count: number; value: number }
    sdr: { count: number; value: number }
    closer: { count: number; value: number }
    clientes: { count: number; value: number }
  }
}

// Map lead status to funnel stage
function getStageFromStatus(status: string): "sdrKanban" | "sdr" | "closer" | "clientes" | null {
  const statusMap: Record<string, "sdrKanban" | "sdr" | "closer" | "clientes"> = {
    // SDR Kanban stages
    "novo": "sdrKanban",
    "em_atendimento": "sdrKanban",
    "tentativa_contato": "sdrKanban",
    "aguardando_retorno": "sdrKanban",
    // SDR stages
    "qualificado": "sdr",
    "reuniao_agendada": "sdr",
    "reuniao_realizada": "sdr",
    // Closer stages
    "proposta_enviada": "closer",
    "negociacao": "closer",
    "follow_up": "closer",
    // Client stages (closed/won)
    "fechado": "clientes",
    "ganho": "clientes",
    "cliente": "clientes",
  }
  return statusMap[status] || null
}

export async function getSalesDashboardData(params: {
  period?: "monthly" | "quarterly" | "yearly" | string
  sellerId?: string
}): Promise<SalesDashboardData | null> {
  try {
    const supabase = await createClient()
    const { period = "monthly", sellerId } = params

    // Calculate date range
    const now = new Date()
    let startDate: Date

    switch (period) {
      case "quarterly":
        startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        break
      case "yearly":
        startDate = new Date(now.getFullYear(), 0, 1)
        break
      default: // monthly
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    // Get all closers (without monthly_target since column doesn't exist yet)
    const { data: closers, error: closersError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "closer")
      .eq("active", true)
      .order("full_name")

    if (closersError) {
      console.error("[v0] Error fetching closers:", closersError)
      return null
    }

    // Filter by sellerId if specified
    let filteredClosers = closers || []
    if (sellerId && sellerId !== "all") {
      filteredClosers = filteredClosers.filter(c => c.id === sellerId)
    }

    // Get leads with deal_value for the period
    let leadsQuery = supabase
      .from("leads")
      .select("id, closer_id, deal_value, status, created_at")
      .not("deal_value", "is", null)
      .gt("deal_value", 0)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", now.toISOString())

    if (sellerId && sellerId !== "all") {
      leadsQuery = leadsQuery.eq("closer_id", sellerId)
    }

    const { data: leads, error: leadsError } = await leadsQuery

    if (leadsError) {
      console.error("[v0] Error fetching leads:", leadsError)
      return null
    }

    // Calculate totals per stage
    const porEstagio = {
      sdrKanban: { count: 0, valor: 0 },
      sdr: { count: 0, valor: 0 },
      closer: { count: 0, valor: 0 },
      clientes: { count: 0, valor: 0 },
    }

    // Aggregate leads by closer and stage
    const closerValues = new Map<string, { total: number; porEstagio: typeof porEstagio }>()

    for (const lead of leads || []) {
      const closerId = lead.closer_id
      const value = lead.deal_value || 0
      const stage = getStageFromStatus(lead.status)

      // Update global stage totals
      if (stage) {
        porEstagio[stage].count++
        porEstagio[stage].valor += value
      }

      // Update per-closer values
      if (closerId) {
        if (!closerValues.has(closerId)) {
          closerValues.set(closerId, {
            total: 0,
            porEstagio: {
              sdrKanban: { count: 0, valor: 0 },
              sdr: { count: 0, valor: 0 },
              closer: { count: 0, valor: 0 },
              clientes: { count: 0, valor: 0 },
            },
          })
        }

        const closerData = closerValues.get(closerId)!
        closerData.total += value

        if (stage) {
          closerData.porEstagio[stage].count++
          closerData.porEstagio[stage].valor += value
        }
      }
    }

    // Build seller performance array
    // Use a default meta of 100000 (R$100k) per closer for demo purposes since monthly_target column doesn't exist
    const DEFAULT_META = 100000 

    const sellerPerformance: SellerPerformance[] = filteredClosers.map((closer) => {
      const closerData = closerValues.get(closer.id)
      const meta = DEFAULT_META // Would use closer.monthly_target when column exists
      const realized = closerData?.total || 0
      const achievementPct = meta > 0 ? Math.round((realized / meta) * 100) : 0

      return {
        sellerId: closer.id,
        sellerName: closer.full_name || closer.email || "Sem nome",
        meta,
        realized,
        achievementPercentage: achievementPct,
        byStage: {
          sdrKanban: closerData?.porEstagio.sdrKanban.valor || 0,
          sdr: closerData?.porEstagio.sdr.valor || 0,
          closer: closerData?.porEstagio.closer.valor || 0,
          clientes: closerData?.porEstagio.clientes.valor || 0,
        },
      }
    })

    // Calculate totals
    const totalMeta = sellerPerformance.reduce((sum, s) => sum + s.meta, 0)
    const totalRealized = sellerPerformance.reduce((sum, s) => sum + s.realized, 0)
    const achievementPercentage = totalMeta > 0 ? Math.round((totalRealized / totalMeta) * 100) : 0
    const gap = totalMeta - totalRealized

    return {
      totalMeta,
      totalRealized,
      achievementPercentage,
      gap,
      sellerPerformance,
      byStage: {
        sdrKanban: { count: porEstagio.sdrKanban.count, value: porEstagio.sdrKanban.valor },
        sdr: { count: porEstagio.sdr.count, value: porEstagio.sdr.valor },
        closer: { count: porEstagio.closer.count, value: porEstagio.closer.valor },
        clientes: { count: porEstagio.clientes.count, value: porEstagio.clientes.valor },
      },
    }
  } catch (error) {
    console.error("[v0] Error in getSalesDashboardData:", error)
    return null
  }
}

export async function getClosersForFilter() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "closer")
      .eq("active", true)
      .order("full_name")

    if (error) {
      console.error("[v0] Error fetching closers for filter:", error)
      return []
    }

    return data?.map((c) => ({
      id: c.id,
      name: c.full_name || c.email || "Sem nome",
    })) || []
  } catch (error) {
    console.error("[v0] Error in getClosersForFilter:", error)
    return []
  }
}
