import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { asaasRequest } from "@/lib/asaas"
import { ensureAsaasCustomer, getAsaasAccountRow } from "@/lib/asaas-server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const body = await request.json()
    if (body.kind !== "service" && body.kind !== "material") throw new Error("Tipo fiscal invalido.")
    const admin = createAdminClient()
    let order: Record<string, any> | null = null
    if (body.serviceOrderId) {
      const { data, error } = await admin.from("service_orders").select("id,order_number,client_id,total_amount,description").eq("id", body.serviceOrderId).maybeSingle()
      if (error) throw error
      if (!data) throw new Error("OS nao encontrada.")
      order = data
    }
    const clientId = String(order?.client_id || body.clientId || "")
    if (!clientId) throw new Error("Selecione o cliente da nota fiscal.")
    const { data: client, error: clientError } = await admin.from("clients").select("*").eq("id", clientId).maybeSingle()
    if (clientError) throw clientError
    if (!client) throw new Error("Cliente nao encontrado.")
    const value = Number(body.value ?? order?.total_amount ?? 0)
    if (!Number.isFinite(value) || value <= 0) throw new Error("Informe um valor fiscal maior que zero.")
    const effectiveDate = String(body.effectiveDate || new Date().toISOString().slice(0, 10))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Informe uma data de emissao valida.")
    const itemCode = String(body.itemCode || "").trim()
    const itemName = String(body.itemName || "").trim()
    if (!itemCode) throw new Error(body.kind === "service" ? "Informe o codigo do servico." : "Informe o codigo do material.")
    const externalReference = `MC:NF:${body.kind}:${client.id}:${order?.id || "AVULSA"}:${randomUUID()}`
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

    if (body.kind === "material") {
      const account = await getAsaasAccountRow("materials")
      const connectorUrl = String(process.env.BASE_ASAAS_NFE_ENDPOINT || "").trim()
      const connectorKey = String(process.env.BASE_ASAAS_NFE_API_KEY || "").trim()
      const connectorPayload = {
        externalReference,
        customer: {
          id: client.id,
          name: client.corporate_name || client.name,
          document: String(client.document || "").replace(/\D/g, ""),
          email: client.email || undefined,
        },
        item: { code: itemCode, name: itemName || body.description || "Material", quantity: Number(body.quantity || 1), unitValue: value / Math.max(1, Number(body.quantity || 1)) },
        value,
        effectiveDate,
        observations: body.observations || undefined,
      }
      let providerResponse: Record<string, any> | null = null
      let providerError = ""
      if (connectorUrl && connectorKey) {
        try {
          const response = await fetch(connectorUrl, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": connectorKey, authorization: `Bearer ${connectorKey}` },
            body: JSON.stringify(connectorPayload),
          })
          providerResponse = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(providerResponse?.error || providerResponse?.message || `Conector NF-e respondeu HTTP ${response.status}.`)
        } catch (error) {
          providerError = error instanceof Error ? error.message : "Falha no conector NF-e."
        }
      }
      const { data, error } = await admin.from("asaas_fiscal_documents").insert({
        account_id: account.id,
        client_id: client.id,
        service_order_id: order?.id || null,
        document_kind: "material",
        provider: "base_nfe",
        external_document_id: providerResponse?.id || providerResponse?.documentId || null,
        external_reference: externalReference,
        status: providerResponse?.status || (providerError ? "ERROR" : connectorUrl && connectorKey ? "PROCESSING" : "AWAITING_BASE_CONFIGURATION"),
        value,
        effective_date: effectiveDate,
        document_number: providerResponse?.number || null,
        pdf_url: providerResponse?.pdfUrl || providerResponse?.pdf_url || providerResponse?.documentUrl || null,
        xml_url: providerResponse?.xmlUrl || providerResponse?.xml_url || null,
        item_code: itemCode,
        item_name: itemName || body.description || "Material",
        payload: providerResponse || connectorPayload,
        error_message: providerError || null,
        created_by: current.user.id,
        requester_ip: forwarded || null,
      }).select("*").single()
      if (error) throw error
      if (providerError) return NextResponse.json({ error: providerError, document: data }, { status: 502 })
      return NextResponse.json({
        document: data,
        queued: !providerResponse,
        message: providerResponse ? "NF-e de material enviada ao provedor." : "NF-e de material colocada na fila; configure o conector Base para autorizar e baixar.",
      }, { status: providerResponse ? 201 : 202 })
    }

    const customerId = await ensureAsaasCustomer("services", client)
    const municipalServiceId = String(body.municipalServiceId || "").trim()
    const invoicePayload = {
      payment: body.paymentId || undefined,
      customer: body.paymentId ? undefined : customerId,
      serviceDescription: body.description || order?.description || itemName || `Servicos para ${client.corporate_name || client.name}`,
      observations: body.observations || "Emissao pelo ERP Carretas.",
      value,
      deductions: Number(body.deductions || 0),
      effectiveDate,
      municipalServiceId: municipalServiceId || undefined,
      municipalServiceCode: municipalServiceId ? undefined : itemCode,
      municipalServiceName: municipalServiceId ? undefined : (itemName || body.description || itemCode),
      taxes: body.taxes || { retainIss: false, iss: 0, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0 },
      externalReference,
    }
    const invoice = await asaasRequest<Record<string, any>>("services", "/invoices", { method: "POST", body: JSON.stringify(invoicePayload) })
    let authorized = invoice
    if (body.authorizeNow !== false && invoice.id) {
      authorized = await asaasRequest<Record<string, any>>("services", `/invoices/${invoice.id}/authorize`, { method: "POST", body: JSON.stringify({}) }).catch(() => invoice)
    }
    const fiscalInvoice = { ...invoice, ...authorized }
    const account = await getAsaasAccountRow("services")
    const { data, error } = await admin.from("asaas_fiscal_documents").insert({
      account_id: account.id,
      client_id: client.id,
      service_order_id: order?.id || null,
      document_kind: "service",
      provider: "asaas_nfse",
      asaas_invoice_id: fiscalInvoice.id,
      external_reference: fiscalInvoice.externalReference || externalReference,
      status: fiscalInvoice.status || "SCHEDULED",
      value,
      effective_date: effectiveDate,
      document_number: fiscalInvoice.number || null,
      validation_code: fiscalInvoice.validationCode || null,
      pdf_url: fiscalInvoice.pdfUrl || null,
      xml_url: fiscalInvoice.xmlUrl || null,
      item_code: itemCode,
      item_name: itemName || invoicePayload.serviceDescription,
      payload: fiscalInvoice,
      created_by: current.user.id,
      requester_ip: forwarded || null,
    }).select("*").single()
    if (error) throw error
    return NextResponse.json({ document: data, asaas: fiscalInvoice }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao emitir nota fiscal." }, { status: 400 })
  }
}
