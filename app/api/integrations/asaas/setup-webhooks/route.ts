import { NextResponse } from "next/server"
import { asaasRequest, getAsaasAccountConfig } from "@/lib/asaas"
import { ASAAS_WEBHOOK_EVENTS } from "@/lib/asaas-events"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const origin = new URL(request.url).origin
    const email = String(process.env.ASAAS_WEBHOOK_EMAIL || "").trim()
    if (!email) throw new Error("Configure ASAAS_WEBHOOK_EMAIL na Vercel.")
    const configured = []
    for (const code of ["services", "materials"] as const) {
      const config = getAsaasAccountConfig(code)
      if (config.webhookToken.length < 32) throw new Error(`O token de webhook de ${config.label.toLowerCase()} precisa ter pelo menos 32 caracteres.`)
      const webhook = await asaasRequest<Record<string, unknown>>(code, "/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: `ERP Carretas - ${config.label}`,
          url: `${origin}/api/integrations/asaas/webhooks/${code}`,
          email,
          enabled: true,
          interrupted: false,
          apiVersion: 3,
          authToken: config.webhookToken,
          sendType: "SEQUENTIALLY",
          events: ASAAS_WEBHOOK_EVENTS,
        }),
      })
      configured.push({ code, id: webhook.id, url: webhook.url })
    }
    return NextResponse.json({ configured })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao configurar webhooks." }, { status: 400 })
  }
}
