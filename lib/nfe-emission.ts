// Emissão de NF-e de venda pelo ERP (executada no NFeMail pelo robô do servidor). Funções puras: tipos, validação e montagem do texto dos itens.

export type EmissionStatus = "pendente" | "emitindo" | "emitida" | "erro" | "cancelando" | "cancelada"

export type EmissionRecipient = {
  source: "cliente" | "manual"
  clientId?: string
  personType: "PJ" | "PF" | "PE"
  document: string            // CNPJ/CPF (só números)
  name: string
  stateRegistration: string   // IE
  ieIndicator: "1" | "2" | "9" // 1 contribuinte, 2 isento, 9 não contribuinte
  zip: string
  street: string
  number: string
  complement: string
  district: string
  state: string               // UF (PR, SC...)
  city: string
  email: string
  phone: string
  operationDestination: "1" | "2" | "3" // 1 interna, 2 interestadual, 3 exterior
}

export type EmissionTax = { cst: string; aliquota: string; base: string; valor: string }

export type EmissionItem = {
  code: string
  description: string         // já com "COD (código) CHASSI" quando for carreta
  ncm: string
  quantity: string
  unitPrice: string
  unit: string
  gtin: string                // "SEM GTIN" quando não houver
  cfop: string
  origin: string              // origem da mercadoria (0 = nacional)
  icms: EmissionTax           // CSOSN (Simples) ou CST (regime normal)
  pis: EmissionTax
  cofins: EmissionTax
  ipi: EmissionTax
  vin?: string                // chassi escolhido na Documentação Veicular
  vehicleDocId?: string
  quoteItemId?: string
  additionalInfo?: string
}

export type EmissionPayload = {
  header: { cfop: string; nature: string; purpose: "1" | "2" | "3" | "4"; finalConsumer: "0" | "1"; presence: string; issueDate?: string }
  recipient: EmissionRecipient
  items: EmissionItem[]
  payment: { indicator: "0" | "1"; form: string; value: string; description?: string }
  transport: { mode: string }
  additionalInfo: string
  quoteId?: string
}

export const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "")

/** Número digitado em formato brasileiro ("1.234,56") ou simples ("1234.56"). */
export function parseDecimal(value: unknown): number {
  const text = String(value ?? "").trim().replace(/[^\d,.-]/g, "")
  if (!text) return 0
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

/** Texto no formato que o NFeMail aceita nos campos de valor ("1234,56"). */
export const toPortalNumber = (value: unknown, places = 2) => parseDecimal(value).toFixed(places).replace(".", ",")

export const itemTotal = (item: Pick<EmissionItem, "quantity" | "unitPrice">) => Math.round(parseDecimal(item.quantity) * parseDecimal(item.unitPrice) * 100) / 100
export const payloadTotal = (payload: Pick<EmissionPayload, "items">) => Math.round(payload.items.reduce((sum, item) => sum + itemTotal(item), 0) * 100) / 100

/**
 * Descrição do item de carreta no padrão que a página Chassis reconhece: "<descrição> COD (<código numérico>) <CHASSI>".
 * Se a descrição já traz o chassi, não repete.
 */
export function describeWithChassis(description: string, vin: string, productCode = "") {
  const text = String(description || "").replace(/\s+/g, " ").trim()
  const chassis = String(vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!chassis) return text
  if (text.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(chassis)) return text
  const code = digits(productCode) || "0"
  return `${text}${/COD\s*\(/i.test(text) ? "" : ` COD (${code})`} ${chassis}`.replace(/\s+/g, " ").trim()
}

function validDocument(document: string, type: EmissionRecipient["personType"]) {
  if (type === "PE") return true
  return type === "PJ" ? document.length === 14 : document.length === 11
}

const str = (value: unknown) => String(value ?? "")
const taxOf = (value: Partial<EmissionTax> | undefined): EmissionTax => ({ cst: str(value?.cst), aliquota: str(value?.aliquota), base: str(value?.base), valor: str(value?.valor) })

/** Completa o que veio faltando (campos ausentes viram texto vazio) para validar e gravar sem quebrar. */
export function normalizePayload(input: Partial<EmissionPayload> | undefined): EmissionPayload {
  const source = (input || {}) as Partial<EmissionPayload>
  const r = (source.recipient || {}) as Partial<EmissionRecipient>
  return {
    header: { cfop: str(source.header?.cfop), nature: str(source.header?.nature), purpose: (str(source.header?.purpose) || "1") as "1", finalConsumer: (str(source.header?.finalConsumer) || "0") as "0", presence: str(source.header?.presence), issueDate: source.header?.issueDate ? str(source.header.issueDate) : undefined },
    recipient: { source: r.source === "cliente" ? "cliente" : "manual", clientId: r.clientId ? str(r.clientId) : undefined, personType: (["PJ", "PF", "PE"].includes(str(r.personType)) ? str(r.personType) : "PJ") as "PJ", document: digits(r.document), name: str(r.name), stateRegistration: str(r.stateRegistration), ieIndicator: (["1", "2", "9"].includes(str(r.ieIndicator)) ? str(r.ieIndicator) : "9") as "1", zip: digits(r.zip), street: str(r.street), number: str(r.number), complement: str(r.complement), district: str(r.district), state: str(r.state).toUpperCase(), city: str(r.city), email: str(r.email), phone: digits(r.phone), operationDestination: (["1", "2", "3"].includes(str(r.operationDestination)) ? str(r.operationDestination) : "1") as "1" },
    items: (Array.isArray(source.items) ? source.items : []).map((item) => ({ code: str(item?.code), description: str(item?.description), ncm: digits(item?.ncm), quantity: str(item?.quantity), unitPrice: str(item?.unitPrice), unit: str(item?.unit), gtin: str(item?.gtin) || "SEM GTIN", cfop: str(item?.cfop), origin: str(item?.origin) || "0", icms: taxOf(item?.icms), pis: taxOf(item?.pis), cofins: taxOf(item?.cofins), ipi: taxOf(item?.ipi), vin: item?.vin ? str(item.vin) : undefined, vehicleDocId: item?.vehicleDocId ? str(item.vehicleDocId) : undefined, quoteItemId: item?.quoteItemId ? str(item.quoteItemId) : undefined, additionalInfo: item?.additionalInfo ? str(item.additionalInfo) : undefined })),
    payment: { indicator: (str(source.payment?.indicator) === "1" ? "1" : "0") as "0", form: str(source.payment?.form), value: str(source.payment?.value), description: source.payment?.description ? str(source.payment.description) : undefined },
    transport: { mode: str(source.transport?.mode) || "9" },
    additionalInfo: str(source.additionalInfo),
    quoteId: source.quoteId ? str(source.quoteId) : undefined,
  }
}

/** Erros que impedem a emissão (lista vazia = pode emitir). Mensagens para mostrar ao usuário. */
export function validateEmission(payload: EmissionPayload): string[] {
  const errors: string[] = []
  const recipient = payload.recipient
  if (!payload.header.cfop) errors.push("Informe o CFOP.")
  if (!payload.header.nature.trim()) errors.push("Informe a natureza da operação.")
  if (!recipient.name.trim()) errors.push("Informe o nome/razão social do destinatário.")
  if (!validDocument(digits(recipient.document), recipient.personType)) errors.push(recipient.personType === "PJ" ? "CNPJ do destinatário deve ter 14 dígitos." : "CPF do destinatário deve ter 11 dígitos.")
  if (recipient.personType !== "PE") {
    if (!digits(recipient.zip) || digits(recipient.zip).length !== 8) errors.push("CEP do destinatário deve ter 8 dígitos.")
    if (!recipient.street.trim()) errors.push("Informe o logradouro do destinatário.")
    if (!recipient.number.trim()) errors.push("Informe o número do endereço do destinatário (ou S/N).")
    if (!recipient.district.trim()) errors.push("Informe o bairro do destinatário.")
    if (!recipient.state.trim()) errors.push("Informe a UF do destinatário.")
    if (!recipient.city.trim()) errors.push("Informe a cidade do destinatário.")
  }
  if (recipient.ieIndicator === "1" && !digits(recipient.stateRegistration)) errors.push("Destinatário contribuinte de ICMS precisa da inscrição estadual (ou mude o indicador para isento/não contribuinte).")
  if (!payload.items.length) errors.push("Inclua ao menos um item.")
  payload.items.forEach((item, index) => {
    const label = `Item ${index + 1}`
    if (!item.description.trim()) errors.push(`${label}: informe a descrição.`)
    if (digits(item.ncm).length !== 8) errors.push(`${label}: o NCM deve ter 8 dígitos.`)
    if (parseDecimal(item.quantity) <= 0) errors.push(`${label}: informe a quantidade.`)
    if (parseDecimal(item.unitPrice) <= 0) errors.push(`${label}: informe o valor unitário.`)
    if (!item.unit.trim()) errors.push(`${label}: informe a unidade.`)
    if (!item.icms.cst.trim()) errors.push(`${label}: informe a situação tributária do ICMS (CST/CSOSN).`)
    if (!item.pis.cst.trim()) errors.push(`${label}: informe a situação tributária do PIS.`)
    if (!item.cofins.cst.trim()) errors.push(`${label}: informe a situação tributária da COFINS.`)
  })
  const total = payloadTotal(payload)
  if (total <= 0) errors.push("O valor total da nota deve ser maior que zero.")
  if (!payload.payment.form) errors.push("Informe a forma de pagamento.")
  if (payload.payment.form && Math.abs(parseDecimal(payload.payment.value) - total) > 0.009) errors.push(`O valor do pagamento (${parseDecimal(payload.payment.value).toFixed(2)}) deve ser igual ao total da nota (${total.toFixed(2)}).`)
  return errors
}

export const EMISSION_STATUS_LABEL: Record<EmissionStatus, string> = {
  pendente: "Na fila", emitindo: "Emitindo", emitida: "Emitida", erro: "Erro", cancelando: "Cancelando", cancelada: "Cancelada",
}

/** Motivo de cancelamento exigido pela SEFAZ: de 15 a 255 caracteres. */
export function validateCancelReason(reason: string): string | null {
  const text = String(reason || "").trim()
  if (text.length < 15) return "O motivo do cancelamento deve ter pelo menos 15 caracteres."
  if (text.length > 255) return "O motivo do cancelamento deve ter no máximo 255 caracteres."
  return null
}
