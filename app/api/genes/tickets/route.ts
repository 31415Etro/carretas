import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const GENES_TICKETS_ENDPOINT = "https://genesgroup.vercel.app/api/integrations/mc-climatizacao/tickets"

type TicketInput = {
  componentCode?: unknown
  description?: unknown
  costAcknowledged?: unknown
  inDevelopment?: unknown
  context?: {
    pathname?: unknown
    pageTitle?: unknown
    componentType?: unknown
    componentLabel?: unknown
    componentSelector?: unknown
    url?: unknown
  }
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength)
}

function cleanApiKey(value: string | undefined) {
  let key = String(value || "").trim()
  key = key.replace(/^GENES_MC_TICKETS_API_KEY\s*=\s*/i, "")
  key = key.replace(/^Bearer\s+/i, "").trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim()
  }
  return key
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Usuário não autenticado." }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name,email,active")
      .eq("id", user.id)
      .maybeSingle()

    if (!profile || profile.active === false) {
      return NextResponse.json({ error: "Usuário inativo ou sem perfil." }, { status: 403 })
    }

    const apiKey = cleanApiKey(process.env.GENES_MC_TICKETS_API_KEY)
    if (!apiKey) {
      return NextResponse.json({ error: "Integração com a Genes ainda não configurada no servidor." }, { status: 503 })
    }

    const input = await request.json() as TicketInput
    const componentCode = cleanText(input.componentCode, 120)
    const description = cleanText(input.description, 5000)
    if (!componentCode || !description || input.costAcknowledged !== true) {
      return NextResponse.json({ error: "Componente, descrição e confirmação de custo são obrigatórios." }, { status: 400 })
    }

    const context = input.context || {}
    const contextLines = [
      cleanText(context.pageTitle, 160) ? `Página: ${cleanText(context.pageTitle, 160)}` : "",
      cleanText(context.pathname, 300) ? `Rota: ${cleanText(context.pathname, 300)}` : "",
      cleanText(context.componentType, 80) ? `Tipo do componente: ${cleanText(context.componentType, 80)}` : "",
      cleanText(context.componentLabel, 300) ? `Componente selecionado: ${cleanText(context.componentLabel, 300)}` : "",
      cleanText(context.componentSelector, 500) ? `Referência técnica: ${cleanText(context.componentSelector, 500)}` : "",
      cleanText(context.url, 800) ? `URL: ${cleanText(context.url, 800)}` : "",
    ].filter(Boolean)

    const genesResponse = await fetch(GENES_TICKETS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        component_code: componentCode,
        description: contextLines.length ? `${description}\n\nContexto automático:\n${contextLines.join("\n")}` : description,
        cost_acknowledged: true,
        requester_name: profile.full_name || profile.email || user.email || "Usuário MC Climatização",
        in_development: input.inDevelopment === true,
      }),
      signal: AbortSignal.timeout(15000),
    })

    const payload = await genesResponse.json().catch(() => ({}))
    if (!genesResponse.ok) {
      const errorMessage = genesResponse.status === 401
        ? "A Genes rejeitou a chave. Confirme se foi usada a chave de chamados da integração MC Climatização, e não a chave do agente de IA."
        : payload?.error || payload?.message || "A Genes não aceitou o chamado."
      return NextResponse.json({ error: errorMessage }, { status: genesResponse.status })
    }

    return NextResponse.json({ task_id: payload.task_id, os_number: payload.os_number }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "A Genes demorou para responder. Tente novamente."
      : error instanceof Error ? error.message : "Erro ao abrir chamado na Genes."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
