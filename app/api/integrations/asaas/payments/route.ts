import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { asaasExternalReference, asaasRequest, isAsaasAccountCode } from "@/lib/asaas"
import { createFinancialReceivableForPayment, ensureAsaasCustomer, getAsaasAccountRow } from "@/lib/asaas-server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const accountsReceivableId = new URL(request.url).searchParams.get("accountsReceivableId")
    if (!accountsReceivableId) throw new Error("Informe a conta a receber.")
    const admin = createAdminClient()
    const { data, error } = await admin.from("asaas_payments")
      .select("id,asaas_payment_id,status,billing_type,value,due_date,invoice_url,bank_slip_url,pix_payload,payload,accounts_receivable_id")
      .eq("accounts_receivable_id", accountsReceivableId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: "Cobranca Asaas nao encontrada para este registro." }, { status: 404 })
    return NextResponse.json({ payment: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar cobranca." }, { status: 400 })
  }
}

export async function POST(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const body = await request.json()
    if (!isAsaasAccountCode(body.account)) throw new Error("Informe a conta services ou materials.")
    const admin = createAdminClient()
    const account = await getAsaasAccountRow(body.account)
    const idempotencyKey = String(body.idempotencyKey || randomUUID()).slice(0, 120)
    const { data: duplicate } = await admin.from("asaas_payments")
      .select("id,asaas_payment_id,status,invoice_url,bank_slip_url,pix_payload,accounts_receivable_id,payload")
      .eq("account_id", account.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()
    if (duplicate) return NextResponse.json({ payment: duplicate, duplicate: true })

    let order: Record<string, any> | null = null
    if (body.serviceOrderId) {
      const { data, error } = await admin.from("service_orders")
        .select("id,order_number,client_id,work_id,total_amount,description")
        .eq("id", body.serviceOrderId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error("OS nao encontrada.")
      order = data
    }
    const clientId = String(order?.client_id || body.clientId || "")
    if (!clientId) throw new Error("Selecione o cliente da cobranca.")
    const { data: client, error: clientError } = await admin.from("clients").select("*").eq("id", clientId).maybeSingle()
    if (clientError) throw clientError
    if (!client) throw new Error("Cliente nao encontrado.")

    if (order) {
      const { data: existing } = await admin.from("asaas_payments")
        .select("id,asaas_payment_id,status,invoice_url,bank_slip_url,accounts_receivable_id,payload")
        .eq("account_id", account.id)
        .eq("service_order_id", order.id)
        .not("status", "in", "(DELETED,CANCELED,REFUNDED)")
        .limit(1)
        .maybeSingle()
      if (existing?.accounts_receivable_id) return NextResponse.json({ error: "Esta OS ja possui cobranca ativa nesta conta.", payment: existing }, { status: 409 })
      if (existing?.payload) {
        const repaired = await createFinancialReceivableForPayment({ code: body.account, order, client, payment: existing.payload })
        return NextResponse.json({ ...repaired, repaired: true })
      }
    }

    const value = Number(body.value ?? order?.total_amount ?? 0)
    if (!Number.isFinite(value) || value <= 0) throw new Error("O valor da cobranca deve ser maior que zero.")
    const dueDate = String(body.dueDate || "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Informe o vencimento no formato AAAA-MM-DD.")
    const customerId = await ensureAsaasCustomer(body.account, client)
    const installmentCount = Math.max(1, Math.min(60, Number(body.installmentCount || 1)))
    const externalReference = order
      ? asaasExternalReference(order.id, body.account)
      : `MC:CLIENT:${client.id}:${body.account}:${idempotencyKey}`
    const description = String(body.description || `${order?.order_number || client.corporate_name || client.name} - ${body.account === "services" ? "Servicos" : "Materiais"}`).slice(0, 500)
    const paymentPayload: Record<string, unknown> = {
      customer: customerId,
      billingType: body.billingType || "UNDEFINED",
      dueDate,
      description,
      externalReference,
    }
    if (installmentCount > 1) {
      paymentPayload.installmentCount = installmentCount
      paymentPayload.totalValue = value
    } else {
      paymentPayload.value = value
    }
    if (Number(body.discountValue || 0) > 0) paymentPayload.discount = { value: Number(body.discountValue), dueDateLimitDays: Number(body.discountDays || 0) }
    if (Number(body.interestValue || 0) > 0) paymentPayload.interest = { value: Number(body.interestValue) }
    if (Number(body.fineValue || 0) > 0) paymentPayload.fine = { value: Number(body.fineValue) }
    const payment = await asaasRequest<Record<string, unknown>>(body.account, "/payments", {
      method: "POST",
      body: JSON.stringify(paymentPayload),
    })
    let pix: Record<string, unknown> | null = null
    let identificationField: Record<string, unknown> | null = null
    if (payment.id && body.billingType === "PIX") {
      pix = await asaasRequest<Record<string, unknown>>(body.account, `/payments/${payment.id}/pixQrCode`).catch(() => null)
    }
    if (payment.id && body.billingType === "BOLETO") {
      identificationField = await asaasRequest<Record<string, unknown>>(body.account, `/payments/${payment.id}/identificationField`).catch(() => null)
    }
    const enrichedPayment = { ...payment, pixQrCode: pix || undefined, identificationField: identificationField || undefined }
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const saved = await createFinancialReceivableForPayment({
      code: body.account,
      order,
      client,
      payment: enrichedPayment,
      amount: value,
      description,
      idempotencyKey,
      createdBy: current.user.id,
      requesterIp: forwarded || undefined,
    })
    return NextResponse.json({ ...saved, payment: { ...enrichedPayment, internalId: saved.payment.id }, idempotencyKey }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao emitir cobranca." }, { status: 400 })
  }
}
