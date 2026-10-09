import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { getAsaasAccountRow } from "@/lib/asaas-server"
import { digits, notaAsRequest, recipientDocument, type NotaAsDocumentKind } from "@/lib/notaas"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

function requiredText(value: unknown, message: string) {
  const text = String(value || "").trim()
  if (!text) throw new Error(message)
  return text
}

function recipient(client: Record<string, any>) {
  return {
    ...recipientDocument(client.document),
    nome: requiredText(client.corporate_name || client.name, "O cliente precisa ter nome ou razao social."),
    email: client.email || undefined,
  }
}

export async function POST(request: Request) {
  const current = await currentUserRole()
  if (!current.user || current.role !== "admin") return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  try {
    const body = await request.json()
    const kind: NotaAsDocumentKind = body.kind === "material" ? "material" : "service"
    const admin = createAdminClient()
    let order: Record<string, any> | null = null
    if (body.serviceOrderId) {
      const result = await admin.from("service_orders").select("id,order_number,client_id,total_amount,description").eq("id", body.serviceOrderId).maybeSingle()
      if (result.error) throw result.error
      if (!result.data) throw new Error("OS nao encontrada.")
      order = result.data
    }

    const clientId = String(order?.client_id || body.clientId || "")
    if (!clientId) throw new Error("Selecione o cliente da nota fiscal.")
    const clientResult = await admin.from("clients").select("*").eq("id", clientId).maybeSingle()
    if (clientResult.error) throw clientResult.error
    if (!clientResult.data) throw new Error("Cliente nao encontrado.")
    const client = clientResult.data

    const value = Number(body.value ?? order?.total_amount ?? 0)
    if (!Number.isFinite(value) || value <= 0) throw new Error("Informe um valor fiscal maior que zero.")
    const effectiveDate = requiredText(body.effectiveDate, "Informe a data de emissao.")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Informe uma data de emissao valida.")
    const description = requiredText(body.description || order?.description || body.itemName, "Informe a descricao da nota fiscal.")
    const externalReference = `MC:NOTAAS:${kind}:${client.id}:${order?.id || "AVULSA"}:${randomUUID()}`

    let providerPayload: Record<string, any>
    let endpoint: string
    let itemCode = ""
    let itemName = String(body.itemName || description).trim()

    if (kind === "service") {
      const issRate = Number(body.issRate)
      if (!Number.isFinite(issRate) || issRate < 0 || issRate > 100) throw new Error("Informe uma aliquota de ISS entre 0 e 100.")
      const nationalCode = digits(body.nationalServiceCode)
      const municipalCode = String(body.municipalServiceCode || "").trim()
      itemCode = municipalCode || nationalCode
      providerPayload = {
        tomador: recipient(client),
        servico: {
          descricao: description,
          codigo: nationalCode || undefined,
          codigoServico: municipalCode || undefined,
          informacoesComplementares: String(body.observations || "").trim() || undefined,
        },
        valores: { total: value, aliquotaIss: issRate, issRetido: Boolean(body.issWithheld) },
        competencia: effectiveDate.slice(0, 7),
        referencia: externalReference,
      }
      endpoint = "/emitir"
    } else {
      const ncm = digits(body.ncm)
      const cfop = digits(body.cfop)
      const cityCode = digits(body.cityCode)
      if (ncm.length !== 8) throw new Error("Informe o NCM do produto com 8 digitos.")
      if (cfop.length !== 4) throw new Error("Informe o CFOP com 4 digitos.")
      if (cityCode.length !== 7) throw new Error("Informe o codigo IBGE do municipio do cliente com 7 digitos.")
      const quantity = Number(body.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Informe uma quantidade maior que zero.")
      const address = {
        logradouro: requiredText(client.street, "Cadastre o logradouro do cliente antes de emitir a NF-e."),
        numero: String(client.number || "S/N"),
        complemento: client.complement || undefined,
        bairro: requiredText(client.district, "Cadastre o bairro do cliente antes de emitir a NF-e."),
        codigoMunicipio: Number(cityCode),
        cidade: requiredText(client.city, "Cadastre a cidade do cliente antes de emitir a NF-e."),
        uf: requiredText(client.state, "Cadastre a UF do cliente antes de emitir a NF-e.").toUpperCase(),
        cep: digits(client.zip_code),
      }
      if (address.cep.length !== 8) throw new Error("Cadastre o CEP do cliente com 8 digitos antes de emitir a NF-e.")
      itemCode = String(body.itemCode || "").trim()
      itemName = requiredText(body.itemName || description, "Informe o nome do produto.")
      providerPayload = {
        modelo: 55,
        naturezaOperacao: requiredText(body.operationNature, "Informe a natureza da operacao."),
        dataEmissao: effectiveDate,
        dest: { ...recipient(client), endereco: address, ie: client.state_registration || undefined },
        items: [{
          codigo: itemCode || undefined,
          descricao: itemName,
          ncm,
          cfop,
          unidade: String(body.unit || "UN").trim().toUpperCase(),
          quantidade: quantity,
          valorUnitario: value / quantity,
          valorTotal: value,
        }],
        pagamentos: [{
          tipoPagamento: requiredText(body.paymentType, "Informe a forma de pagamento."),
          valor: value,
          descricaoPagamento: body.paymentType === "99" ? requiredText(body.paymentDescription, "Descreva a forma de pagamento.") : undefined,
        }],
        referencia: externalReference,
        infCpl: String(body.observations || "").trim() || undefined,
      }
      endpoint = "/nfe/emitir"
    }

    const response = await notaAsRequest<Record<string, any>>(kind, endpoint, { method: "POST", body: JSON.stringify(providerPayload) })
    const invoiceId = String(response.invoiceId || response.id || response.invoice?.id || "")
    if (!invoiceId) throw new Error("O NotaAS aceitou a requisicao, mas nao retornou o identificador da nota.")
    const account = await getAsaasAccountRow(kind === "service" ? "services" : "materials")
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const storedProvider = kind === "service" ? "asaas_nfse" : "base_nfe"
    const saved = await admin.from("asaas_fiscal_documents").insert({
      account_id: account.id,
      client_id: client.id,
      service_order_id: order?.id || null,
      document_kind: kind,
      provider: storedProvider,
      external_document_id: invoiceId,
      external_reference: externalReference,
      status: response.status || "queued",
      value,
      effective_date: effectiveDate,
      document_number: response.number || response.numero || null,
      item_code: itemCode || null,
      item_name: itemName,
      payload: { integrationProvider: "notaas", request: providerPayload, response },
      created_by: current.user.id,
      requester_ip: forwarded || null,
    }).select("*").single()
    if (saved.error) throw saved.error

    return NextResponse.json({
      message: "Nota enviada ao NotaAS. A autorizacao fiscal sera processada em segundo plano.",
      document: { ...saved.data, provider: kind === "service" ? "notaas_nfse" : "notaas_nfe" },
    }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao emitir nota fiscal pelo NotaAS." }, { status: 400 })
  }
}
