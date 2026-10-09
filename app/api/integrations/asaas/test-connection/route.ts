import { NextResponse } from "next/server"
import { asaasRequest, getAsaasAccountConfig } from "@/lib/asaas"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  const accounts = await Promise.all((["services", "materials"] as const).map(async (code) => {
    const config = getAsaasAccountConfig(code)
    try {
      await asaasRequest(code, "/finance/balance")
      return { code, label: config.label, environment: config.environment, connected: true, message: "Conexao confirmada." }
    } catch (error) {
      return { code, label: config.label, environment: config.environment, connected: false, message: error instanceof Error ? error.message : "Falha ao conectar ao Asaas." }
    }
  }))
  return NextResponse.json({ accounts }, { headers: { "Cache-Control": "private, no-store" } })
}
