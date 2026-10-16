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

export function parseInvoicePdfText(rawText: string): ParsedInvoice {
  const text = rawText.replace(/\s+/g, " ")
  const warnings = ["Leitura de PDF é parcial (chave de acesso e CNPJ/CPF). Prefira o XML da nota para ler tudo."]
  const keyMatch = text.match(/(?:\d{4}\s?){10}\d{4}/g)?.map((value) => value.replace(/\s/g, "")).find((value) => value.length === 44 && isValidCnpj(value.slice(6, 20)))
  const documents = Array.from(text.matchAll(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2})\b/g), (match) => match[1]).filter(validDocument)
  const issuerDocument = keyMatch ? keyMatch.slice(6, 20) : documents[0] || ""
  const recipientDocument = documents.map(cleanDocument).find((value) => value !== cleanDocument(issuerDocument)) || ""
  if (!issuerDocument) warnings.push("Não encontrei a chave de acesso nem CNPJ válido no PDF. Se for PDF escaneado, envie o XML.")
  const model = keyMatch ? keyMatch.slice(20, 22) : ""
  return {
    kind: "PDF",
    accessKey: keyMatch || "",
    number: keyMatch ? String(Number(keyMatch.slice(25, 34))) : "",
    series: keyMatch ? String(Number(keyMatch.slice(22, 25))) : "",
    issuedAt: keyMatch ? `20${keyMatch.slice(2, 4)}-${keyMatch.slice(4, 6)}-01` : "",
    nature: model === "65" ? "NFC-e" : model === "55" ? "NF-e" : "",
    total: 0,
    issuer: issuerDocument ? partyFromDocument(issuerDocument, {}) : null,
    recipient: recipientDocument ? partyFromDocument(recipientDocument, {}) : null,
    items: [], installments: [], warnings,
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
