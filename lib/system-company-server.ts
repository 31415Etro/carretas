import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/server"
import {
  DEFAULT_SYSTEM_COMPANY_ID,
  SYSTEM_COMPANY_COOKIE,
  defaultSystemCompany,
  mapSystemCompany,
  type SystemCompany,
} from "@/lib/system-company"

export async function listSystemCompanies(activeOnly = true): Promise<SystemCompany[]> {
  const admin = createAdminClient({ bypassCompanyScope: true })
  let query = admin.from("system_companies").select("*").order("is_default", { ascending: false }).order("name")
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query
  if (error) {
    if (error.message.includes("system_companies")) return [defaultSystemCompany]
    throw error
  }
  const companies = (data || []).map(mapSystemCompany)
  return companies.length ? companies : [defaultSystemCompany]
}

export async function getSelectedSystemCompany(companies?: SystemCompany[]) {
  const available = companies || await listSystemCompanies(true)
  const cookieId = (await cookies()).get(SYSTEM_COMPANY_COOKIE)?.value
  return available.find((company) => company.id === cookieId)
    || available.find((company) => company.isDefault)
    || available.find((company) => company.id === DEFAULT_SYSTEM_COMPANY_ID)
    || available[0]
    || defaultSystemCompany
}
