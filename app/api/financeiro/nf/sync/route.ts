import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { companyByCnpj, lancarSaidas, syncXml, syncXmlAccounting, validSyncSecret } from "@/lib/nf-sync-server"
import { summarize } from "@/lib/nf-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_FILES = 25

/**
 * Importação automática de NF-e (agendador local do NFeMail). Autenticada por NF_SYNC_SECRET (Authorization: Bearer ...).
 * multipart: companyCnpj, dryRun ("1" só simula), files[] (XMLs). Notas já importadas são ignoradas (chave de acesso).
 */
export async function POST(request: Request) {
  if (!validSyncSecret(request)) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
  try {
    const form = await request.formData()
    const cnpj = String(form.get("companyCnpj") || "")
    const action = String(form.get("acao") || "")
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File)
    if (action !== "lancar-saidas" && !files.length) return NextResponse.json({ error: "Envie ao menos um XML." }, { status: 400 })
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Envie até ${MAX_FILES} XMLs por chamada.` }, { status: 400 })
    const company = await companyByCnpj(createAdminClient({ bypassCompanyScope: true }), cnpj)
    if (!company) return NextResponse.json({ error: "CNPJ não cadastrado em Configurações > Empresas." }, { status: 404 })
    const admin = createAdminClient({ companyId: String(company.id) })
    if (action === "lancar-saidas") return NextResponse.json({ company: company.name, ...(await lancarSaidas(admin)) })
    const dryRun = String(form.get("dryRun") || "") === "1"
    const results = []
    const accountingOnly = String(form.get("destino") || "") === "contabilidade"
    const accountingOperation = String(form.get("operacao") || "") === "saida" ? "Saída" : "Entrada"
    for (const file of files) results.push(accountingOnly ? await syncXmlAccounting(admin, String(company.cnpj), file.name, await file.text(), dryRun, accountingOperation) : await syncXml(admin, String(company.id), String(company.cnpj), file.name, await file.text(), dryRun))
    return NextResponse.json({ company: company.name, summary: summarize(results), results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro na importação automática." }, { status: 500 })
  }
}
