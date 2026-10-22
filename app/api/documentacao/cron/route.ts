import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { docError, runDocumentationMonitor } from "@/lib/vehicle-documentation-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Acompanhamento dos protocolos no backend (sem ninguém com a página aberta). Protegido por CRON_SECRET, como os demais agendadores. */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const results: Array<Record<string, unknown>> = []
  for (const company of await listSystemCompanies(true)) {
    try {
      results.push({ company: company.name, ...(await runDocumentationMonitor(createAdminClient({ companyId: company.id }))) })
    } catch (error) {
      results.push({ company: company.name, error: docError(error).message })  // uma empresa com falha não impede as outras
    }
  }
  return NextResponse.json({ ok: true, results })
}
