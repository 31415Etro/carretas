import { NextResponse } from "next/server"
import { isAsaasAccountCode, verifyAsaasWebhookToken } from "@/lib/asaas"
import { processAsaasWebhook } from "@/lib/asaas-server"

export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params
  if (!isAsaasAccountCode(account)) return NextResponse.json({ error: "Conta Asaas invalida." }, { status: 404 })
  if (!verifyAsaasWebhookToken(account, request.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "Token de webhook invalido." }, { status: 401 })
  }
  try {
    const payload = await request.json()
    const result = await processAsaasWebhook(account, payload)
    return NextResponse.json({ received: true, ...result })
  } catch (error) {
    console.error(`Webhook Asaas ${account}:`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao processar webhook." }, { status: 500 })
  }
}
