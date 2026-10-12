import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { reportError, runScheduled } from "@/lib/reports-server"

/** Envio dos relatórios agendados (todas as empresas). Protegido por CRON_SECRET, como o agendador de contratos. */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const results: Array<Record<string, unknown>> = []
  try {
    for (const company of await listSystemCompanies(true)) {
      const summary = await runScheduled(createAdminClient({ companyId: company.id }), company.tradeName || company.name)
      results.push({ company: company.name, ...summary })
    }
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const { message, status } = reportError(error, "Erro ao enviar os relatórios agendados.")
    return NextResponse.json({ error: message, results }, { status })
  }
}
