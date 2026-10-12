import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { canAccessReport } from "@/lib/reports"
import { deliverSaved, getSavedRow, reportError, reportUser } from "@/lib/reports-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"

type Params = { params: Promise<{ id: string }> }

/** Envia agora o relatório salvo por e-mail aos usuários autorizados (quem o criou, administrador ou autorizado). */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    const saved = await getSavedRow(context.admin, id)
    const allowed = user.role === "admin" || saved.created_by === user.id || (saved.authorized_user_ids || []).includes(user.id)
    if (!allowed || !canAccessReport(user, saved.module)) return NextResponse.json({ error: "Sem permissão para este relatório." }, { status: 403 })
    const company = await getSelectedSystemCompany()
    const result = await deliverSaved(context.admin, saved, company.tradeName || company.name, "Manual", { id: user.id, name: user.name })
    return NextResponse.json(result)
  } catch (error) {
    const { message, status } = reportError(error, "Erro ao enviar o relatório.")
    return NextResponse.json({ error: message }, { status })
  }
}
