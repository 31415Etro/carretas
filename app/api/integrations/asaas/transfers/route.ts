import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { asaasRequest, isAsaasAccountCode } from "@/lib/asaas"
import { getAsaasAccountRow, upsertAsaasTransfer } from "@/lib/asaas-server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "")
}

export async function POST(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const body = await request.json()
    if (!isAsaasAccountCode(body.account)) throw new Error("Selecione a conta de servicos ou materiais.")
    if (!body.supplierId) throw new Error("Selecione o fornecedor.")
    const value = Number(body.value || 0)
    if (!Number.isFinite(value) || value <= 0) throw new Error("Informe um valor maior que zero.")
    const admin = createAdminClient()
    const account = await getAsaasAccountRow(body.account)
    const idempotencyKey = String(body.idempotencyKey || randomUUID()).slice(0, 120)
    const { data: duplicate } = await admin.from("asaas_transfers").select("*").eq("account_id", account.id).eq("idempotency_key", idempotencyKey).maybeSingle()
    if (duplicate) return NextResponse.json({ transfer: duplicate, duplicate: true })
    const { data: supplier, error: supplierError } = await admin.from("suppliers").select("*").eq("id", body.supplierId).maybeSingle()
    if (supplierError) throw supplierError
    if (!supplier) throw new Error("Fornecedor nao encontrado.")

    const externalReference = `MC:SUPPLIER:${supplier.id}:${body.account}:${idempotencyKey}`
    const payload: Record<string, unknown> = {
      value,
      description: String(body.description || `Pagamento para ${supplier.name}`).slice(0, 140),
      scheduleDate: body.scheduleDate || undefined,
      externalReference,
    }
    if (body.destinationType === "pix") {
      if (!body.pixAddressKey || !body.pixAddressKeyType) throw new Error("Informe a chave Pix e o tipo da chave.")
      payload.pixAddressKey = body.pixAddressKeyType === "CPF" || body.pixAddressKeyType === "CNPJ" || body.pixAddressKeyType === "PHONE" ? digits(body.pixAddressKey) : String(body.pixAddressKey).trim()
      payload.pixAddressKeyType = body.pixAddressKeyType
      payload.operationType = "PIX"
    } else if (body.destinationType === "bank") {
      if (!body.bankCode || !body.ownerName || !digits(body.ownerDocument) || !body.agency || !body.bankAccount || !body.bankAccountType) {
        throw new Error("Preencha banco, titular, documento, agencia, conta e tipo da conta.")
      }
      payload.operationType = body.operationType || undefined
      payload.bankAccount = {
        bank: { code: digits(body.bankCode) },
        ownerName: String(body.ownerName).trim(),
        cpfCnpj: digits(body.ownerDocument),
        agency: digits(body.agency),
        account: digits(body.bankAccount),
        accountDigit: digits(body.accountDigit),
        bankAccountType: body.bankAccountType,
      }
    } else {
      throw new Error("Selecione Pix ou conta bancaria.")
    }
    const transfer = await asaasRequest<Record<string, unknown>>(body.account, "/transfers", { method: "POST", body: JSON.stringify(payload) })
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const saved = await upsertAsaasTransfer(body.account, { ...transfer, description: payload.description, externalReference }, {
      supplierId: supplier.id,
      supplierName: supplier.name,
      accountsPayableId: body.accountsPayableId || undefined,
      description: payload.description,
      idempotencyKey,
      createdBy: current.user.id,
      requesterIp: forwarded || undefined,
    })
    return NextResponse.json({ transfer: saved, asaas: transfer, idempotencyKey }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao realizar transferencia." }, { status: 400 })
  }
}
