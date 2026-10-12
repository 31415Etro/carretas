import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { addAttachment, changeQuoteStatus, companyBranding, createVersion, duplicateQuote, formalizeQuote, getQuote, quoteError, quoteForOrder, removeAttachment, sendQuoteEmail } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"

type Params = { params: Promise<{ id: string }> }

const bad = (error: unknown, fallback: string) => {
  const { message, status } = quoteError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

/** Detalhe do orçamento (itens, histórico, versões, anexos, OS e títulos). Com ?forOrder=1, dados para abrir a OS. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    if (new URL(request.url).searchParams.get("forOrder")) return NextResponse.json(await quoteForOrder(context.admin, id))
    return NextResponse.json(await getQuote(context.admin, id))
  } catch (error) {
    return bad(error, "Erro ao carregar orçamento.")
  }
}

/** Ações: status, version, duplicate, formalize, email, attach, detach. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    switch (body.action) {
      case "status": return NextResponse.json(await changeQuoteStatus(context.admin, id, String(body.to || ""), body, context.responsible))
      case "version": return NextResponse.json(await createVersion(context.admin, id, context.responsible))
      case "duplicate": return NextResponse.json(await duplicateQuote(context.admin, id, context.responsible))
      case "formalize": return NextResponse.json(await formalizeQuote(context.admin, id, { target: body.target === "OS" ? "OS" : "Venda", warehouseId: body.warehouseId, baseDate: body.baseDate }, context.responsible))
      case "email": {
        const company = await getSelectedSystemCompany()
        const branding = await companyBranding(context.admin, company.id)
        return NextResponse.json(await sendQuoteEmail(context.admin, id, { to: body.to, subject: body.subject, message: body.message, pdfBase64: body.pdfBase64, companyName: branding.name, replyTo: branding.email }, context.responsible))
      }
      case "attach":
        await addAttachment(context.admin, id, { path: String(body.path || ""), name: String(body.name || "arquivo") }, context.responsible)
        return NextResponse.json(await getQuote(context.admin, id))
      case "detach":
        await removeAttachment(context.admin, String(body.attachmentId || ""), context.responsible)
        return NextResponse.json(await getQuote(context.admin, id))
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
    }
  } catch (error) {
    return bad(error, "Erro ao executar a ação.")
  }
}
