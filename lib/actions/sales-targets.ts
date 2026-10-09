"use server"

import { createServerClient } from "@/lib/supabase/server"
import type { SalesTarget } from "@/lib/types"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export async function getSalesTargets(year?: number): Promise<SalesTarget[]> {
  const supabase = await createServerClient()

  let query = supabase
    .from("sales_targets")
    .select(`
      *,
      user:profiles!sales_targets_user_id_fkey(full_name, email, role)
    `)
    .order("year", { ascending: false })

  if (year) {
    query = query.eq("year", year)
  }

  const { data, error } = await query

  if (error) {
    console.error("[v0] Error fetching sales targets:", error)
    throw new Error("Failed to fetch sales targets")
  }

  return data as SalesTarget[]
}

export async function getSalesTargetByUserAndYear(userId: string, year: number): Promise<SalesTarget | null> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from("sales_targets")
    .select(`
      *,
      user:profiles!sales_targets_user_id_fkey(full_name, email, role)
    `)
    .eq("user_id", userId)
    .eq("year", year)
    .maybeSingle()

  if (error) {
    console.error("[v0] Error fetching sales target:", error)
    throw new Error("Failed to fetch sales target")
  }

  return data as SalesTarget | null
}

interface CreateSalesTargetInput {
  user_id: string
  year: number
  revenue_jan?: number
  revenue_feb?: number
  revenue_mar?: number
  revenue_apr?: number
  revenue_may?: number
  revenue_jun?: number
  revenue_jul?: number
  revenue_aug?: number
  revenue_sep?: number
  revenue_oct?: number
  revenue_nov?: number
  revenue_dec?: number
  leads_jan?: number
  leads_feb?: number
  leads_mar?: number
  leads_apr?: number
  leads_may?: number
  leads_jun?: number
  leads_jul?: number
  leads_aug?: number
  leads_sep?: number
  leads_oct?: number
  leads_nov?: number
  leads_dec?: number
  deals_jan?: number
  deals_feb?: number
  deals_mar?: number
  deals_apr?: number
  deals_may?: number
  deals_jun?: number
  deals_jul?: number
  deals_aug?: number
  deals_sep?: number
  deals_oct?: number
  deals_nov?: number
  deals_dec?: number
  revenue_target?: number
  leads_target?: number
  closed_deals_target?: number
}

export async function createSalesTarget(input: CreateSalesTargetInput): Promise<SalesTarget> {
  const supabase = await createServerClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    throw new Error("Not authenticated")
  }

  const { data, error } = await supabase
    .from("sales_targets")
    .insert({
      user_id: input.user_id,
      year: input.year,
      revenue_jan: input.revenue_jan,
      revenue_feb: input.revenue_feb,
      revenue_mar: input.revenue_mar,
      revenue_apr: input.revenue_apr,
      revenue_may: input.revenue_may,
      revenue_jun: input.revenue_jun,
      revenue_jul: input.revenue_jul,
      revenue_aug: input.revenue_aug,
      revenue_sep: input.revenue_sep,
      revenue_oct: input.revenue_oct,
      revenue_nov: input.revenue_nov,
      revenue_dec: input.revenue_dec,
      leads_jan: input.leads_jan,
      leads_feb: input.leads_feb,
      leads_mar: input.leads_mar,
      leads_apr: input.leads_apr,
      leads_may: input.leads_may,
      leads_jun: input.leads_jun,
      leads_jul: input.leads_jul,
      leads_aug: input.leads_aug,
      leads_sep: input.leads_sep,
      leads_oct: input.leads_oct,
      leads_nov: input.leads_nov,
      leads_dec: input.leads_dec,
      deals_jan: input.deals_jan,
      deals_feb: input.deals_feb,
      deals_mar: input.deals_mar,
      deals_apr: input.deals_apr,
      deals_may: input.deals_may,
      deals_jun: input.deals_jun,
      deals_jul: input.deals_jul,
      deals_aug: input.deals_aug,
      deals_sep: input.deals_sep,
      deals_oct: input.deals_oct,
      deals_nov: input.deals_nov,
      deals_dec: input.deals_dec,
      revenue_target: input.revenue_target,
      leads_target: input.leads_target,
      closed_deals_target: input.closed_deals_target,
      created_by: userData.user.id,
    })
    .select(`
      *,
      user:profiles!sales_targets_user_id_fkey(full_name, email, role)
    `)
    .single()

  if (error) {
    console.error("[v0] Error creating sales target:", error)
    throw new Error("Failed to create sales target")
  }

  return data as SalesTarget
}

interface UpdateSalesTargetInput {
  id: string
  revenue_jan?: number
  revenue_feb?: number
  revenue_mar?: number
  revenue_apr?: number
  revenue_may?: number
  revenue_jun?: number
  revenue_jul?: number
  revenue_aug?: number
  revenue_sep?: number
  revenue_oct?: number
  revenue_nov?: number
  revenue_dec?: number
  leads_jan?: number
  leads_feb?: number
  leads_mar?: number
  leads_apr?: number
  leads_may?: number
  leads_jun?: number
  leads_jul?: number
  leads_aug?: number
  leads_sep?: number
  leads_oct?: number
  leads_nov?: number
  leads_dec?: number
  deals_jan?: number
  deals_feb?: number
  deals_mar?: number
  deals_apr?: number
  deals_may?: number
  deals_jun?: number
  deals_jul?: number
  deals_aug?: number
  deals_sep?: number
  deals_oct?: number
  deals_nov?: number
  deals_dec?: number
  revenue_target?: number
  leads_target?: number
  closed_deals_target?: number
}

export async function updateSalesTarget(input: UpdateSalesTargetInput): Promise<SalesTarget> {
  const supabase = await createServerClient()

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (input.revenue_jan !== undefined) updateData.revenue_jan = input.revenue_jan
  if (input.revenue_feb !== undefined) updateData.revenue_feb = input.revenue_feb
  if (input.revenue_mar !== undefined) updateData.revenue_mar = input.revenue_mar
  if (input.revenue_apr !== undefined) updateData.revenue_apr = input.revenue_apr
  if (input.revenue_may !== undefined) updateData.revenue_may = input.revenue_may
  if (input.revenue_jun !== undefined) updateData.revenue_jun = input.revenue_jun
  if (input.revenue_jul !== undefined) updateData.revenue_jul = input.revenue_jul
  if (input.revenue_aug !== undefined) updateData.revenue_aug = input.revenue_aug
  if (input.revenue_sep !== undefined) updateData.revenue_sep = input.revenue_sep
  if (input.revenue_oct !== undefined) updateData.revenue_oct = input.revenue_oct
  if (input.revenue_nov !== undefined) updateData.revenue_nov = input.revenue_nov
  if (input.revenue_dec !== undefined) updateData.revenue_dec = input.revenue_dec
  if (input.leads_jan !== undefined) updateData.leads_jan = input.leads_jan
  if (input.leads_feb !== undefined) updateData.leads_feb = input.leads_feb
  if (input.leads_mar !== undefined) updateData.leads_mar = input.leads_mar
  if (input.leads_apr !== undefined) updateData.leads_apr = input.leads_apr
  if (input.leads_may !== undefined) updateData.leads_may = input.leads_may
  if (input.leads_jun !== undefined) updateData.leads_jun = input.leads_jun
  if (input.leads_jul !== undefined) updateData.leads_jul = input.leads_jul
  if (input.leads_aug !== undefined) updateData.leads_aug = input.leads_aug
  if (input.leads_sep !== undefined) updateData.leads_sep = input.leads_sep
  if (input.leads_oct !== undefined) updateData.leads_oct = input.leads_oct
  if (input.leads_nov !== undefined) updateData.leads_nov = input.leads_nov
  if (input.leads_dec !== undefined) updateData.leads_dec = input.leads_dec
  if (input.deals_jan !== undefined) updateData.deals_jan = input.deals_jan
  if (input.deals_feb !== undefined) updateData.deals_feb = input.deals_feb
  if (input.deals_mar !== undefined) updateData.deals_mar = input.deals_mar
  if (input.deals_apr !== undefined) updateData.deals_apr = input.deals_apr
  if (input.deals_may !== undefined) updateData.deals_may = input.deals_may
  if (input.deals_jun !== undefined) updateData.deals_jun = input.deals_jun
  if (input.deals_jul !== undefined) updateData.deals_jul = input.deals_jul
  if (input.deals_aug !== undefined) updateData.deals_aug = input.deals_aug
  if (input.deals_sep !== undefined) updateData.deals_sep = input.deals_sep
  if (input.deals_oct !== undefined) updateData.deals_oct = input.deals_oct
  if (input.deals_nov !== undefined) updateData.deals_nov = input.deals_nov
  if (input.deals_dec !== undefined) updateData.deals_dec = input.deals_dec
  if (input.revenue_target !== undefined) updateData.revenue_target = input.revenue_target
  if (input.leads_target !== undefined) updateData.leads_target = input.leads_target
  if (input.closed_deals_target !== undefined) updateData.closed_deals_target = input.closed_deals_target

  const { data, error } = await supabase
    .from("sales_targets")
    .update(updateData)
    .eq("id", input.id)
    .select(`
      *,
      user:profiles!sales_targets_user_id_fkey(full_name, email, role)
    `)
    .single()

  if (error) {
    console.error("[v0] Error updating sales target:", error)
    throw new Error("Failed to update sales target")
  }

  return data as SalesTarget
}

export async function deleteSalesTarget(id: string): Promise<void> {
  if (!(await isCurrentUserAdmin())) throw new Error("Somente administradores podem excluir registros")
  const supabase = await createServerClient()

  const { error } = await supabase.from("sales_targets").delete().eq("id", id)

  if (error) {
    console.error("[v0] Error deleting sales target:", error)
    throw new Error("Failed to delete sales target")
  }
}
