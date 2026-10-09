import { NextResponse } from "next/server"
import { asaasRequest } from "@/lib/asaas"
import { getAsaasAccountRow } from "@/lib/asaas-server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  const admin = createAdminClient()
  const balances = await Promise.all(([
    "services",
    "materials",
  ] as const).map(async (code) => {
    try {
      const [account, payload] = await Promise.all([
        getAsaasAccountRow(code),
        asaasRequest<Record<string, unknown>>(code, "/finance/balance"),
      ])
      const balance = Number(payload.balance || 0)
      const { error } = await admin.from("asaas_balance_snapshots").insert({ account_id: account.id, balance, payload })
      return {
        code,
        label: code === "services" ? "Servicos" : "Materiais",
        balance,
        fetchedAt: new Date().toISOString(),
        warning: error ? "Execute o script 158 para habilitar o historico de saldos." : "",
      }
    } catch (error) {
      return {
        code,
        label: code === "services" ? "Servicos" : "Materiais",
        balance: 0,
        fetchedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Falha ao consultar saldo.",
      }
    }
  }))
  const available = balances.filter((item) => !item.error)
  return NextResponse.json({
    accounts: balances,
    consolidatedBalance: available.reduce((total, item) => total + item.balance, 0),
    partial: available.length !== balances.length,
  })
}
