import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/server"
import {
  type AsaasAccountCode,
  asaasRequest,
  paymentStatusToFinancialStatus,
  resourceFromWebhook,
  statementDirection,
} from "@/lib/asaas"

type JsonRecord = Record<string, any>

function isoDate(value: unknown) {
  const text = String(value || "")
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

function numberValue(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function deterministicUuid(namespace: string, value: string) {
  const hash = createHash("sha256").update(`${namespace}:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

export async function getAsaasAccountRow(code: AsaasAccountCode) {
  const admin = createAdminClient()
  const { data, error } = await admin.from("asaas_accounts").select("*").eq("code", code).maybeSingle()
  if (error) throw new Error(`asaas_accounts: ${error.message}`)
  if (!data) throw new Error(`Execute o script 157: conta Asaas '${code}' nao encontrada.`)
  return data
}

export async function ensureAsaasCustomer(code: AsaasAccountCode, client: JsonRecord) {
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const { data: mapping, error: mappingError } = await admin
    .from("asaas_customers")
    .select("asaas_customer_id")
    .eq("account_id", account.id)
    .eq("client_id", client.id)
    .maybeSingle()
  if (mappingError) throw new Error(`asaas_customers: ${mappingError.message}`)
  if (mapping?.asaas_customer_id) return mapping.asaas_customer_id as string

  const existingPage = await asaasRequest<{ data?: JsonRecord[] }>(code, `/customers?externalReference=${encodeURIComponent(client.id)}&limit=1`)
  const existingCustomer = existingPage.data?.[0]
  if (existingCustomer?.id) {
    const { error } = await admin.from("asaas_customers").upsert({
      account_id: account.id,
      client_id: client.id,
      asaas_customer_id: existingCustomer.id,
      snapshot: existingCustomer,
    }, { onConflict: "account_id,client_id" })
    if (error) throw new Error(`asaas_customers: ${error.message}`)
    return String(existingCustomer.id)
  }

  if (!String(client.document || "").replace(/\D/g, "")) {
    throw new Error("O cliente precisa de CPF/CNPJ para ser cadastrado no Asaas.")
  }
  const customer = await asaasRequest<JsonRecord>(code, "/customers", {
    method: "POST",
    body: JSON.stringify({
      name: client.corporate_name || client.name,
      cpfCnpj: String(client.document).replace(/\D/g, ""),
      email: client.email || undefined,
      phone: String(client.phone || "").replace(/\D/g, "") || undefined,
      mobilePhone: String(client.mobile || "").replace(/\D/g, "") || undefined,
      address: client.street || undefined,
      addressNumber: client.number || undefined,
      complement: client.complement || undefined,
      province: client.district || undefined,
      postalCode: String(client.zip_code || "").replace(/\D/g, "") || undefined,
      externalReference: client.id,
    }),
  })
  if (!customer.id) throw new Error("Asaas nao retornou o identificador do cliente.")

  const { error } = await admin.from("asaas_customers").upsert({
    account_id: account.id,
    client_id: client.id,
    asaas_customer_id: customer.id,
    snapshot: customer,
  }, { onConflict: "account_id,client_id" })
  if (error) throw new Error(`asaas_customers: ${error.message}`)
  return String(customer.id)
}

export async function upsertAsaasPayment(code: AsaasAccountCode, payment: JsonRecord, links: JsonRecord = {}) {
  if (!payment.id) throw new Error("Evento de cobranca Asaas sem ID.")
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const row = {
    account_id: account.id,
    asaas_payment_id: String(payment.id),
    asaas_customer_id: payment.customer || null,
    external_reference: payment.externalReference || links.externalReference || null,
    billing_type: payment.billingType || null,
    status: payment.status || "PENDING",
    value: numberValue(payment.value),
    net_value: numberValue(payment.netValue),
    due_date: isoDate(payment.dueDate),
    payment_date: isoDate(payment.paymentDate || payment.clientPaymentDate || payment.confirmedDate),
    invoice_url: payment.invoiceUrl || null,
    bank_slip_url: payment.bankSlipUrl || null,
    pix_payload: links.pix || {},
    payload: payment,
    service_order_id: links.serviceOrderId || undefined,
    client_id: links.clientId || undefined,
    work_id: links.workId || undefined,
    accounts_receivable_id: links.accountsReceivableId || undefined,
  }
  const { data, error } = await admin.from("asaas_payments").upsert(row, { onConflict: "account_id,asaas_payment_id" }).select("*").single()
  if (error) throw new Error(`asaas_payments: ${error.message}`)
  return data
}

async function updateReceivableFromPayment(paymentRow: JsonRecord) {
  const admin = createAdminClient()
  const financialStatus = paymentStatusToFinancialStatus(paymentRow.status)
  const realized = financialStatus === "Realizado"
  const receivableStatus = realized ? "Recebida" : financialStatus === "Vencido" ? "Vencida" : ["Cancelado", "Estornado"].includes(financialStatus) ? "Cancelada" : "Aberta"
  if (!paymentRow.accounts_receivable_id) {
    const receivableId = deterministicUuid(`asaas-payment-receivable-${paymentRow.account_id}`, paymentRow.asaas_payment_id)
    const financialId = deterministicUuid(`asaas-payment-financial-${paymentRow.account_id}`, paymentRow.asaas_payment_id)
    const { data: customerMap } = await admin.from("asaas_customers")
      .select("client_id")
      .eq("account_id", paymentRow.account_id)
      .eq("asaas_customer_id", paymentRow.asaas_customer_id || "")
      .maybeSingle()
    const date = paymentRow.due_date || new Date().toISOString().slice(0, 10)
    const description = paymentRow.payload?.description || `Cobranca Asaas ${paymentRow.asaas_payment_id}`
    const { error: receivableError } = await admin.from("accounts_receivable").upsert({
      id: receivableId,
      client_id: customerMap?.client_id || paymentRow.client_id || null,
      work_id: paymentRow.work_id || null,
      service_order_id: paymentRow.service_order_id || null,
      description,
      competence_date: date,
      due_date: date,
      received_date: realized ? paymentRow.payment_date || date : null,
      expected_amount: numberValue(paymentRow.value),
      received_amount: realized ? numberValue(paymentRow.value) : 0,
      receipt_method: paymentRow.billing_type || "Asaas",
      status: receivableStatus,
      origin: "Asaas",
      notes: "Recebida automaticamente pelo webhook Asaas.",
      asaas_payment_id: paymentRow.id,
      external_reference: paymentRow.external_reference || paymentRow.asaas_payment_id,
    }, { onConflict: "id" })
    if (receivableError) throw new Error(`accounts_receivable: ${receivableError.message}`)
    const { error: transactionError } = await admin.from("financial_transactions").upsert({
      id: financialId,
      type: "entrada",
      description,
      client_id: customerMap?.client_id || paymentRow.client_id || null,
      work_id: paymentRow.work_id || null,
      service_order_id: paymentRow.service_order_id || null,
      competence_date: date,
      due_date: date,
      realized_date: realized ? paymentRow.payment_date || date : null,
      expected_amount: numberValue(paymentRow.value),
      realized_amount: realized ? numberValue(paymentRow.value) : 0,
      payment_method: paymentRow.billing_type || "Asaas",
      status: financialStatus,
      origin: "Asaas",
      notes: `Cobranca ${paymentRow.asaas_payment_id}.`,
      accounts_receivable_id: receivableId,
      asaas_account_id: paymentRow.account_id,
      external_reference: paymentRow.external_reference || paymentRow.asaas_payment_id,
    }, { onConflict: "id" })
    if (transactionError) throw new Error(`financial_transactions: ${transactionError.message}`)
    const { error: paymentError } = await admin.from("asaas_payments").update({ accounts_receivable_id: receivableId }).eq("id", paymentRow.id)
    if (paymentError) throw new Error(`asaas_payments: ${paymentError.message}`)
    paymentRow.accounts_receivable_id = receivableId
  }
  const { error } = await admin.from("accounts_receivable").update({
    status: receivableStatus,
    received_amount: realized ? numberValue(paymentRow.value) : 0,
    received_date: realized ? paymentRow.payment_date || new Date().toISOString().slice(0, 10) : null,
  }).eq("id", paymentRow.accounts_receivable_id)
  if (error) throw new Error(`accounts_receivable: ${error.message}`)

  const { error: transactionError } = await admin.from("financial_transactions").update({
    status: financialStatus,
    realized_amount: realized ? numberValue(paymentRow.value) : 0,
    realized_date: realized ? paymentRow.payment_date || new Date().toISOString().slice(0, 10) : null,
  }).eq("accounts_receivable_id", paymentRow.accounts_receivable_id)
  if (transactionError) throw new Error(`financial_transactions: ${transactionError.message}`)
}

export async function upsertAsaasTransfer(code: AsaasAccountCode, transfer: JsonRecord, links: JsonRecord = {}) {
  if (!transfer.id) throw new Error("Evento de transferencia Asaas sem ID.")
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const { data, error } = await admin.from("asaas_transfers").upsert({
    account_id: account.id,
    asaas_transfer_id: transfer.id,
    external_reference: transfer.externalReference || null,
    status: transfer.status || "PENDING",
    value: numberValue(transfer.value),
    effective_date: isoDate(transfer.effectiveDate || transfer.dateCreated),
    operation_type: transfer.operationType || transfer.type || null,
    receipt_url: transfer.transactionReceiptUrl || null,
    payload: transfer,
    supplier_id: links.supplierId || undefined,
    accounts_payable_id: links.accountsPayableId || undefined,
    idempotency_key: links.idempotencyKey || undefined,
    created_by: links.createdBy || undefined,
    requester_ip: links.requesterIp || undefined,
  }, { onConflict: "account_id,asaas_transfer_id" }).select("*").single()
  if (error) throw new Error(`asaas_transfers: ${error.message}`)
  const transferStatus = String(transfer.status || "PENDING")
  const final = transferStatus === "DONE"
  const cancelled = ["FAILED", "CANCELLED", "CANCELED"].includes(transferStatus)
  const payableId = data.accounts_payable_id || links.accountsPayableId || deterministicUuid(`asaas-transfer-payable-${account.id}`, String(transfer.id))
  const financialId = deterministicUuid(`asaas-transfer-financial-${account.id}`, String(transfer.id))
  const date = isoDate(transfer.effectiveDate || transfer.dateCreated) || new Date().toISOString().slice(0, 10)
  const amount = Math.abs(numberValue(transfer.value))
  const description = links.description || transfer.description || `Transferencia Asaas ${transfer.id}`
  const supplierName = links.supplierName || transfer.name || transfer.bankAccount?.ownerName || "Transferencia Asaas"
  const { error: payableError } = await admin.from("accounts_payable").upsert({
    id: payableId,
    supplier_id: data.supplier_id || links.supplierId || null,
    supplier_name: supplierName,
    description,
    competence_date: date,
    due_date: date,
    payment_date: final ? date : null,
    expected_amount: amount,
    paid_amount: final ? amount : 0,
    payment_method: "Asaas",
    status: final ? "Paga" : cancelled ? "Cancelada" : "Aberta",
    origin: `Asaas - ${code === "services" ? "Servicos" : "Materiais"}`,
    notes: `Transferencia ${transfer.id}. Status: ${transferStatus}.`,
    asaas_transfer_id: data.id,
    external_reference: transfer.externalReference || transfer.id,
  }, { onConflict: "id" })
  if (payableError) throw new Error(`accounts_payable: ${payableError.message}`)
  const { error: financialError } = await admin.from("financial_transactions").upsert({
    id: financialId,
    type: "saida",
    description,
    competence_date: date,
    due_date: date,
    realized_date: final ? date : null,
    expected_amount: amount,
    realized_amount: final ? amount : 0,
    payment_method: "Asaas",
    status: final ? "Realizado" : cancelled ? "Cancelado" : "Previsto",
    origin: `Asaas - ${code === "services" ? "Servicos" : "Materiais"}`,
    notes: `Transferencia ${transfer.id}. Status: ${transferStatus}.`,
    accounts_payable_id: payableId,
    asaas_account_id: account.id,
    external_reference: transfer.externalReference || transfer.id,
  }, { onConflict: "id" })
  if (financialError) throw new Error(`financial_transactions: ${financialError.message}`)
  const { error: transferLinkError } = await admin.from("asaas_transfers").update({ accounts_payable_id: payableId }).eq("id", data.id)
  if (transferLinkError) throw new Error(`asaas_transfers: ${transferLinkError.message}`)
  return data
}

export async function upsertAsaasBillPayment(code: AsaasAccountCode, bill: JsonRecord, links: JsonRecord = {}) {
  if (!bill.id) throw new Error("Pagamento de conta Asaas sem ID.")
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const status = String(bill.status || "PENDING")
  const paid = status === "PAID"
  const cancelled = ["FAILED", "CANCELLED", "CANCELED", "REFUNDED"].includes(status)
  const date = isoDate(bill.paymentDate || bill.scheduleDate || bill.dueDate || bill.dateCreated) || new Date().toISOString().slice(0, 10)
  const amount = Math.abs(numberValue(bill.value || bill.totalValue))
  const description = links.description || bill.description || `Pagamento de conta Asaas ${bill.id}`
  const { data, error } = await admin.from("asaas_bill_payments").upsert({
    account_id: account.id,
    supplier_id: links.supplierId || undefined,
    accounts_payable_id: links.accountsPayableId || undefined,
    asaas_bill_id: String(bill.id),
    idempotency_key: links.idempotencyKey || undefined,
    external_reference: bill.externalReference || links.externalReference || null,
    status,
    value: amount,
    due_date: isoDate(bill.dueDate),
    schedule_date: isoDate(bill.scheduleDate),
    payment_date: paid ? date : null,
    description,
    receipt_url: bill.transactionReceiptUrl || bill.receiptUrl || null,
    payload: bill,
    created_by: links.createdBy || undefined,
    requester_ip: links.requesterIp || undefined,
  }, { onConflict: "account_id,asaas_bill_id" }).select("*").single()
  if (error) throw new Error(`asaas_bill_payments: ${error.message}`)

  const payableId = data.accounts_payable_id || links.accountsPayableId || deterministicUuid(`asaas-bill-payable-${account.id}`, String(bill.id))
  const financialId = deterministicUuid(`asaas-bill-financial-${account.id}`, String(bill.id))
  const supplierName = links.supplierName || bill.supplierName || "Fornecedor Asaas"
  const payablePayload = {
    id: payableId,
    supplier_id: data.supplier_id || links.supplierId || null,
    supplier_name: supplierName,
    description,
    competence_date: date,
    due_date: isoDate(bill.dueDate) || date,
    payment_date: paid ? date : null,
    expected_amount: amount,
    paid_amount: paid ? amount : 0,
    payment_method: "Boleto Asaas",
    status: paid ? "Paga" : cancelled ? "Cancelada" : "Aberta",
    origin: `Asaas - ${code === "services" ? "Servicos" : "Materiais"}`,
    notes: `Pagamento de conta ${bill.id}. Status: ${status}.`,
    asaas_bill_payment_id: data.id,
    external_reference: bill.externalReference || links.externalReference || bill.id,
  }
  const { error: payableError } = links.accountsPayableId
    ? await admin.from("accounts_payable").update(payablePayload).eq("id", payableId)
    : await admin.from("accounts_payable").upsert(payablePayload, { onConflict: "id" })
  if (payableError) throw new Error(`accounts_payable: ${payableError.message}`)
  const { error: financialError } = await admin.from("financial_transactions").upsert({
    id: financialId,
    type: "saida",
    description,
    competence_date: date,
    due_date: isoDate(bill.dueDate) || date,
    realized_date: paid ? date : null,
    expected_amount: amount,
    realized_amount: paid ? amount : 0,
    payment_method: "Boleto Asaas",
    status: paid ? "Realizado" : cancelled ? "Cancelado" : "Previsto",
    origin: `Asaas - ${code === "services" ? "Servicos" : "Materiais"}`,
    notes: `Pagamento de conta ${bill.id}. Status: ${status}.`,
    accounts_payable_id: payableId,
    asaas_account_id: account.id,
    external_reference: bill.externalReference || links.externalReference || bill.id,
  }, { onConflict: "id" })
  if (financialError) throw new Error(`financial_transactions: ${financialError.message}`)
  await admin.from("asaas_bill_payments").update({ accounts_payable_id: payableId }).eq("id", data.id)
  return data
}

async function upsertAsaasInvoice(code: AsaasAccountCode, invoice: JsonRecord) {
  if (!invoice.id) throw new Error("Evento de nota fiscal Asaas sem ID.")
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const row = {
    account_id: account.id,
    document_kind: code === "services" ? "service" : "material",
    provider: code === "services" ? "asaas_nfse" : "base_nfe",
    asaas_invoice_id: invoice.id,
    external_reference: invoice.externalReference || null,
    status: invoice.status || "PENDING",
    value: numberValue(invoice.value),
    effective_date: isoDate(invoice.effectiveDate),
    document_number: invoice.number || null,
    validation_code: invoice.validationCode || null,
    pdf_url: invoice.pdfUrl || null,
    xml_url: invoice.xmlUrl || null,
    payload: invoice,
    error_message: invoice.errors ? JSON.stringify(invoice.errors) : null,
  }
  const { data: existing, error: readError } = await admin.from("asaas_fiscal_documents")
    .select("id")
    .eq("account_id", account.id)
    .eq("asaas_invoice_id", invoice.id)
    .maybeSingle()
  if (readError) throw new Error(`asaas_fiscal_documents: ${readError.message}`)
  const query = existing
    ? admin.from("asaas_fiscal_documents").update(row).eq("id", existing.id)
    : admin.from("asaas_fiscal_documents").insert(row)
  const { error } = await query
  if (error) throw new Error(`asaas_fiscal_documents: ${error.message}`)
}

export async function processAsaasWebhook(code: AsaasAccountCode, payload: JsonRecord) {
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  const eventId = String(payload.id || "")
  const eventType = String(payload.event || "UNKNOWN")
  if (!eventId) throw new Error("Webhook Asaas sem identificador do evento.")
  const resource = resourceFromWebhook(payload)
  const resourceId = String(resource.value.id || "") || null

  const { data: event, error: insertError } = await admin.from("asaas_webhook_events").upsert({
    account_id: account.id,
    event_id: eventId,
    event_type: eventType,
    resource_type: resource.type,
    resource_id: resourceId,
    payload,
  }, { onConflict: "account_id,event_id", ignoreDuplicates: true }).select("id,processed_at").maybeSingle()
  if (insertError) throw new Error(`asaas_webhook_events: ${insertError.message}`)
  if (!event) return { duplicate: true }
  if (event.processed_at) return { duplicate: true }

  try {
    if (resource.type === "payment") {
      const payment = await upsertAsaasPayment(code, resource.value)
      await updateReceivableFromPayment(payment)
    } else if (resource.type === "transfer") {
      await upsertAsaasTransfer(code, resource.value)
    } else if (resource.type === "bill") {
      await upsertAsaasBillPayment(code, resource.value)
    } else if (resource.type === "invoice") {
      await upsertAsaasInvoice(code, resource.value)
    }
    await admin.from("asaas_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("id", event.id)
    await admin.from("asaas_accounts").update({ last_webhook_at: new Date().toISOString() }).eq("id", account.id)
    return { duplicate: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida"
    await admin.from("asaas_webhook_events").update({ processing_error: message }).eq("id", event.id)
    throw error
  }
}

export async function syncAsaasStatement(code: AsaasAccountCode, startDate: string, finishDate: string) {
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(code)
  let offset = 0
  let imported = 0
  while (true) {
    const query = new URLSearchParams({ startDate, finishDate, offset: String(offset), limit: "100" })
    const page = await asaasRequest<{ data?: JsonRecord[]; hasMore?: boolean }>(code, `/financialTransactions?${query}`)
    const items = page.data || []
    for (const item of items) {
      const transactionId = String(item.id || item.transactionId || "")
      if (!transactionId) continue
      const value = numberValue(item.value)
      const statementId = deterministicUuid(`asaas-statement-${account.id}`, transactionId)
      const financialId = deterministicUuid(`asaas-financial-${account.id}`, transactionId)
      const transactionDate = isoDate(item.date || item.transactionDate) || startDate
      const linkedPaymentId = String(item.paymentId || item.payment?.id || "")
      const linkedTransferId = String(item.transferId || item.transfer?.id || "")
      const { error: statementError } = await admin.from("asaas_statement_entries").upsert({
        id: statementId,
        account_id: account.id,
        asaas_transaction_id: transactionId,
        transaction_type: item.type || "UNKNOWN",
        direction: statementDirection(value),
        value: Math.abs(value),
        transaction_date: transactionDate,
        description: item.description || item.type || "Movimento Asaas",
        external_reference: item.externalReference || null,
        payload: item,
      }, { onConflict: "account_id,asaas_transaction_id" })
      if (statementError) throw new Error(`asaas_statement_entries: ${statementError.message}`)

      let alreadyRepresented = false
      if (linkedPaymentId) {
        const { data: knownPayment } = await admin.from("asaas_payments").select("accounts_receivable_id").eq("account_id", account.id).eq("asaas_payment_id", linkedPaymentId).maybeSingle()
        alreadyRepresented = Boolean(knownPayment?.accounts_receivable_id)
      }
      if (!alreadyRepresented && linkedTransferId) {
        const { data: knownTransfer } = await admin.from("asaas_transfers").select("accounts_payable_id").eq("account_id", account.id).eq("asaas_transfer_id", linkedTransferId).maybeSingle()
        alreadyRepresented = Boolean(knownTransfer?.accounts_payable_id)
      }
      const { error: financialError } = alreadyRepresented ? { error: null } : await admin.from("financial_transactions").upsert({
        id: financialId,
        type: value < 0 ? "saida" : "entrada",
        description: item.description || `Asaas ${item.type || "movimento"}`,
        competence_date: transactionDate,
        due_date: transactionDate,
        realized_date: transactionDate,
        expected_amount: Math.abs(value),
        realized_amount: Math.abs(value),
        payment_method: "Asaas",
        status: "Realizado",
        origin: `Asaas - ${code === "services" ? "Servicos" : "Materiais"}`,
        notes: `Importacao automatica do extrato. Tipo: ${item.type || "-"}`,
        asaas_account_id: account.id,
        asaas_statement_entry_id: statementId,
        external_reference: item.externalReference || transactionId,
      }, { onConflict: "id" })
      if (financialError) throw new Error(`financial_transactions: ${financialError.message}`)
      const { error: statementLinkError } = await admin.from("asaas_statement_entries")
        .update({ financial_transaction_id: alreadyRepresented ? null : financialId })
        .eq("id", statementId)
      if (statementLinkError) throw new Error(`asaas_statement_entries: ${statementLinkError.message}`)
      imported += 1
    }
    if (!page.hasMore || items.length < 100) break
    offset += items.length
  }
  await admin.from("asaas_accounts").update({ last_statement_sync_at: new Date().toISOString() }).eq("id", account.id)
  return { imported }
}

export async function createFinancialReceivableForPayment(input: {
  code: AsaasAccountCode
  order?: JsonRecord | null
  client: JsonRecord
  payment: JsonRecord
  amount?: number
  description?: string
  idempotencyKey?: string
  createdBy?: string
  requesterIp?: string
}) {
  const admin = createAdminClient()
  const account = await getAsaasAccountRow(input.code)
  const today = new Date().toISOString().slice(0, 10)
  const receivableId = deterministicUuid(`asaas-payment-receivable-${account.id}`, String(input.payment.id))
  const financialId = deterministicUuid(`asaas-payment-financial-${account.id}`, String(input.payment.id))
  const description = input.description || `${input.code === "services" ? "Servicos" : "Materiais"} - ${input.order?.order_number || input.client.corporate_name || input.client.name}`
  const paymentRow = await upsertAsaasPayment(input.code, input.payment, {
    serviceOrderId: input.order?.id,
    clientId: input.client.id,
    workId: input.order?.work_id,
  })
  if (input.idempotencyKey || input.createdBy || input.requesterIp) {
    const { error: metadataError } = await admin.from("asaas_payments").update({
      idempotency_key: input.idempotencyKey || null,
      created_by: input.createdBy || null,
      requester_ip: input.requesterIp || null,
    }).eq("id", paymentRow.id)
    if (metadataError) throw new Error(`asaas_payments: ${metadataError.message}`)
  }
  const amount = numberValue(input.amount ?? input.payment.totalValue ?? input.payment.value)
  const { error } = await admin.rpc("create_asaas_receivable", {
    p_payment_row_id: paymentRow.id,
    p_receivable_id: receivableId,
    p_transaction_id: financialId,
    p_client_id: input.client.id,
    p_work_id: input.order?.work_id || null,
    p_service_order_id: input.order?.id || null,
    p_description: description,
    p_competence_date: today,
    p_due_date: isoDate(input.payment.dueDate) || today,
    p_amount: amount,
    p_payment_method: input.payment.billingType || "Asaas",
    p_account_id: account.id,
    p_external_reference: input.payment.externalReference || null,
    p_notes: `Cobranca ${input.payment.id} da conta ${input.code}.`,
  })
  if (error) throw new Error(`create_asaas_receivable: ${error.message}`)
  return { payment: paymentRow, accountsReceivableId: receivableId }
}
