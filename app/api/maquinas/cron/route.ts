import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { generateDueOrders, machineError } from "@/lib/machines-server"

/** Diário: abre as ordens dos planos preventivos automáticos que venceram (ou estão perto). Protegido por CRON_SECRET, como os demais agendadores. */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const results: Array<Record<string, unknown>> = []
  try {
    for (const company of await listSystemCompanies(true)) {
      results.push({ company: company.name, ...(await generateDueOrders(createAdminClient({ companyId: company.id }))) })
    }
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return machineError(error, "Erro ao gerar as ordens preventivas.")
  }
}
