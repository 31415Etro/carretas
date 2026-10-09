import { NextResponse } from "next/server"
import { isAsaasAccountCode } from "@/lib/asaas"
import { syncAsaasStatement } from "@/lib/asaas-server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const body = await request.json()
    const account = String(body.account || "all")
    if (account !== "all" && !isAsaasAccountCode(account)) throw new Error("Conta Asaas invalida.")
    const finishDate = String(body.finishDate || new Date().toISOString().slice(0, 10))
    const startDate = String(body.startDate || `${finishDate.slice(0, 8)}01`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(finishDate)) throw new Error("Periodo invalido.")
    if (isAsaasAccountCode(account)) return NextResponse.json(await syncAsaasStatement(account, startDate, finishDate))

    const accounts = await Promise.allSettled([
      syncAsaasStatement("services", startDate, finishDate),
      syncAsaasStatement("materials", startDate, finishDate),
    ])
    const results = accounts.map((result, index) => ({
      account: index === 0 ? "services" : "materials",
      ...(result.status === "fulfilled"
        ? { success: true, result: result.value }
        : { success: false, error: result.reason instanceof Error ? result.reason.message : "Falha ao sincronizar conta." }),
    }))
    if (results.every((result) => !result.success)) {
      return NextResponse.json({ error: "Nao foi possivel sincronizar nenhuma conta Asaas.", accounts: results }, { status: 400 })
    }
    return NextResponse.json({ success: true, startDate, finishDate, accounts: results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar extrato." }, { status: 400 })
  }
}
