import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/** Expurgo por retenção (diário). Protegido por CRON_SECRET; só a função purge_audit_events() consegue apagar eventos. */
export async function GET(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim()
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  const { data, error } = await createAdminClient({ bypassCompanyScope: true }).rpc("purge_audit_events")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed: Number(data || 0) })
}
