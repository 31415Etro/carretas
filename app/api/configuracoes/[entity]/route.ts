import { NextResponse } from "next/server"
import { configAccess, configError, getSettings, integrationsOverview, listBranches, listCompanies, listDocuments, listNatures, listPriceTables, listTemplates, listUsersAccess, removeCertificate, saveBranch, saveCompany, saveNature, savePriceTable, saveSection, saveTemplate, saveUserAccess } from "@/lib/config-server"
import { reprocessAsaasEvent } from "@/lib/asaas-server"
import { audit } from "@/lib/audit"

type Params = { params: Promise<{ entity: string }> }

const bad = (error: unknown, fallback: string) => {
  const { message, status } = configError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

/** Listas das Configurações. Tudo é exclusivo de administradores, exceto os documentos (filtrados por visibilidade). */
export async function GET(_request: Request, { params }: Params) {
  const { entity } = await params
  const access = await configAccess({ allowStaff: entity === "documentos" })
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    switch (entity) {
      case "empresas": return NextResponse.json({ items: await listCompanies(access.root) })
      case "filiais": return NextResponse.json({ items: await listBranches(access.root) })
      case "usuarios": return NextResponse.json({ items: await listUsersAccess(access.root) })
      case "parametros": return NextResponse.json({ settings: await getSettings(access.admin) })
      case "naturezas": return NextResponse.json({ items: await listNatures(access.admin) })
      case "modelos": return NextResponse.json({ items: await listTemplates(access.admin) })
      case "tabelas-preco": return NextResponse.json({ items: await listPriceTables(access.admin) })
      case "documentos": return NextResponse.json({ items: await listDocuments(access.admin, { id: access.user.id, role: access.role }) })
      case "integracoes": return NextResponse.json(await integrationsOverview(access.admin))
      default: return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 })
    }
  } catch (error) {
    return bad(error, "Erro ao carregar.")
  }
}

export async function POST(request: Request, { params }: Params) {
  const { entity } = await params
  const access = await configAccess()
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const actor = { id: access.user.id, email: access.user.email || "" }
  try {
    const body = await request.json()
    switch (entity) {
      case "empresas":
        if (body.action === "remove-certificate") { await removeCertificate(access.root, String(body.companyId || ""), actor); return NextResponse.json({ ok: true }) }
        return NextResponse.json({ item: await saveCompany(access.root, body.item || {}, actor) })
      case "filiais": await saveBranch(access.root, body.item || {}); return NextResponse.json({ ok: true })
      case "usuarios": await saveUserAccess(access.root, String(body.userId || ""), body.item || {}); return NextResponse.json({ ok: true })
      case "parametros": return NextResponse.json({ value: await saveSection(access.admin, String(body.section || ""), body.values || {}, actor.email || actor.id) })
      case "naturezas": await saveNature(access.admin, body.item || {}); return NextResponse.json({ ok: true })
      case "modelos": await saveTemplate(access.admin, body.item || {}); return NextResponse.json({ ok: true })
      case "tabelas-preco": await savePriceTable(access.admin, body.item || {}); return NextResponse.json({ ok: true })
      case "integracoes":
        if (body.action !== "reprocess") return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
        try {
          await reprocessAsaasEvent(String(body.eventId || ""))
          await audit({ module: "integracoes", action: "Reprocessamento de evento (Asaas)", description: `Reprocessou o evento ${String(body.eventId).slice(0, 36)} com sucesso.`, actorId: actor.id, actorEmail: actor.email })
        } catch (error) {
          await audit({ module: "integracoes", action: "Reprocessamento de evento (Asaas)", description: `Reprocessar o evento ${String(body.eventId).slice(0, 36)} falhou: ${error instanceof Error ? error.message.slice(0, 160) : "erro"}`, result: "Falha", actorId: actor.id, actorEmail: actor.email })
          throw error
        }
        return NextResponse.json({ ok: true })
      default: return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 })
    }
  } catch (error) {
    return bad(error, "Erro ao salvar.")
  }
}
