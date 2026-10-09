import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { asaasRequest, isAsaasAccountCode } from "@/lib/asaas"
import { getAsaasAccountRow, upsertAsaasBillPayment } from "@/lib/asaas-server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const body = await request.json()
    if (!isAsaasAccountCode(body.account)) throw new Error("Selecione a conta de servicos ou materiais.")
    if (!body.supplierId) throw new Error("Selecione o fornecedor.")
    const identificationField = String(body.identificationField || "").replace(/\s/g, "")
    if (identificationField.length < 30) throw new Error("Informe a linha digitavel completa do boleto.")
    const admin = createAdminClient()
    const account = await getAsaasAccountRow(body.account)
    const idempotencyKey = String(body.idempotencyKey || randomUUID()).slice(0, 120)
    const { data: duplicate } = await admin.from("asaas_bill_payments").select("*").eq("account_id", account.id).eq("idempotency_key", idempotencyKey).maybeSingle()
    if (duplicate) return NextResponse.json({ bill: duplicate, duplicate: true })
    const { data: supplier, error: supplierError } = await admin.from("suppliers").select("*").eq("id", body.supplierId).maybeSingle()
    if (supplierError) throw supplierError
    if (!supplier) throw new Error("Fornecedor nao encontrado.")
    const externalReference = `MC:BILL:${supplier.id}:${body.account}:${idempotencyKey}`
    const payload = {
      identificationField,
      scheduleDate: body.scheduleDate || undefined,
      description: String(body.description || `Boleto de ${supplier.name}`).slice(0, 140),
      externalReference,
    }
    const bill = await asaasRequest<Record<string, unknown>>(body.account, "/bill", { method: "POST", body: JSON.stringify(payload) })
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const saved = await upsertAsaasBillPayment(body.account, { ...bill, description: payload.description, externalReference }, {
      supplierId: supplier.id,
      supplierName: supplier.name,
      accountsPayableId: body.accountsPayableId || undefined,
      description: payload.description,
      idempotencyKey,
      createdBy: current.user.id,
      requesterIp: forwarded || undefined,
    })
    return NextResponse.json({ bill: saved, asaas: bill, idempotencyKey }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao pagar boleto." }, { status: 400 })
  }
}
