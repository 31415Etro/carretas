// Leitura completa de nota fiscal para a Contabilidade: cabeçalho, partes, itens com cada imposto (ICMS, IPI, PIS, COFINS),
// totais, transporte, pagamento, cobrança, informações adicionais e TODOS os campos do XML (caminho -> valor). Funções puras.
import { parseInvoiceXml, parseXml } from "./nfe-parser.ts"

type Node = ReturnType<typeof parseXml>

export type TaxGroup = { cst: string; origin: string; baseAmount: number; rate: number; amount: number; extra: Record<string, string> }
export type AccountingItem = {
  number: number; code: string; ean: string; description: string; ncm: string; cest: string; cfop: string; unit: string
  quantity: number; unitPrice: number; total: number; freight: number; insurance: number; discount: number; other: number
  totalTaxes: number; orderNumber: string
  icms: TaxGroup; ipi: TaxGroup; pis: TaxGroup; cofins: TaxGroup; icmsSt: { baseAmount: number; rate: number; amount: number }
  info: string
}
export type AccountingTotals = {
  products: number; icmsBase: number; icms: number; icmsExempt: number; fcp: number; icmsStBase: number; icmsSt: number; fcpSt: number
  freight: number; insurance: number; discount: number; importTax: number; ipi: number; pis: number; cofins: number; other: number
  invoice: number; totalTaxes: number; iss: number; issRetained: number
}
export type AccountingInvoice = {
  kind: string; model: string; accessKey: string; number: string; series: string; issuedAt: string; exitAt: string; nature: string
  operationType: string; purpose: string; destination: string; environment: string; presence: string; finalConsumer: string
  protocol: string; protocolDate: string; protocolStatus: string; protocolStatusText: string
  issuer: Record<string, string>; recipient: Record<string, string>
  items: AccountingItem[]; totals: AccountingTotals
  transport: { mode: string; carrierName: string; carrierDocument: string; plate: string; volumes: string; grossWeight: string; netWeight: string }
  payments: Array<{ method: string; amount: number }>; installments: Array<{ number: string; dueDate: string; amount: number }>
  additionalInfo: string; fiscalInfo: string
  fields: Array<[string, string]>
  warnings: string[]
}

const num = (value: string) => { const n = Number(String(value || "0").replace(",", ".")); return Number.isFinite(n) ? n : 0 }
const money = (value: string) => Math.round(num(value) * 100) / 100
const child = (node: Node | null | undefined, name: string) => node?.children.find((item) => item.name === name) || null
const kids = (node: Node | null | undefined, name: string) => node?.children.filter((item) => item.name === name) || []
function dig(node: Node | null | undefined, path: string): Node | null {
  let current: Node | null | undefined = node
  for (const part of path.split("/")) { current = child(current, part); if (!current) return null }
  return current ?? null
}
const text = (node: Node | null | undefined, path = "") => String((path ? dig(node, path) : node)?.text ?? "").trim()
/** Primeiro descendente com esse nome (busca em largura). */
function deep(node: Node | null | undefined, name: string): Node | null {
  const queue = [...(node?.children || [])]
  while (queue.length) { const current = queue.shift()!; if (current.name === name) return current; queue.push(...current.children) }
  return null
}

/** Todos os campos folha do XML: "NFe/infNFe/det[1]/prod/xProd" -> valor (itens repetidos recebem [n]). */
export function flattenXml(root: Node, limit = 4000): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (node: Node, path: string) => {
    if (out.length >= limit) return
    for (const [key, value] of Object.entries(node.attrs)) out.push([`${path}@${key}`, value])
    if (!node.children.length) { if (node.text.trim()) out.push([path, node.text.trim()]); return }
    const counts = new Map<string, number>()
    for (const item of node.children) counts.set(item.name, (counts.get(item.name) || 0) + 1)
    const seen = new Map<string, number>()
    for (const item of node.children) {
      const index = (seen.get(item.name) || 0) + 1
      seen.set(item.name, index)
      walk(item, `${path}/${item.name}${(counts.get(item.name) || 0) > 1 ? `[${index}]` : ""}`)
    }
  }
  for (const item of root.children) walk(item, item.name)
  return out
}

const emptyGroup = (): TaxGroup => ({ cst: "", origin: "", baseAmount: 0, rate: 0, amount: 0, extra: {} })
/** O grupo de imposto traz um único filho com o regime (ICMS00, ICMSSN101, PISAliq, COFINSNT, IPITrib...). */
function taxGroup(parent: Node | null, kind: "icms" | "ipi" | "pis" | "cofins"): TaxGroup {
  const group = parent?.children[0]
  if (!group) return emptyGroup()
  const t = (name: string) => text(group, name)
  if (kind === "icms") return { cst: t("CST") || t("CSOSN"), origin: t("orig"), baseAmount: money(t("vBC")), rate: num(t("pICMS")), amount: money(t("vICMS")), extra: { modBC: t("modBC"), pRedBC: t("pRedBC"), vICMSDeson: t("vICMSDeson"), motDesICMS: t("motDesICMS"), vFCP: t("vFCP"), pCredSN: t("pCredSN"), vCredICMSSN: t("vCredICMSSN"), vICMSSubstituto: t("vICMSSubstituto") } }
  if (kind === "ipi") {
    const trib = child(parent, "IPITrib")
    return { cst: text(trib || group, "CST"), origin: "", baseAmount: money(text(trib, "vBC")), rate: num(text(trib, "pIPI")), amount: money(text(trib, "vIPI")), extra: { cEnq: text(parent, "cEnq"), clEnq: text(parent, "clEnq") } }
  }
  const rateName = kind === "pis" ? "pPIS" : "pCOFINS", valueName = kind === "pis" ? "vPIS" : "vCOFINS"
  return { cst: t("CST"), origin: "", baseAmount: money(t("vBC")), rate: num(t(rateName)), amount: money(t(valueName)), extra: {} }
}

const emptyTotals = (): AccountingTotals => ({ products: 0, icmsBase: 0, icms: 0, icmsExempt: 0, fcp: 0, icmsStBase: 0, icmsSt: 0, fcpSt: 0, freight: 0, insurance: 0, discount: 0, importTax: 0, ipi: 0, pis: 0, cofins: 0, other: 0, invoice: 0, totalTaxes: 0, iss: 0, issRetained: 0 })

function partyFields(node: Node | null, addressTag: string): Record<string, string> {
  if (!node) return {}
  const address = child(node, addressTag)
  return {
    document: text(node, "CNPJ") || text(node, "CPF") || text(node, "idEstrangeiro"), name: text(node, "xNome"), tradeName: text(node, "xFant"),
    stateRegistration: text(node, "IE"), municipalRegistration: text(node, "IM"), taxRegime: text(node, "CRT"), cnae: text(node, "CNAE"), email: text(node, "email"),
    street: text(address, "xLgr"), number: text(address, "nro"), complement: text(address, "xCpl"), district: text(address, "xBairro"),
    cityCode: text(address, "cMun"), city: text(address, "xMun"), state: text(address, "UF"), zipCode: text(address, "CEP"), country: text(address, "xPais"), phone: text(address, "fone"),
  }
}

export function parseAccountingXml(source: string): AccountingInvoice {
  const base = parseInvoiceXml(source) // valida o tipo de nota e reaproveita a leitura de cabeçalho/partes
  const root = parseXml(source.replace(/^﻿/, ""))
  const fields = flattenXml(root)
  const warnings = [...base.warnings]
  const inf = deep(root, "infNFe")
  if (!inf) {
    // NFS-e: sem itens com imposto por item; guarda cabeçalho, partes, valores e tributos principais
    const sv = deep(root, "Servico") || deep(root, "valores") || root
    const totals = emptyTotals()
    totals.invoice = base.total
    totals.products = money(text(deep(sv, "ValorServicos") || deep(sv, "vServ")))
    totals.iss = money(text(deep(sv, "ValorIss") || deep(sv, "vISSQN")))
    totals.issRetained = money(text(deep(sv, "ValorIssRetido") || deep(sv, "vISSRet")))
    totals.pis = money(text(deep(sv, "ValorPis") || deep(sv, "vPis")))
    totals.cofins = money(text(deep(sv, "ValorCofins") || deep(sv, "vCofins")))
    totals.discount = money(text(deep(sv, "DescontoIncondicionado") || deep(sv, "vDescIncond")))
    warnings.push("NFS-e: os impostos aparecem só no total da nota (sem detalhe por item).")
    const party = (p: typeof base.issuer): Record<string, string> => p ? { document: p.document, name: p.name, tradeName: p.tradeName, stateRegistration: p.stateRegistration, email: p.email, street: p.street, number: p.number, complement: p.complement, district: p.district, city: p.city, state: p.state, zipCode: p.zipCode, phone: p.phone, country: p.country } : {}
    return {
      kind: base.kind, model: "", accessKey: base.accessKey, number: base.number, series: base.series, issuedAt: base.issuedAt, exitAt: "", nature: base.nature,
      operationType: "", purpose: "", destination: "", environment: "", presence: "", finalConsumer: "", protocol: "", protocolDate: "", protocolStatus: "", protocolStatusText: "",
      issuer: party(base.issuer), recipient: party(base.recipient),
      items: base.items.map((item, index) => ({ ...emptyItem(index + 1), code: item.code, description: item.description, quantity: item.quantity || 1, unitPrice: item.unitPrice, total: item.total })),
      totals, transport: emptyTransport(), payments: [], installments: base.installments, additionalInfo: "", fiscalInfo: "", fields, warnings,
    }
  }
  const ide = child(inf, "ide")
  const total = dig(inf, "total/ICMSTot")
  const totals: AccountingTotals = {
    ...emptyTotals(), products: money(text(total, "vProd")), icmsBase: money(text(total, "vBC")), icms: money(text(total, "vICMS")), icmsExempt: money(text(total, "vICMSDeson")),
    fcp: money(text(total, "vFCP")), icmsStBase: money(text(total, "vBCST")), icmsSt: money(text(total, "vST")), fcpSt: money(text(total, "vFCPST")),
    freight: money(text(total, "vFrete")), insurance: money(text(total, "vSeg")), discount: money(text(total, "vDesc")), importTax: money(text(total, "vII")),
    ipi: money(text(total, "vIPI")), pis: money(text(total, "vPIS")), cofins: money(text(total, "vCOFINS")), other: money(text(total, "vOutro")),
    invoice: money(text(total, "vNF")) || base.total, totalTaxes: money(text(total, "vTotTrib")),
  }
  const items: AccountingItem[] = kids(inf, "det").map((det, index) => {
    const prod = child(det, "prod"), tax = child(det, "imposto")
    const icmsNode = child(tax, "ICMS")
    const st = icmsNode?.children[0]
    return {
      number: Number(det.attrs.nItem) || index + 1, code: text(prod, "cProd"), ean: text(prod, "cEAN") === "SEM GTIN" ? "" : text(prod, "cEAN"), description: text(prod, "xProd"),
      ncm: text(prod, "NCM"), cest: text(prod, "CEST"), cfop: text(prod, "CFOP"), unit: text(prod, "uCom"), quantity: num(text(prod, "qCom")), unitPrice: num(text(prod, "vUnCom")),
      total: money(text(prod, "vProd")), freight: money(text(prod, "vFrete")), insurance: money(text(prod, "vSeg")), discount: money(text(prod, "vDesc")), other: money(text(prod, "vOutro")),
      totalTaxes: money(text(tax, "vTotTrib")), orderNumber: text(prod, "xPed"),
      icms: taxGroup(icmsNode, "icms"), ipi: taxGroup(child(tax, "IPI"), "ipi"), pis: taxGroup(child(tax, "PIS"), "pis"), cofins: taxGroup(child(tax, "COFINS"), "cofins"),
      icmsSt: { baseAmount: money(text(st, "vBCST")), rate: num(text(st, "pICMSST")), amount: money(text(st, "vICMSST")) },
      info: text(det, "infAdProd"),
    }
  })
  const transp = child(inf, "transp"), carrier = child(transp, "transporta"), vehicle = child(transp, "veicTransp"), volume = child(transp, "vol")
  const protocol = deep(root, "infProt")
  return {
    kind: base.kind, model: text(ide, "mod"), accessKey: base.accessKey, number: base.number, series: base.series, issuedAt: base.issuedAt,
    exitAt: text(ide, "dhSaiEnt") || text(ide, "dSaiEnt"), nature: base.nature, operationType: text(ide, "tpNF"), purpose: text(ide, "finNFe"), destination: text(ide, "idDest"),
    environment: text(ide, "tpAmb"), presence: text(ide, "indPres"), finalConsumer: text(ide, "indFinal"),
    protocol: text(protocol, "nProt"), protocolDate: text(protocol, "dhRecbto"), protocolStatus: text(protocol, "cStat"), protocolStatusText: text(protocol, "xMotivo"),
    issuer: partyFields(child(inf, "emit"), "enderEmit"), recipient: partyFields(child(inf, "dest"), "enderDest"),
    items, totals,
    transport: { mode: text(transp, "modFrete"), carrierName: text(carrier, "xNome"), carrierDocument: text(carrier, "CNPJ") || text(carrier, "CPF"), plate: text(vehicle, "placa"), volumes: text(volume, "qVol"), grossWeight: text(volume, "pesoB"), netWeight: text(volume, "pesoL") },
    payments: kids(child(inf, "pag"), "detPag").map((pay) => ({ method: text(pay, "tPag"), amount: money(text(pay, "vPag")) })),
    installments: kids(child(inf, "cobr"), "dup").map((dup) => ({ number: text(dup, "nDup"), dueDate: text(dup, "dVenc"), amount: money(text(dup, "vDup")) })),
    additionalInfo: text(inf, "infAdic/infCpl"), fiscalInfo: text(inf, "infAdic/infAdFisco"), fields, warnings,
  }
}

function emptyItem(number: number): AccountingItem {
  return { number, code: "", ean: "", description: "", ncm: "", cest: "", cfop: "", unit: "", quantity: 0, unitPrice: 0, total: 0, freight: 0, insurance: 0, discount: 0, other: 0, totalTaxes: 0, orderNumber: "", icms: emptyGroup(), ipi: emptyGroup(), pis: emptyGroup(), cofins: emptyGroup(), icmsSt: { baseAmount: 0, rate: 0, amount: 0 }, info: "" }
}
const emptyTransport = () => ({ mode: "", carrierName: "", carrierDocument: "", plate: "", volumes: "", grossWeight: "", netWeight: "" })

/** Materiais/produtos comprados: junta as linhas de várias notas pelo código + descrição. */
export function aggregateMaterials(invoices: Array<{ number: string; issuedAt: string; issuerName: string; items: AccountingItem[] }>) {
  const map = new Map<string, { code: string; description: string; ncm: string; unit: string; quantity: number; total: number; icms: number; ipi: number; pis: number; cofins: number; notes: number; suppliers: Set<string> }>()
  for (const invoice of invoices) for (const item of invoice.items) {
    const key = `${item.code}|${item.description.toLowerCase()}`
    const row = map.get(key) || { code: item.code, description: item.description, ncm: item.ncm, unit: item.unit, quantity: 0, total: 0, icms: 0, ipi: 0, pis: 0, cofins: 0, notes: 0, suppliers: new Set<string>() }
    row.quantity += item.quantity; row.total += item.total; row.icms += item.icms.amount; row.ipi += item.ipi.amount; row.pis += item.pis.amount; row.cofins += item.cofins.amount; row.notes += 1
    if (invoice.issuerName) row.suppliers.add(invoice.issuerName)
    map.set(key, row)
  }
  return [...map.values()].map((row) => ({ ...row, suppliers: [...row.suppliers], averagePrice: row.quantity ? row.total / row.quantity : 0 })).sort((a, b) => b.total - a.total)
}
