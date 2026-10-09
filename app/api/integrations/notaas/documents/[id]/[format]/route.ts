import { NextResponse } from "next/server"
import { notaAsConfiguration, notaAsDocumentPath, type NotaAsDocumentKind } from "@/lib/notaas"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string; format: string }> }) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const { id, format: rawFormat } = await context.params
    if (rawFormat !== "pdf" && rawFormat !== "xml") return NextResponse.json({ error: "Formato invalido." }, { status: 400 })
    const admin = createAdminClient()
    const result = await admin.from("asaas_fiscal_documents").select("id,document_kind,external_document_id,document_number,payload").eq("id", id).maybeSingle()
    if (result.error) throw result.error
    const document = result.data
    if (!document || document.payload?.integrationProvider !== "notaas") return NextResponse.json({ error: "Documento NotaAS nao encontrado." }, { status: 404 })
    if (!document.external_document_id) throw new Error("Documento sem identificador externo.")

    const kind = document.document_kind as NotaAsDocumentKind
    const { apiKey, baseUrl } = notaAsConfiguration(kind)
    const response = await fetch(`${baseUrl}${notaAsDocumentPath(kind, document.external_document_id, rawFormat)}`, {
      headers: { "x-api-key": apiKey, accept: rawFormat === "pdf" ? "application/pdf" : "application/xml,text/xml" },
      cache: "no-store",
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return NextResponse.json({ error: payload.message || payload.error || `NotaAS respondeu HTTP ${response.status}.` }, { status: response.status })
    }
    const extension = rawFormat === "pdf" ? "pdf" : "xml"
    return new Response(response.body, {
      headers: {
        "content-type": response.headers.get("content-type") || (rawFormat === "pdf" ? "application/pdf" : "application/xml"),
        "content-disposition": `inline; filename="nota-${document.document_number || document.external_document_id}.${extension}"`,
        "cache-control": "private, no-store",
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao baixar documento fiscal." }, { status: 500 })
  }
}
