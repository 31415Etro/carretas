import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { canAccessReport, reportModules } from "@/lib/reports"
import { emailConfigured, reportError, reportUser } from "@/lib/reports-server"

/** Módulos que o usuário pode consultar, usuários que podem ser autorizados nos relatórios salvos e estado do envio por e-mail. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const user = await reportUser(context.admin)
    if (!user || !canAccessAny(user)) return NextResponse.json({ error: "Seu perfil não tem acesso aos relatórios." }, { status: 403 })
    const { data } = await context.admin.from("profiles").select("id,email,full_name,role,page_permissions,active").order("full_name")
    return NextResponse.json({
      user: { id: user.id, name: user.name, isAdmin: user.role === "admin" },
      modules: reportModules.filter((item) => canAccessReport(user, item.value)).map((item) => item.value),
      users: (data || []).filter((row) => row.active !== false && row.role !== "client").map((row) => ({ id: row.id, name: row.full_name || row.email, email: row.email, role: row.role, permissions: Array.isArray(row.page_permissions) ? row.page_permissions : [] })),
      emailConfigured: emailConfigured(),
    })
  } catch (error) {
    const { message, status } = reportError(error, "Erro ao carregar os relatórios.")
    return NextResponse.json({ error: message }, { status })
  }
}

const canAccessAny = (user: { role: string; permissions: string[] }) => reportModules.some((item) => canAccessReport(user, item.value))
