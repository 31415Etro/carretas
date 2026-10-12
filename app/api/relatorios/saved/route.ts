import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { deleteSaved, listSaved, reportError, reportUser, saveReport } from "@/lib/reports-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = reportError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    return NextResponse.json({ saved: await listSaved(context.admin, user) })
  } catch (error) {
    return bad(error, "Erro ao carregar relatórios salvos.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    const { report } = await request.json()
    return NextResponse.json({ saved: await saveReport(context.admin, user, report || {}) })
  } catch (error) {
    return bad(error, "Erro ao salvar o relatório.")
  }
}

export async function DELETE(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user) return NextResponse.json({ error: "Acesso restrito aos relatórios." }, { status: 403 })
    await deleteSaved(context.admin, user, new URL(request.url).searchParams.get("id") || "")
    return NextResponse.json({ ok: true })
  } catch (error) {
    return bad(error, "Erro ao excluir o relatório.")
  }
}
