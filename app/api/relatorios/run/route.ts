import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { executeReport, reportError, reportUser } from "@/lib/reports-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"

/** Executa um relatório respeitando as permissões do usuário. Com exportFormat, registra a exportação. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    const input = await request.json()
    const company = await getSelectedSystemCompany()
    const run = await executeReport(context.admin, user, input, company.tradeName || company.name, input.exportFormat ? "Exportação" : "Manual")
    return NextResponse.json(run)
  } catch (error) {
    const { message, status } = reportError(error, "Erro ao gerar o relatório.")
    return NextResponse.json({ error: message }, { status })
  }
}
