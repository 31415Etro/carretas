// Leitura de notas fiscais para o Financeiro: NF-e / NFC-e (XML, modelos 55 e 65), NFS-e (XML ABRASF e padrão
// nacional, na medida do possível) e PDF (DANFE, parcial: chave de acesso + CNPJ/CPF). Funções puras (testáveis).
import { cleanDocument, formatDocument, isValidCnpj, isValidCpf } from "./commercial.ts"

export type InvoiceParty = {
  document: string
  personType: "PF" | "PJ"
  name: string
  tradeName: string
  stateRegistration: string
  icmsIndicator: string
  email: string
  phone: string
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  country: string
}
export type InvoiceItem = { code: string; description: string; ncm: string; cfop: string; unit: string; quantity: number; unitPrice: number; total: number }
export type InvoiceInstallment = { number: string; dueDate: string; amount: number }
export type ParsedInvoice = {
  kind: "NF-e" | "NFC-e" | "NFS-e" | "PDF"
  accessKey: string
  number: string
  series: string
  issuedAt: string
  nature: string
  total: number
  issuer: InvoiceParty | null
  recipient: InvoiceParty | null
  items: InvoiceItem[]
  installments: InvoiceInstallment[]
  warnings: string[]
  /** Leitura de foto/PDF: o total veio do campo VALOR TOTAL (e nao da soma das parcelas). */
  totalFromLabel?: boolean
  /** Só NF-e (XML): finalidade (finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução), tipo (tpNF: 0 entrada, 1 saída) e forma de pagamento (tPag; 90 = sem pagamento). */
  purpose?: string
  direction?: string
  payment?: string
}
export type MyRole = "remetente" | "destinatario"

// ---------------- XML mínimo (sem dependências): tags, atributos, texto e CDATA; prefixos de namespace ignorados

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const decodeEntities = (value: string) => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/g, "&")

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" }
  const stack: XmlNode[] = [root]
  const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const top = stack[stack.length - 1]
    if (match[1] !== undefined) top.text += match[1]
    else if (match[2] !== undefined) { if (stack.length > 1) stack.pop() }
    else if (match[3] !== undefined) {
      const attrs: Record<string, string> = {}
      for (const attr of match[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[attr[1].replace(/^.*:/, "")] = decodeEntities(attr[2] ?? attr[3] ?? "")
      const node: XmlNode = { name: match[3].replace(/^.*:/, ""), attrs, children: [], text: "" }
      top.children.push(node)
      if (!match[5]) stack.push(node)
    } else if (match[6] !== undefined) top.text += decodeEntities(match[6])
  }
  return root
}

/** Primeiro descendente (busca em largura) cujo caminho de nomes bate; "A/B" exige B dentro de A. Nomes exatos (NF-e e NFS-e diferem só na caixa: infNFe/infNFSe/InfNfse). */
function find(node: XmlNode | null | undefined, path: string): XmlNode | null {
  if (!node) return null
  const [head, ...rest] = path.split("/")
  const queue = [...node.children]
  while (queue.length) {
    const current = queue.shift()!
    if (current.name === head) {
      if (!rest.length) return current
      const inner = find(current, rest.join("/"))
      if (inner) return inner
    }
    queue.push(...current.children)
  }
  return null
}
const direct = (node: XmlNode | null | undefined, name: string) => node?.children.find((child) => child.name === name) || null
const all = (node: XmlNode | null | undefined, name: string) => node?.children.filter((child) => child.name === name) || []
const val = (node: XmlNode | null | undefined, path = ""): string => String((path ? find(node, path) : node)?.text ?? "").trim()
const first = (...values: string[]) => values.find((value) => value) || ""
const num = (value: string) => { const n = Number(String(value || "0").replace(",", ".")); return Number.isFinite(n) ? n : 0 }
const money = (value: string) => Math.round(num(value) * 100) / 100

const formatZip = (value: string) => { const digits = value.replace(/\D/g, ""); return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits }
function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+/, "").replace(/^55(?=\d{10,11}$)/, "")
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return digits
}

const emptyParty = (): InvoiceParty => ({ document: "", personType: "PJ", name: "", tradeName: "", stateRegistration: "", icmsIndicator: "9", email: "", phone: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", country: "Brasil" })

function partyFromDocument(document: string, base: Partial<InvoiceParty>): InvoiceParty {
  const clean = cleanDocument(document)
  return { ...emptyParty(), ...base, document: clean ? formatDocument(clean) : "", personType: clean.length === 11 && /^\d+$/.test(clean) ? "PF" : "PJ" }
}

function nfeParty(node: XmlNode | null, addressTag: string): InvoiceParty | null {
  if (!node) return null
  const address = direct(node, addressTag)
  const document = first(val(direct(node, "CNPJ")), val(direct(node, "CPF")))
  const indicator = val(node, "indIEDest")
  return partyFromDocument(document, {
    name: val(direct(node, "xNome")),
    tradeName: val(direct(node, "xFant")),
    stateRegistration: /^isento$/i.test(val(direct(node, "IE"))) ? "" : val(direct(node, "IE")),
    icmsIndicator: indicator === "1" || indicator === "2" ? indicator : val(direct(node, "IE")) && !/^isento$/i.test(val(direct(node, "IE"))) ? "1" : "9",
    email: val(direct(node, "email")).toLowerCase(),
    phone: formatPhone(val(address, "fone")),
    zipCode: formatZip(val(address, "CEP")),
    street: val(address, "xLgr"), number: val(address, "nro"), complement: val(address, "xCpl"), district: val(address, "xBairro"),
    city: val(address, "xMun"), state: val(address, "UF").toUpperCase(), country: first(val(address, "xPais"), "Brasil"),
  })
}

function parseNfe(root: XmlNode): ParsedInvoice {
  const inf = find(root, "infNFe")!
  const ide = direct(inf, "ide")
  const model = val(ide, "mod")
  const accessKey = first(val(root, "protNFe/infProt/chNFe"), (inf.attrs.Id || "").replace(/^NFe/i, "")).replace(/\D/g, "")
  const warnings: string[] = []
  const recipient = nfeParty(direct(inf, "dest"), "enderDest")
  if (recipient && !recipient.document) { warnings.push("Destinatário sem CNPJ/CPF (estrangeiro ou consumidor não identificado)."); }
  const items: InvoiceItem[] = all(inf, "det").map((det) => {
    const prod = direct(det, "prod")
    return { code: val(prod, "cProd"), description: val(prod, "xProd"), ncm: val(prod, "NCM"), cfop: val(prod, "CFOP"), unit: val(prod, "uCom"), quantity: num(val(prod, "qCom")), unitPrice: num(val(prod, "vUnCom")), total: money(val(prod, "vProd")) }
  })
  const installments: InvoiceInstallment[] = all(find(inf, "cobr"), "dup").map((dup) => ({ number: val(dup, "nDup"), dueDate: val(dup, "dVenc"), amount: money(val(dup, "vDup")) }))
  return {
    kind: model === "65" ? "NFC-e" : "NF-e",
    accessKey,
    number: val(ide, "nNF"),
    series: val(ide, "serie"),
    issuedAt: first(val(ide, "dhEmi"), val(ide, "dEmi")),
    nature: val(ide, "natOp"),
    total: money(first(val(inf, "total/ICMSTot/vNF"), val(inf, "total/vNF"))),
    issuer: nfeParty(direct(inf, "emit"), "enderEmit"),
    recipient,
    items,
    installments,
    warnings,
    purpose: val(ide, "finNFe"),
    direction: val(ide, "tpNF"),
    payment: val(find(inf, "pag"), "detPag/tPag"),
  }
}

function abrasfParty(node: XmlNode | null, ident: XmlNode | null, tag: "prestador" | "tomador"): InvoiceParty | null {
  if (!node) return null
  const idNode = ident || node
  const address = first(val(node, "Endereco/Endereco")) || val(node, "Endereco")
  const document = first(val(idNode, "CpfCnpj/Cnpj"), val(idNode, "CpfCnpj/Cpf"), val(idNode, "Cnpj"), val(idNode, "Cpf"))
  return partyFromDocument(document, {
    name: first(val(node, "RazaoSocial"), val(node, "xNome")),
    tradeName: val(node, "NomeFantasia"),
    stateRegistration: val(idNode, "InscricaoEstadual"),
    email: val(node, "Contato/Email").toLowerCase(),
    phone: formatPhone(val(node, "Contato/Telefone")),
    zipCode: formatZip(val(node, "Endereco/Cep")),
    street: address, number: val(node, "Endereco/Numero"), complement: val(node, "Endereco/Complemento"), district: val(node, "Endereco/Bairro"),
    city: val(node, "Endereco/Municipio") || "", state: val(node, "Endereco/Uf").toUpperCase(),
    icmsIndicator: tag === "prestador" ? "9" : "9",
  })
}

function parseNfseAbrasf(root: XmlNode): ParsedInvoice {
  const inf = find(root, "InfNfse") || find(root, "InfDeclaracaoPrestacaoServico")!
  const provider = find(inf, "PrestadorServico") || find(inf, "Prestador")
  const taker = find(inf, "TomadorServico") || find(inf, "Tomador")
  const issuer = abrasfParty(provider, find(provider, "IdentificacaoPrestador"), "prestador")
  const recipient = abrasfParty(taker, find(taker, "IdentificacaoTomador"), "tomador")
  if (issuer && !issuer.name) issuer.name = val(inf, "PrestadorServico/RazaoSocial")
  const total = first(val(inf, "Servico/Valores/ValorLiquidoNfse"), val(inf, "ValorLiquidoNfse"), val(inf, "Servico/Valores/ValorServicos"), val(inf, "ValorServicos"))
  return {
    kind: "NFS-e",
    accessKey: first(val(inf, "CodigoVerificacao")).replace(/\W/g, ""),
    number: first(val(inf, "Numero")),
    series: "",
    issuedAt: first(val(inf, "DataEmissao"), val(inf, "Competencia")),
    nature: first(val(inf, "Servico/Discriminacao"), val(inf, "Discriminacao")).slice(0, 200),
    total: money(total),
    issuer, recipient,
    items: [{ code: val(inf, "Servico/ItemListaServico"), description: first(val(inf, "Servico/Discriminacao"), val(inf, "Discriminacao")).slice(0, 500), ncm: "", cfop: "", unit: "SV", quantity: 1, unitPrice: money(total), total: money(total) }],
    installments: [],
    warnings: ["NFS-e: leitura baseada no padrão ABRASF; confira os dados."],
  }
}

function nationalParty(node: XmlNode | null): InvoiceParty | null {
  if (!node) return null
  const document = first(val(direct(node, "CNPJ")), val(direct(node, "CPF")))
  const address = first(direct(node, "enderNac") ? "enderNac" : "", direct(node, "end") ? "end" : "")
  const where = address ? direct(node, address) : null
  return partyFromDocument(document, {
    name: val(direct(node, "xNome")), tradeName: val(direct(node, "xFant")), email: val(direct(node, "email")).toLowerCase(), phone: formatPhone(val(direct(node, "fone"))),
    zipCode: formatZip(first(val(where, "CEP"), val(where, "endNac/CEP"))), street: val(where, "xLgr"), number: val(where, "nro"), complement: val(where, "xCpl"), district: val(where, "xBairro"),
    state: val(where, "UF").toUpperCase(),
  })
}

function parseNfseNational(root: XmlNode): ParsedInvoice {
  const inf = find(root, "infNFSe")!
  return {
    kind: "NFS-e",
    accessKey: (inf.attrs.Id || "").replace(/^NFS/i, "").replace(/\D/g, ""),
    number: val(inf, "nNFSe"),
    series: val(inf, "serie"),
    issuedAt: first(val(inf, "dhEmi"), val(inf, "dhProc")),
    nature: val(inf, "xTribNac"),
    total: money(first(val(inf, "valores/vLiq"), val(inf, "vServ"))),
    issuer: nationalParty(find(inf, "emit")),
    recipient: nationalParty(find(inf, "toma")),
    items: [],
    installments: [],
    warnings: ["NFS-e padrão nacional: leitura básica; confira os dados."],
  }
}

export function parseInvoiceXml(source: string): ParsedInvoice {
  const root = parseXml(source.replace(/^﻿/, ""))
  if (find(root, "infNFe")) return parseNfe(root)
  if (find(root, "infNFSe")) return parseNfseNational(root)
  if (find(root, "InfNfse") || find(root, "InfDeclaracaoPrestacaoServico")) return parseNfseAbrasf(root)
  if (find(root, "infCte") || find(root, "infMDFe")) throw new Error("CT-e e MDF-e não são suportados: importe uma NF-e ou NFS-e.")
  throw new Error("Não reconheci o XML como NF-e, NFC-e ou NFS-e. Confira se é o XML da nota (não de cancelamento ou evento).")
}

// ---------------- PDF (DANFE): leitura parcial pelo texto

export function validDocument(value: string) {
  const clean = cleanDocument(value)
  return clean.length === 14 ? isValidCnpj(clean) : clean.length === 11 ? isValidCpf(clean) : false
}

/** Dígito verificador (módulo 11, pesos 2 a 9 da direita para a esquerda) da chave de acesso de 44 dígitos. */
export function accessKeyDigit(first43: string) {
  let sum = 0
  let weight = 2
  for (let index = first43.length - 1; index >= 0; index--) {
    sum += Number(first43[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export const isValidAccessKey = (key: string) => /^\d{44}$/.test(key) && accessKeyDigit(key.slice(0, 43)) === Number(key[43]) && isValidCnpj(key.slice(6, 20))

/**
 * Acha a chave de acesso no texto (digitado, de PDF ou de OCR). O dígito verificador e o CNPJ embutido na chave confirmam a
 * leitura; se o OCR errou UM dígito, a correção é testada dígito a dígito.
 */
export function findAccessKey(text: string): { key: string; repaired: boolean } | null {
  const candidates: string[] = []
  for (const match of text.matchAll(/(?:\d[\s.\-|]*){40,48}/g)) {
    const digits = match[0].replace(/\D/g, "")
    if (digits.length >= 44) for (let start = 0; start + 44 <= digits.length; start++) candidates.push(digits.slice(start, start + 44))
    else if (digits.length >= 42) candidates.push(digits)
  }
  const valid = candidates.find((candidate) => isValidAccessKey(candidate))
  if (valid) return { key: valid, repaired: false }
  // O OCR errou UM dígito: o dígito verificador sozinho aceitaria uma troca em qualquer posição, então só vale a troca que
  // também bate com o número da nota ("N. 000.002.347") e com o mês/ano das datas que aparecem no texto.
  const numbers = new Set(Array.from(text.matchAll(/N\s*[º°o.:]*\s*(\d{3}\.?\d{3}\.?\d{3})(?!\d)/gi), (match) => match[1].replace(/\D/g, "")))
  const months = new Set(Array.from(text.matchAll(/(?<![\d/])\d{2}\/(\d{2})\/(\d{4})(?![\d/])/g), (match) => `${match[2].slice(2)}${match[1]}`))
  if (!numbers.size && !months.size) return null
  for (const candidate of candidates.filter((item) => item.length === 44)) {
    const fixes: string[] = []
    for (let index = 0; index < 44; index++) {
      for (let digit = 0; digit <= 9; digit++) {
        if (String(digit) === candidate[index]) continue
        const attempt = `${candidate.slice(0, index)}${digit}${candidate.slice(index + 1)}`
        if (!isValidAccessKey(attempt)) continue
        if (numbers.size && !numbers.has(attempt.slice(25, 34))) continue
        if (months.size && !months.has(attempt.slice(2, 6))) continue
        fixes.push(attempt)
      }
    }
    if (fixes.length === 1) return { key: fixes[0], repaired: true }
  }
  return null
}

const moneyPattern = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})(?![\d])/g
const toMoney = (value: string) => {
  const clean = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}
const brToIso = (value: string) => { const [day, month, year] = value.split("/"); return `${year}-${month}-${day}` }
const validDate = (iso: string) => { const time = Date.parse(`${iso}T12:00:00Z`); return Number.isFinite(time) && Number(iso.slice(0, 4)) >= 2000 }
const lettersOnly = (value: string) => value.replace(/[^A-Za-zÀ-ÿ0-9&.\-/ ]/g, " ").replace(/\s+/g, " ").trim()

/**
 * Lê o texto de um DANFE (PDF com texto ou foto/escaneamento com OCR). A chave de acesso dá emitente, número, série e mês;
 * o restante (data, valor, duplicatas, destinatário, itens) é lido do texto e conferido entre si, com avisos quando não bate.
 */
export function parseInvoicePdfText(rawText: string, options: { ocr?: boolean } = {}): ParsedInvoice {
  const warnings = [options.ocr
    ? "Leitura por OCR de uma foto/escaneamento: confira os valores, as parcelas e o destinatário antes de importar. Prefira o XML quando tiver."
    : "Leitura de PDF é parcial. Prefira o XML da nota para ler tudo."]
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  const flat = lines.join("\n")

  const found = findAccessKey(rawText)
  const key = found?.key || ""
  if (found?.repaired) warnings.push("A chave de acesso foi corrigida pelo dígito verificador (o OCR errou um dígito). Confira com o XML/DANFE.")
  if (!key) warnings.push("Não consegui ler uma chave de acesso válida (44 dígitos). Os dados abaixo podem estar incompletos; tente uma foto mais nítida ou envie o XML.")

  // CNPJ/CPF válidos que aparecem no texto, com a posição
  const documents = Array.from(flat.matchAll(/(?<![\d])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})(?![\d])/g), (match) => ({ value: match[1], index: match.index ?? 0 })).filter((item) => validDocument(item.value))
  const issuerDocument = key ? key.slice(6, 20) : documents[0]?.value || ""
  const issuerClean = cleanDocument(issuerDocument)
  const destIndex = flat.search(/DESTINAT|REMETENTE/i)
  const recipientMatch = documents.find((item) => cleanDocument(item.value) !== issuerClean && (destIndex < 0 || item.index >= destIndex - 20)) || documents.find((item) => cleanDocument(item.value) !== issuerClean)
  const recipientLine = recipientMatch ? lines.find((line) => line.includes(recipientMatch.value)) || "" : ""

  // data de emissão: a data da linha do destinatário (campo "Data da emissão"); senão a data mais repetida
  const dates = Array.from(flat.matchAll(/(?<![\d/])(\d{2}\/\d{2}\/\d{4})(?![\d/])/g), (match) => brToIso(match[1])).filter(validDate)
  const lineDate = recipientLine.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]
  const counts = new Map<string, number>()
  for (const date of dates) counts.set(date, (counts.get(date) || 0) + 1)
  const mostCommon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""
  let issuedAt = lineDate && validDate(brToIso(lineDate)) ? brToIso(lineDate) : mostCommon
  if (key && issuedAt && issuedAt.slice(2, 4) + issuedAt.slice(5, 7) !== key.slice(2, 6)) {
    warnings.push(`A data lida (${issuedAt.split("-").reverse().join("/")}) não bate com o mês da chave de acesso (${key.slice(4, 6)}/20${key.slice(2, 4)}). Confira a data.`)
  }
  if (!issuedAt && key) issuedAt = `20${key.slice(2, 4)}-${key.slice(4, 6)}-01`

  // parcelas (fatura/duplicatas): "001 05/11/2026 1.555,00"
  const installments: InvoiceInstallment[] = []
  const faturaStart = flat.search(/FATURA|DUPLICATA/i)
  const faturaEnd = flat.search(/C[ÁA]LCULO DO IMPOSTO|CALCULO DO|BASE DE C/i)
  const faturaText = faturaStart >= 0 ? flat.slice(faturaStart, faturaEnd > faturaStart ? faturaEnd : faturaStart + 600) : flat.slice(0, faturaEnd > 0 ? faturaEnd : flat.length) // o OCR às vezes estraga o título "FATURA"
  for (const match of faturaText.matchAll(/(\d{3})\s+(\d{2}\/\d{2}\/\d{4})\s+((?:\d{1,3}\.)*\d{1,3},\d{2})/g)) {
    const dueDate = brToIso(match[2])
    if (validDate(dueDate)) installments.push({ number: match[1], dueDate, amount: toMoney(match[3]) })
  }

  // valor total: linha seguinte a "VALOR TOTAL DA NOTA" / "VALOR TOTAL DOS PRODUTOS"; senão soma das parcelas
  const amountAfter = (label: RegExp) => {
    const index = lines.findIndex((line) => label.test(line))
    if (index < 0) return 0
    for (const line of lines.slice(index, index + 3)) {
      const values = Array.from(line.matchAll(moneyPattern), (match) => toMoney(match[1])).filter((value) => value > 0)
      if (values.length) return values[values.length - 1]
    }
    return 0
  }
  const installmentsTotal = Math.round(installments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100
  const labeledTotal = amountAfter(/VALOR TOTAL DA NOTA/i) || amountAfter(/VALOR TOTAL DOS PRODUTOS/i)
  let total = labeledTotal || installmentsTotal
  if (installments.length && total && Math.abs(installmentsTotal - total) > 0.01) {
    warnings.push(`A soma das parcelas (${installmentsTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) não bate com o valor da nota lido (${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Confira.`)
    if (!amountAfter(/VALOR TOTAL DA NOTA/i)) total = installmentsTotal
  }
  if (!total) warnings.push("Não consegui ler o valor total da nota.")

  // itens (melhor esforço): descrição NCM CSOSN CFOP UN quantidade unitário total
  const items: InvoiceItem[] = []
  const money2 = String.raw`(\d[\d.]*[.,]\d{2})`
  const itemPattern = new RegExp(String.raw`([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,.\-/]{3,60}?)\s+(\d{8})\s*[|\]]?\s*\S{3,6}\s*[|\]]?\s*(\d{4})\s*[|\]]?\s*(UN|KG|PC|PÇ|CX|MT|M|L|LT|SC|JG|PAR|M2|M3)\s*[|\]]?\s*(\d+[.,]?\d{4})\s+${money2}\)?\s+\[?${money2}`)
  for (const line of lines) {
    const match = line.match(itemPattern)
    if (!match) continue
    const quantity = Number(match[5].includes(",") || match[5].includes(".") ? match[5].replace(",", ".") : `${match[5].slice(0, -4)}.${match[5].slice(-4)}`)
    const unitPrice = toMoney(match[6])
    const lineTotal = toMoney(match[7])
    if (Math.abs(quantity * unitPrice - lineTotal) > 0.06) continue // linha com dígito errado no OCR: melhor não listar do que listar errado
    items.push({ code: "", description: match[1].replace(/^[|\s\]]+/, "").trim(), ncm: match[2], cfop: match[3], unit: match[4], quantity, unitPrice, total: lineTotal })
  }
  const itemsTotal = Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100
  if (items.length && total && Math.abs(itemsTotal - total) > 0.5) warnings.push(`Só consegui ler ${items.length} item(ns) por OCR (${itemsTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} dos ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} da nota): a lista de itens está incompleta.`)
  else if (options.ocr && items.length) warnings.push(`Itens lidos por OCR (${items.length}): confira.`)

  const nature = lines.find((line, index) => /NATUREZA DA OPERA/i.test(lines[index - 1] || "") || false) || (lines[lines.findIndex((line) => /NATUREZA DA OPERA/i.test(line)) + 1] || "")
  const model = key ? key.slice(20, 22) : ""
  const number = key ? String(Number(key.slice(25, 34))) : (flat.match(/N\s*[º°o.]*\s*(\d{3}\.?\d{3}\.?\d{3})/i)?.[1] || "").replace(/\D/g, "").replace(/^0+/, "")
  const series = key ? String(Number(key.slice(22, 25))) : (flat.match(/S[ÉE]RIE\s*[:\-]?\s*(\d{1,3})/i)?.[1] || "")
  // nome do destinatário só quando é pessoa física (para CNPJ a Receita informa o nome certo)
  const recipientIsCpf = recipientMatch ? cleanDocument(recipientMatch.value).length === 11 : false
  const recipientName = recipientIsCpf ? lettersOnly(recipientLine.replace(recipientMatch!.value, "").replace(/\d{2}\/\d{2}\/\d{4}/g, "")) : ""
  if (!issuerDocument) warnings.push("Não encontrei CNPJ válido do emitente.")
  if (!recipientMatch) warnings.push("Não encontrei o CNPJ/CPF do destinatário.")

  return {
    kind: "PDF",
    accessKey: key,
    number,
    series,
    issuedAt,
    nature: nature && !/^\d/.test(nature) ? lettersOnly(nature.split(/\d/)[0]).slice(0, 80) : model === "65" ? "NFC-e" : model === "55" ? "NF-e" : "",
    total,
    issuer: issuerDocument ? partyFromDocument(issuerDocument, {}) : null,
    recipient: recipientMatch ? partyFromDocument(recipientMatch.value, { name: recipientName }) : null,
    items,
    installments,
    warnings,
    totalFromLabel: labeledTotal > 0,
  }
}

// ---------------- Parte contrária

/** Quem é a parte contrária: se sou o remetente (emiti a nota) é o destinatário; se sou o destinatário, é o emitente. */
export function counterpartOf(invoice: ParsedInvoice, role: MyRole) {
  return role === "remetente" ? invoice.recipient : invoice.issuer
}

/** Avisos quando a escolha de "remetente/destinatário" não bate com o CNPJ da empresa selecionada. */
export function roleWarnings(invoice: ParsedInvoice, role: MyRole, companyDocument: string) {
  const mine = cleanDocument(companyDocument)
  const out: string[] = []
  if (!mine) return out
  const issuer = cleanDocument(invoice.issuer?.document)
  const recipient = cleanDocument(invoice.recipient?.document)
  const me = mine.slice(0, 8)
  const sameCompany = (document: string) => document && (document === mine || (document.length === 14 && document.slice(0, 8) === me && mine.length === 14))
  if (role === "remetente" && !sameCompany(issuer)) out.push(sameCompany(recipient) ? "O destinatário desta nota é a sua empresa. Você escolheu “remetente”: confira se não é “destinatário”." : "O emitente desta nota não é o CNPJ da sua empresa selecionada.")
  if (role === "destinatario" && !sameCompany(recipient)) out.push(sameCompany(issuer) ? "O emitente desta nota é a sua empresa. Você escolheu “destinatário”: confira se não é “remetente”." : "O destinatário desta nota não é o CNPJ da sua empresa selecionada.")
  return out
}

/** Chave para não importar a mesma nota duas vezes. */
export function dedupeKey(invoice: ParsedInvoice) {
  if (invoice.accessKey.length === 44) return invoice.accessKey
  return [invoice.kind, cleanDocument(invoice.issuer?.document), invoice.series, invoice.number, invoice.accessKey].join(":")
}

export type InvoiceTitle = { number: number; count: number; dueDate: string; amount: number }

/** Parcelas a lançar em Contas a Pagar/Receber: as duplicatas da nota; sem duplicatas, uma parcela com o total vencendo na emissão. */
export function invoiceTitles(invoice: Pick<ParsedInvoice, "installments" | "total" | "issuedAt">): InvoiceTitle[] {
  const issued = String(invoice.issuedAt || "").slice(0, 10)
  const installments = invoice.installments.filter((item) => item.amount > 0)
  if (installments.length) {
    return installments.map((item, index) => ({ number: index + 1, count: installments.length, dueDate: String(item.dueDate || issued).slice(0, 10) || issued, amount: Math.round(item.amount * 100) / 100 }))
  }
  return invoice.total > 0 && issued ? [{ number: 1, count: 1, dueDate: issued, amount: Math.round(invoice.total * 100) / 100 }] : []
}

/**
 * A leitura por OCR é confiável? Chave de acesso válida, valor total encontrado, parcelas somando o total e nenhum valor maior que
 * o total solto no texto (sinal de que o OCR perdeu uma parcela ou o campo do total). Quando não é, a leitura é refeita com a
 * página inteira.
 */
export function isReliableReading(text: string, invoice?: ParsedInvoice) {
  const parsed = invoice || parseInvoicePdfText(text, { ocr: true })
  if (!findAccessKey(text) || parsed.total <= 0) return false
  const sum = parsed.installments.reduce((total, item) => total + item.amount, 0)
  if (parsed.installments.length && Math.abs(sum - parsed.total) > 0.01) return false
  const largest = Array.from(text.matchAll(moneyPattern), (match) => toMoney(match[1])).reduce((max, value) => Math.max(max, value), 0)
  if (largest > parsed.total + 0.01) return false
  return Boolean(parsed.totalFromLabel) || parsed.installments.length > 0
}
