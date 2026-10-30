import type { createAdminClient } from "@/lib/supabase/server"
import { cleanDocument, formatDocument, isValidCnpj } from "@/lib/commercial"
import { companyToForm, namesMatch } from "@/lib/registry"
import { lookupCnpj } from "@/lib/cnpj-server"
import { ocrInvoiceImage } from "@/lib/ocr-server"
import { extractJpegImages, looksScanned } from "@/lib/pdf-images"
import { findByDocument, saveRegistry } from "@/lib/registry-server"
import { createHash, randomUUID } from "node:crypto"
import { revenueKind } from "@/lib/nf-sync"
import { counterpartOf, dedupeKey, findAccessKey, invoiceTitles, parseInvoicePdfText, parseInvoiceXml, roleWarnings, type InvoiceParty, type MyRole, type ParsedInvoice } from "@/lib/nfe-parser"
import { extractPdfText } from "@/lib/pdf-text-extractor"

type Admin = ReturnType<typeof createAdminClient>
export const NF_MIGRATION_HINT = "Importação de NF ainda não instalada no banco. Rode scripts/216_importacao_nf.sql no SQL Editor do Supabase."

/** XML de nota: UTF-8 na maioria; alguns emissores enviam ISO-8859-1. */
function decodeXml(bytes: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("windows-1252").decode(bytes)
  }
}

const IMAGE_NAME = /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i
const HEIC_NAME = /\.(heic|heif)$/i
const MAX_BYTES = 12 * 1024 * 1024

// A leitura por OCR leva alguns segundos: guarda o resultado para a etapa "Importar" não repetir o trabalho.
const readCache = new Map<string, { at: number; invoice: ParsedInvoice }>()
const CACHE_MS = 15 * 60_000

export type InvoiceInput = { file?: File; ocrText?: string; fileName: string }

/** Guarda de tempo: o OCR no servidor é só reserva; o normal é o navegador ler a foto e mandar o texto (evita erro 504 da hospedagem). */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}
const SERVER_OCR_MESSAGE = "A leitura da foto no servidor demorou demais. Atualize a página e envie de novo: a leitura é feita no seu navegador."

/** Texto já lido por OCR no navegador. */
export function readOcrText(text: string): ParsedInvoice {
  if (text.length > 300_000) throw new Error("Texto lido da nota grande demais.")
  const hash = createHash("sha256").update(text).digest("hex")
  const cached = readCache.get(hash)
  if (cached && Date.now() - cached.at < CACHE_MS) return structuredClone(cached.invoice)
  const invoice = parseInvoicePdfText(text, { ocr: true })
  readCache.set(hash, { at: Date.now(), invoice: structuredClone(invoice) })
  return invoice
}

const readInput = (input: InvoiceInput) => (input.ocrText ? readOcrText(input.ocrText) : readInvoiceFile(input.file as File))

/** Lê a nota de um XML, de um PDF com texto, ou de uma foto/escaneamento (JPG, PNG, WEBP... e PDF escaneado) por OCR. */
export async function readInvoiceFile(file: File): Promise<ParsedInvoice> {
  const name = file.name.toLowerCase()
  if (file.size > MAX_BYTES) throw new Error("Arquivo muito grande: envie até 12 MB (reduza a resolução da foto).")
  const bytes = Buffer.from(await file.arrayBuffer())
  const hash = createHash("sha256").update(bytes).digest("hex")
  const cached = readCache.get(hash)
  if (cached && Date.now() - cached.at < CACHE_MS) return structuredClone(cached.invoice)
  for (const [key, entry] of readCache) if (Date.now() - entry.at >= CACHE_MS) readCache.delete(key)

  let invoice: ParsedInvoice
  if (HEIC_NAME.test(name) || /heic|heif/i.test(file.type)) {
    throw new Error("Fotos HEIC (iPhone) não são lidas. Envie em JPG ou PNG (no iPhone: Ajustes > Câmera > Formatos > Mais Compatível) ou tire um print.")
  } else if (name.endsWith(".pdf") || file.type === "application/pdf") {
    // PDF de scanner/CamScanner: uma foto grande e nenhuma fonte de texto. Pula a leitura de texto (mais lenta) e vai direto ao OCR.
    const scanned = looksScanned(bytes)
    const { text } = scanned ? { text: "" } : await extractPdfText(file)
    if (findAccessKey(text)) {
      invoice = parseInvoicePdfText(text) // DANFE com texto selecionável
    } else {
      const pages = extractJpegImages(bytes).filter((image) => image.length > 20_000).slice(0, 3)
      if (!pages.length) {
        if (!text.trim()) throw new Error("Este PDF não tem texto nem imagem JPEG que eu consiga ler. Envie o XML, ou a nota como foto JPG/PNG.")
        invoice = parseInvoicePdfText(text)
      } else {
        const texts: string[] = []
        for (const page of pages) texts.push(await withTimeout(ocrInvoiceImage(Buffer.from(page)), 40_000, SERVER_OCR_MESSAGE))
        invoice = parseInvoicePdfText(texts.join("\n"), { ocr: true })
      }
    }
  } else if (IMAGE_NAME.test(name) || file.type.startsWith("image/")) {
    invoice = parseInvoicePdfText(await withTimeout(ocrInvoiceImage(bytes), 40_000, SERVER_OCR_MESSAGE), { ocr: true })
  } else {
    const text = decodeXml(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    if (!/^\s*(\uFEFF)?\s*</.test(text)) throw new Error("Envie o XML da nota, ou o PDF/foto (JPG, PNG) do DANFE.")
    invoice = parseInvoiceXml(text)
  }
  readCache.set(hash, { at: Date.now(), invoice: structuredClone(invoice) })
  return invoice
}

/** Completa o que a nota não trouxe (nome, endereço, IE, contato) pela Receita Federal (BrasilAPI + cnpj.ws). Falha em silêncio. */
export async function enrichParty(party: InvoiceParty): Promise<InvoiceParty> {
  const clean = cleanDocument(party.document)
  if (party.personType !== "PJ" || !isValidCnpj(clean)) return party
  if (party.name && party.street && party.zipCode && party.stateRegistration) return party
  try {
    const result = await lookupCnpj(clean)
    if (!result.ok) return party
    const form = companyToForm(result.company as any)
    const pick = (own: string, key: string) => own || form[key] || ""
    return {
      ...party,
      name: pick(party.name, "name"), tradeName: pick(party.tradeName, "tradeName"), phone: pick(party.phone, "phone"), email: pick(party.email, "email"),
      zipCode: pick(party.zipCode, "zipCode"), street: pick(party.street, "street"), number: pick(party.number, "number"), complement: pick(party.complement, "complement"),
      district: pick(party.district, "district"), city: pick(party.city, "city"), state: pick(party.state, "state"),
      stateRegistration: pick(party.stateRegistration, "stateRegistration"), icmsIndicator: party.stateRegistration ? party.icmsIndicator : form.icmsIndicator || party.icmsIndicator,
    }
  } catch {
    return party
  }
}

/** Cadastro antigo SEM CNPJ cujo nome curto é a razão social da nota (ex.: "JG COM. TINTAS" x "JG COMERCIO DE TINTAS LTDA ME"). */
async function findSimilarWithoutDocument(admin: Admin, entity: "client" | "supplier", name: string) {
  const { data, error } = await admin.from(entity === "client" ? "clients" : "suppliers").select("id,code,name,trade_name,document,phone,email").or("document.is.null,document.eq.").limit(2000)
  if (error) throw error
  const matches = (data || []).filter((row) => namesMatch(String(row.name || ""), name))
  return matches.length === 1 ? { id: String(matches[0].id), code: String(matches[0].code || ""), name: String(matches[0].name), phone: String(matches[0].phone || ""), email: String(matches[0].email || "") } : null
}

/** Preenche o CNPJ e os dados da nota num cadastro que já existia sem CNPJ, sem apagar o que ele já tinha. */
async function completeExisting(admin: Admin, entity: "client" | "supplier", row: { id: string; name: string; phone: string; email: string }, party: InvoiceParty) {
  const update: Record<string, unknown> = {
    document: party.document, person_type: party.personType, name: party.name || row.name, trade_name: row.name, state_registration: party.stateRegistration || null,
    zip_code: party.zipCode || null, street: party.street || null, number: party.number || null, complement: party.complement || null, district: party.district || null,
    city: party.city || null, state: party.state || null, country: party.country || "Brasil", icms_indicator: party.icmsIndicator || "9",
  }
  if (entity === "client") { update.type = party.personType; update.corporate_name = party.name || row.name; delete update.person_type }
  if (!row.phone && party.phone) update.phone = party.phone
  if (!row.email && party.email) update.email = party.email
  for (const key of Object.keys(update)) if (update[key] === null || update[key] === "") delete update[key]
  const { error } = await admin.from(entity === "client" ? "clients" : "suppliers").update(update).eq("id", row.id)
  if (error) throw error
}

export async function previewInvoice(admin: Admin, input: InvoiceInput, role: MyRole, companyId: string) {
  const invoice = await readInput(input)
  // foto/PDF: o OCR lê o CNPJ, não o nome; a Receita completa o emitente e o destinatário
  const [issuer, recipient] = await Promise.all([
    invoice.issuer && !invoice.issuer.name ? enrichParty(invoice.issuer) : invoice.issuer,
    invoice.recipient && !invoice.recipient.name ? enrichParty(invoice.recipient) : invoice.recipient,
  ])
  invoice.issuer = issuer
  invoice.recipient = recipient
  const counterpart = counterpartOf(invoice, role)
  if (!counterpart || !cleanDocument(counterpart.document)) {
    throw new Error(role === "remetente" ? "Esta nota não traz CNPJ/CPF do destinatário (parte contrária)." : "Esta nota não traz CNPJ/CPF do emitente (parte contrária).")
  }
  const enriched = await enrichParty(counterpart)
  const { data: company } = await admin.from("system_companies").select("cnpj").eq("id", companyId).maybeSingle()
  const key = dedupeKey(invoice)
  const [existing, duplicate] = await Promise.all([
    findByDocument(admin, enriched.document),
    admin.from("imported_invoices").select("id,created_at,created_by").eq("dedupe_key", key).maybeSingle(),
  ])
  if (duplicate.error) throw new Error(/does not exist|Could not find|schema cache/i.test(duplicate.error.message) ? NF_MIGRATION_HINT : duplicate.error.message)
  const [similarClient, similarSupplier] = await Promise.all([
    existing.client ? null : findSimilarWithoutDocument(admin, "client", enriched.name),
    existing.supplier ? null : findSimilarWithoutDocument(admin, "supplier", enriched.name),
  ])
  return { invoice, counterpart: enriched, existing, similar: { client: similarClient, supplier: similarSupplier }, duplicate: duplicate.data || null, warnings: [...invoice.warnings, ...roleWarnings(invoice, role, company?.cnpj || "")], dedupeKey: key }
}

export async function importInvoice(admin: Admin, input: InvoiceInput, role: MyRole, companyId: string, registerAs: "" | "cliente" | "fornecedor", responsible: string, launch = true, settleBefore = "") {
  const file = { name: input.fileName }
  const preview = await previewInvoice(admin, input, role, companyId)
  if (preview.duplicate) throw new Error("Esta nota já foi importada.")
  const { invoice, counterpart, existing } = preview
  let clientId: string | null = existing.client?.id || null
  let supplierId: string | null = existing.supplier?.id || null
  let counterpartKind: "Cliente" | "Fornecedor" | null = null
  let created = false

  if (registerAs) {
    const entity = registerAs === "cliente" ? "client" : "supplier"
    const own = entity === "client" ? existing.client : existing.supplier
    const other = entity === "client" ? existing.supplier : existing.client
    counterpartKind = entity === "client" ? "Cliente" : "Fornecedor"
    const similar = entity === "client" ? preview.similar.client : preview.similar.supplier
    if (!own && similar) {
      // já existia cadastrado sem CNPJ: só completa o CNPJ e os dados, não cria outro
      await completeExisting(admin, entity, similar, counterpart)
      if (entity === "client") clientId = similar.id
      else supplierId = similar.id
    } else if (!own) {
      const saved = await saveRegistry(admin, entity, {
        personType: counterpart.personType, status: "Ativo", document: counterpart.document, name: counterpart.name, tradeName: counterpart.tradeName === counterpart.name ? "" : counterpart.tradeName,
        // telefone sem DDD (ex.: "34273700" na nota de posto) não pode travar a importação automática: cadastra sem telefone e o aviso nas observações pede para completar
        stateRegistration: counterpart.stateRegistration, icmsIndicator: counterpart.icmsIndicator, phone: (() => { const digits = String(counterpart.phone || "").replace(/\D/g, ""); return digits.length >= 10 && digits.length <= 13 ? counterpart.phone : "" })(), email: counterpart.email,
        zipCode: counterpart.zipCode, street: counterpart.street, number: counterpart.number, complement: counterpart.complement, district: counterpart.district,
        city: counterpart.city, state: counterpart.state, country: counterpart.country || "Brasil",
        notes: `Cadastrado pela importação da NF ${invoice.number || ""}${invoice.series ? `/${invoice.series}` : ""} (${role === "remetente" ? "destinatário" : "emitente"}). Complete telefone e demais dados.`,
        partyId: other?.partyId || "",
      }, responsible, other?.id || "", true)
      created = true
      if (entity === "client") clientId = saved.id
      else supplierId = saved.id
    }
  }

  const row = {
    dedupe_key: preview.dedupeKey, kind: invoice.kind, access_key: invoice.accessKey || null, number: invoice.number || null, series: invoice.series || null,
    issued_at: invoice.issuedAt ? new Date(invoice.issuedAt).toISOString() : null, nature: invoice.nature || null, total_amount: invoice.total,
    my_role: role === "remetente" ? "Remetente" : "Destinatário",
    issuer_document: invoice.issuer?.document || null, issuer_name: invoice.issuer?.name || null, recipient_document: invoice.recipient?.document || null, recipient_name: invoice.recipient?.name || null,
    counterpart_document: counterpart.document, counterpart_name: counterpart.name || null, counterpart_kind: counterpartKind,
    counterpart_client_id: clientId, counterpart_supplier_id: supplierId, items: invoice.items, installments: invoice.installments, file_name: file.name, created_by: responsible,
  }
  const { data, error } = await admin.from("imported_invoices").insert(row).select("id").single()
  if (error) throw error

  // A nota também vira conta: recebida (destinatário) -> Contas a Pagar; emitida (remetente) -> Contas a Receber.
  let titles: { kind: "pagar" | "receber"; count: number; total: number } | null = null
  let titlesNote = ""
  if (launch) {
    const parcels = invoiceTitles(invoice)
    if (!parcels.length) {
      titlesNote = "A nota não traz valor ou data de emissão (PDF?): lance a conta manualmente."
    } else {
      const kind = role === "destinatario" ? "pagar" : "receber"
      const group = parcels.length > 1 ? randomUUID() : null
      const number = `${invoice.number || ""}${invoice.series ? `/${invoice.series}` : ""}`
      const base = (parcel: (typeof parcels)[number]) => ({
        id: randomUUID(), description: `NF ${number || invoice.kind} - ${counterpart.name || counterpart.document}`, competence_date: String(invoice.issuedAt || "").slice(0, 10) || parcel.dueDate, due_date: parcel.dueDate,
        expected_amount: parcel.amount, status: "Aberta", origin: "Importacao NF", attachment_url: file.name,
        notes: `Importacao NF | ${preview.dedupeKey}\nNF ${number} (${invoice.kind}) emitida em ${String(invoice.issuedAt || "").slice(0, 10)}${invoice.nature ? `\nNatureza: ${invoice.nature}` : ""}\nParte contrária: ${counterpart.name} (${counterpart.document})`,
        document_number: invoice.number || null, installment_number: parcels.length > 1 ? parcel.number : null, installment_count: parcels.length > 1 ? parcel.count : null, installment_group_id: group,
        source_type: kind === "pagar" ? "Compra" : "Venda", source_reference: invoice.accessKey || `NF ${number}`, created_by: responsible,
      })
      // nota emitida: categoria de receita e linha da DRE da empresa (Receita Bruta)
      let revenue: { category_id: string; dre_account_id: string | null } | null = null
      if (kind === "receber") {
        const wanted = revenueKind(invoice.items)
        const { data: categories } = await admin.from("financial_categories").select("id,name,dre_account_id").eq("type", "entrada").eq("name", wanted).limit(1)
        if (categories?.[0]) revenue = { category_id: String(categories[0].id), dre_account_id: categories[0].dre_account_id ? String(categories[0].dre_account_id) : null }
      }
      const rows = parcels.map((parcel) => kind === "pagar"
        ? { ...base(parcel), supplier_id: supplierId, supplier_name: counterpart.name, paid_amount: 0 }
        : { ...base(parcel), client_id: clientId, received_amount: 0, ...(revenue || {}) })
      // Emitida de meses anteriores (settleBefore = 1º dia do mês corrente): já considerada recebida, entra como Entrada no dia do vencimento
      const settled = settleBefore ? rows.filter((row) => String(row.due_date) < settleBefore) : []
      const open = rows.filter((row) => !settled.includes(row))
      // recebida de meses anteriores: não fica em Contas a Pagar (a saída é lançada em Entradas e Saídas pela rotina de lançar saídas)
      if (kind === "receber" && settled.length) {
        const entries = settled.map((row) => ({
          id: randomUUID(), type: "entrada", description: row.description, client_id: clientId, competence_date: row.competence_date, due_date: row.due_date, realized_date: row.due_date,
          expected_amount: row.expected_amount, realized_amount: row.expected_amount, status: "Realizado", origin: "Importacao NF", notes: row.notes, attachment_url: row.attachment_url,
          category_id: (row as { category_id?: string }).category_id || null, dre_account_id: (row as { dre_account_id?: string | null }).dre_account_id || null,
        }))
        const entered = await admin.from("financial_transactions").insert(entries)
        if (entered.error) {
          await admin.from("imported_invoices").delete().eq("id", data.id)
          throw new Error(`Entradas: ${entered.error.message}`)
        }
      }
      const inserted = open.length ? await admin.from(kind === "pagar" ? "accounts_payable" : "accounts_receivable").insert(open) : { error: null }
      if (inserted.error) {
        await admin.from("imported_invoices").delete().eq("id", data.id) // não deixa a nota importada sem a conta
        throw new Error(`Contas a ${kind === "pagar" ? "Pagar" : "Receber"}: ${inserted.error.message}`)
      }
      titles = { kind, count: rows.length, total: Math.round(parcels.reduce((sum, parcel) => sum + parcel.amount, 0) * 100) / 100 }
    }
  }
  return { id: data.id as string, registered: counterpartKind, created, counterpartName: counterpart.name, document: formatDocument(counterpart.document), titles, titlesNote }
}
