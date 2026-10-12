import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { configError, runNotificationDigest } from "@/lib/config-server"

/** Resumo diário por e-mail de cada empresa (protegido por CRON_SECRET, como os demais agendadores). */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const results: Array<Record<string, unknown>> = []
  try {
    for (const company of await listSystemCompanies(true)) {
      results.push({ company: company.name, ...(await runNotificationDigest(createAdminClient({ companyId: company.id }), company.tradeName || company.name)) })
    }
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const { message, status } = configError(error, "Erro no resumo diário.")
    return NextResponse.json({ error: message, results }, { status })
  }
}
