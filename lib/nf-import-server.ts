import type { createAdminClient } from "@/lib/supabase/server"
import { cleanDocument, formatDocument, isValidCnpj } from "@/lib/commercial"
import { companyToForm } from "@/lib/registry"
import { mapBrasilApiCnpj } from "@/lib/cnpj-lookup"
import { findByDocument, saveRegistry } from "@/lib/registry-server"
import { randomUUID } from "node:crypto"
import { counterpartOf, dedupeKey, invoiceTitles, parseInvoicePdfText, parseInvoiceXml, roleWarnings, type InvoiceParty, type MyRole, type ParsedInvoice } from "@/lib/nfe-parser"
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

export async function readInvoiceFile(file: File): Promise<ParsedInvoice> {
  const name = file.name.toLowerCase()
  if (file.size > 4 * 1024 * 1024) throw new Error("Arquivo muito grande: envie até 4 MB.")
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { text } = await extractPdfText(file)
    return parseInvoicePdfText(text)
  }
  const text = decodeXml(await file.arrayBuffer())
  if (!/^\s*(﻿)?\s*</.test(text)) throw new Error("Envie o XML (ou PDF) da nota fiscal.")
  return parseInvoiceXml(text)
}

/** Completa o que a nota não trouxe (nome, endereço) pela Receita Federal quando é CNPJ válido. Falha em silêncio. */
export async function enrichParty(party: InvoiceParty): Promise<InvoiceParty> {
  const clean = cleanDocument(party.document)
  if (party.personType !== "PJ" || !isValidCnpj(clean)) return party
  if (party.name && party.street && party.zipCode) return party
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, { headers: { Accept: "application/json", "User-Agent": "ERP-Carretas/1.0" }, signal: AbortSignal.timeout(10_000), cache: "no-store" })
    if (!response.ok) return party
    const form = companyToForm(mapBrasilApiCnpj(await response.json()) as any)
    const pick = (own: string, key: string) => own || form[key] || ""
    return {
      ...party,
      name: pick(party.name, "name"), tradeName: pick(party.tradeName, "tradeName"), phone: pick(party.phone, "phone"), email: pick(party.email, "email"),
      zipCode: pick(party.zipCode, "zipCode"), street: pick(party.street, "street"), number: pick(party.number, "number"), complement: pick(party.complement, "complement"),
      district: pick(party.district, "district"), city: pick(party.city, "city"), state: pick(party.state, "state"),
    }
  } catch {
    return party
  }
}

export async function previewInvoice(admin: Admin, file: File, role: MyRole, companyId: string) {
  const invoice = await readInvoiceFile(file)
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
  return { invoice, counterpart: enriched, existing, duplicate: duplicate.data || null, warnings: [...invoice.warnings, ...roleWarnings(invoice, role, company?.cnpj || "")], dedupeKey: key }
}

export async function importInvoice(admin: Admin, file: File, role: MyRole, companyId: string, registerAs: "" | "cliente" | "fornecedor", responsible: string, launch = true) {
  const preview = await previewInvoice(admin, file, role, companyId)
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
    if (!own) {
      const saved = await saveRegistry(admin, entity, {
        personType: counterpart.personType, status: "Ativo", document: counterpart.document, name: counterpart.name, tradeName: counterpart.tradeName === counterpart.name ? "" : counterpart.tradeName,
        stateRegistration: counterpart.stateRegistration, icmsIndicator: counterpart.icmsIndicator, phone: counterpart.phone, email: counterpart.email,
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
      const rows = parcels.map((parcel) => kind === "pagar"
        ? { ...base(parcel), supplier_id: supplierId, supplier_name: counterpart.name, paid_amount: 0 }
        : { ...base(parcel), client_id: clientId, received_amount: 0 })
      const inserted = await admin.from(kind === "pagar" ? "accounts_payable" : "accounts_receivable").insert(rows)
      if (inserted.error) {
        await admin.from("imported_invoices").delete().eq("id", data.id) // não deixa a nota importada sem a conta
        throw new Error(`Contas a ${kind === "pagar" ? "Pagar" : "Receber"}: ${inserted.error.message}`)
      }
      titles = { kind, count: rows.length, total: Math.round(parcels.reduce((sum, parcel) => sum + parcel.amount, 0) * 100) / 100 }
    }
  }
  return { id: data.id as string, registered: counterpartKind, created, counterpartName: counterpart.name, document: formatDocument(counterpart.document), titles, titlesNote }
}
