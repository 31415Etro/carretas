import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { contractError, runAutomation } from "@/lib/contracts-server"

/**
 * Execução agendada (todas as empresas). Protegida por CRON_SECRET: o agendador envia
 * "Authorization: Bearer <CRON_SECRET>" (a Vercel faz isso sozinha quando CRON_SECRET está definido).
 */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const results: Array<Record<string, unknown>> = []
  try {
    for (const company of await listSystemCompanies(true)) {
      const summary = await runAutomation(createAdminClient({ companyId: company.id }))
      results.push({ company: company.name, ...summary })
    }
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const { message, status } = contractError(error, "Erro na automação de contratos.")
    return NextResponse.json({ error: message, results }, { status })
  }
}
