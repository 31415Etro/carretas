import { NextResponse } from "next/server"
import { asaasConfigurationStatus } from "@/lib/asaas"
import { ASAAS_ALERT_EVENT_TYPES, asaasEventResourceLabel } from "@/lib/asaas-events"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const admin = createAdminClient()
    const [{ data: accounts, error }, { data: documents }, { data: webhookEvents, error: webhookError }] = await Promise.all([
      admin.from("asaas_accounts").select("id,code,name,purpose,environment,enabled,last_statement_sync_at,last_webhook_at").order("code"),
      admin.from("asaas_fiscal_documents").select("id,client_id,document_kind,provider,status,service_order_id,item_code,item_name,value,effective_date,document_number,pdf_url,xml_url,error_message,created_at").order("created_at", { ascending: false }).limit(30),
      admin.from("asaas_webhook_events")
        .select("id,account_id,event_type,resource_type,resource_id,payload,received_at,processing_error")
        .order("received_at", { ascending: false })
        .limit(250),
    ])
    if (error) throw error
    if (webhookError) throw webhookError
    const alerts = (webhookEvents || [])
      .filter((event) => Boolean(event.processing_error) || ASAAS_ALERT_EVENT_TYPES.has(event.event_type))
      .slice(0, 30)
      .map((event) => {
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, any> : {}
        const resource = payload.payment || payload.invoice || payload.transfer || payload.bill || payload.subscription || payload.checkout || payload.pixCredit || {}
        const account = (accounts || []).find((item) => item.id === event.account_id)
        return {
          id: event.id,
          eventType: event.event_type,
          category: asaasEventResourceLabel(event.event_type),
          account: account?.code || "services",
          accountName: account?.name || "Conta Asaas",
          resourceId: event.resource_id,
          description: event.processing_error || resource.description || resource.status || event.event_type,
          value: Number(resource.value || 0),
          receivedAt: event.received_at,
          processingError: event.processing_error,
        }
      })
    return NextResponse.json({
      configuration: [asaasConfigurationStatus("services"), asaasConfigurationStatus("materials")],
      accounts: accounts || [],
      fiscalDocuments: documents || [],
      webhookAlerts: alerts,
      webhookEventCount: (webhookEvents || []).length,
      materialInvoiceProviderConfigured: Boolean(process.env.BASE_ASAAS_NFE_API_KEY && process.env.BASE_ASAAS_NFE_ENDPOINT),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar a integracao Asaas." }, { status: 500 })
  }
}
