import { NextResponse } from "next/server"
import { notaAsPublicStatus, notaAsRequest, notaAsStatusPath, type NotaAsDocumentKind } from "@/lib/notaas"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

function errorText(payload: Record<string, any>) {
  if (typeof payload.errorMessage === "string") return payload.errorMessage
  if (typeof payload.xMotivo === "string" && String(payload.status).toLowerCase() === "error") return payload.xMotivo
  if (typeof payload.error === "string") return payload.error
  if (typeof payload.message === "string" && String(payload.status).toLowerCase() === "error") return payload.message
  if (Array.isArray(payload.errors)) return payload.errors.map((item: any) => item?.message || item?.detail || item?.Descricao || item?.descricao || String(item)).join("; ")
  return null
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const admin = createAdminClient()
    const result = await admin.from("asaas_fiscal_documents")
      .select("id,client_id,document_kind,provider,status,service_order_id,item_code,item_name,value,effective_date,document_number,pdf_url,xml_url,error_message,external_document_id,payload,created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (result.error) throw result.error
    const notaAsDocuments = (result.data || []).filter((row) => row.payload?.integrationProvider === "notaas")

    const refreshed = await Promise.all(notaAsDocuments.map(async (row) => {
      const kind = row.document_kind as NotaAsDocumentKind
      let statusPayload = row.payload?.statusResponse || row.payload?.response || {}
      const currentStatus = String(row.status || "").toLowerCase()
      if (row.external_document_id && ["queued", "processing", "pending", "na fila", "processando"].includes(currentStatus)) {
        try {
          statusPayload = await notaAsRequest<Record<string, any>>(kind, notaAsStatusPath(kind, row.external_document_id))
          const nextStatus = statusPayload.status || row.status
          const update = {
            status: nextStatus,
            document_number: statusPayload.number || statusPayload.numero || statusPayload.numeroNfe || statusPayload.nNf || row.document_number,
            validation_code: statusPayload.validationCode || statusPayload.codigoVerificacao || statusPayload.chNFSe || statusPayload.chaveAcesso || null,
            pdf_url: statusPayload.pdfUrl || row.pdf_url,
            xml_url: statusPayload.xmlUrl || row.xml_url,
            error_message: errorText(statusPayload),
            payload: { ...row.payload, statusResponse: statusPayload },
          }
          const updated = await admin.from("asaas_fiscal_documents").update(update).eq("id", row.id)
          if (updated.error) throw updated.error
        } catch (error) {
          statusPayload = { ...statusPayload, pollError: error instanceof Error ? error.message : "Falha ao consultar status." }
        }
      }
      const status = statusPayload.status || row.status
      const issued = String(status).toLowerCase() === "issued"
      return {
        ...row,
        provider: kind === "service" ? "notaas_nfse" : "notaas_nfe",
        status,
        status_label: notaAsPublicStatus(status),
        document_number: statusPayload.number || statusPayload.numero || statusPayload.numeroNfe || statusPayload.nNf || row.document_number,
        error_message: errorText(statusPayload) || statusPayload.pollError || row.error_message,
        pdf_url: issued || row.pdf_url ? `/api/integrations/notaas/documents/${row.id}/pdf` : null,
        xml_url: issued || row.xml_url ? `/api/integrations/notaas/documents/${row.id}/xml` : null,
        payload: undefined,
      }
    }))
    return NextResponse.json({
      configuration: {
        services: Boolean(process.env.NOTAAS_SERVICES_API_KEY),
        materials: Boolean(process.env.NOTAAS_MATERIALS_API_KEY),
      },
      fiscalDocuments: refreshed,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar notas no NotaAS." }, { status: 500 })
  }
}
