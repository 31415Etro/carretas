import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { activateVersion, compareVersions, kitDetail, kitError, saveKit } from "@/lib/kits-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = kitError(error)
  return NextResponse.json({ error: mapped.message, fields: mapped.fields }, { status: mapped.status })
}

/** Detalhes do kit. ?versao=<id> mostra os componentes de outra versão; ?comparar=<idA>,<idB> devolve as diferenças entre duas versões. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Kit inválido." }, { status: 400 })
  try {
    const query = new URL(request.url).searchParams
    const compare = (query.get("comparar") || "").split(",")
    if (compare.length === 2 && compare.every((value) => uuid.test(value))) return NextResponse.json({ differences: await compareVersions(context.admin, compare[0], compare[1]) })
    const version = query.get("versao")
    if (version && !uuid.test(version)) return NextResponse.json({ error: "Versão inválida." }, { status: 400 })
    return NextResponse.json({ detail: await kitDetail(context.admin, id, version) })
  } catch (error) {
    return fail(error)
  }
}

/**
 * Salva o kit. Corpo: { form, versionId?, activate?, withComponents? } ou { action: "activate", versionId }.
 * Composição de kit com versão vigente NUNCA altera a versão em uso: gera uma nova versão em rascunho.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Kit inválido." }, { status: 400 })
  try {
    const body = await request.json()
    if (body.action === "activate") {
      if (!uuid.test(String(body.versionId || ""))) throw new Error("Informe a versão a ativar.")
      await activateVersion(context.admin, body.versionId)
      return NextResponse.json({ ok: true })
    }
    if (!body.form || typeof body.form !== "object") throw new Error("Envie os dados do kit.")
    return NextResponse.json(await saveKit(context.admin, { kitId: id, versionId: body.versionId || undefined, form: body.form, activate: Boolean(body.activate), withComponents: body.withComponents !== false }))
  } catch (error) {
    return fail(error)
  }
}
