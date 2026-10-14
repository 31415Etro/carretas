import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { importInvoice, NF_MIGRATION_HINT, previewInvoice } from "@/lib/nf-import-server"
import { registryError } from "@/lib/registry-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const bad = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (message === NF_MIGRATION_HINT || /imported_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)) return NextResponse.json({ error: NF_MIGRATION_HINT }, { status: 503 })
  return NextResponse.json({ error: registryError(error, fallback).message }, { status: 400 })
}

/** Notas já importadas (mais recentes primeiro). */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { data, error } = await context.admin.from("imported_invoices").select("id,kind,number,series,issued_at,total_amount,my_role,issuer_name,issuer_document,recipient_name,recipient_document,counterpart_name,counterpart_document,counterpart_kind,created_at,created_by").order("created_at", { ascending: false }).limit(200)
    if (error) throw error
    return NextResponse.json({ items: data || [] })
  } catch (error) {
    return bad(error, "Erro ao carregar as notas importadas.")
  }
}

/** multipart: file, role (remetente|destinatario), action (ler|importar), registerAs ("" | cliente | fornecedor). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const form = await request.formData()
    const file = form.get("file")
    const role = String(form.get("role") || "")
    const action = String(form.get("action") || "ler")
    const registerAs = String(form.get("registerAs") || "")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie o arquivo da nota (XML ou PDF)." }, { status: 400 })
    if (role !== "remetente" && role !== "destinatario") return NextResponse.json({ error: "Escolha se você é o remetente ou o destinatário da nota." }, { status: 400 })
    if (!["", "cliente", "fornecedor"].includes(registerAs)) return NextResponse.json({ error: "Opção de cadastro inválida." }, { status: 400 })
    const companyId = await getSelectedSystemCompanyId()
    if (action === "importar") return NextResponse.json({ result: await importInvoice(context.admin, file, role, companyId, registerAs as "" | "cliente" | "fornecedor", context.responsible) })
    return NextResponse.json(await previewInvoice(context.admin, file, role, companyId))
  } catch (error) {
    return bad(error, "Erro ao ler a nota.")
  }
}
