import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import * as eng from "@/lib/engineering-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => {
  const mapped = eng.engError(error)
  return NextResponse.json({ error: mapped.message }, { status: mapped.status })
}

/** Cadastro de engenharia do produto: revisões, documentos, parâmetros com fontes, pendências, opções, regras, fórmulas e desenho. */
export async function GET(_request: Request, { params }: { params: Promise<{ produto: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { produto } = await params
  if (!uuid.test(produto)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try {
    return NextResponse.json({ overview: await eng.overview(context.admin, produto) })
  } catch (error) {
    return fail(error)
  }
}

const managerOnly = ["formula_approve", "issue_resolve", "validate", "preset_fz1e"]

/**
 * Ações de engenharia. Aprovar fórmula, decidir pendência, validar revisão e carregar o modelo piloto são só de administrador/gerente
 * (não existe perfil de engenharia separado: ver limitações). Revisão validada é imutável no banco.
 */
export async function POST(request: Request, { params }: { params: Promise<{ produto: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { produto } = await params
  if (!uuid.test(produto)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try {
    const body = await request.json()
    if (managerOnly.includes(body.action) && context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente (engenharia) faz esta ação." }, { status: 403 })
    const user = context.responsible
    let result: unknown = { ok: true }
    switch (body.action) {
      case "preset_fz1e": result = await eng.applyFz1ePreset(context.admin, produto, user); break
      case "revision_save": result = await eng.revisionSave(context.admin, { ...body.data, product_id: produto }, user); break
      case "revision_copy": result = { revision_id: await eng.revisionCopy(context.admin, String(body.revisionId), body.label, user) }; break
      case "document_add": result = { id: await eng.documentAdd(context.admin, body.data, user) }; break
      case "document_attach": await eng.documentAttach(context.admin, String(body.documentId), String(body.path)); break
      case "parameter_save": result = { id: await eng.parameterSave(context.admin, body.data, user) }; break
      case "option_save": result = { id: await eng.optionSave(context.admin, body.data) }; break
      case "rule_save": result = { id: await eng.ruleSave(context.admin, body.data) }; break
      case "formula_save": result = { id: await eng.formulaSave(context.admin, body.data, user) }; break
      case "formula_approve": await eng.formulaApprove(context.admin, String(body.formulaId), user); break
      case "template_save": result = { id: await eng.templateSave(context.admin, body.data) }; break
      case "issue_resolve": await eng.issueResolve(context.admin, body.data, user); break
      case "submit": result = await eng.revisionSubmit(context.admin, String(body.revisionId), user); break
      case "back_to_draft": await eng.revisionBackToDraft(context.admin, String(body.revisionId)); break
      case "validate": result = await eng.revisionValidate(context.admin, String(body.revisionId), user); break
      case "detect": result = { opened: await eng.detectIssues(context.admin, String(body.revisionId), user) }; break
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
    return NextResponse.json({ result, overview: await eng.overview(context.admin, produto) })
  } catch (error) {
    return fail(error)
  }
}
