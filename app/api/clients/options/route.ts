import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle()
  if (profile?.role !== "admin") return NextResponse.json({ error: "Acesso negado" }, { status: 403 })

  const { data, error } = await admin
    .from("clients")
    .select("id, name, corporate_name, trade_name, status")
    .order("name", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const clients = (data || []).map((client) => ({
    id: client.id,
    name: client.name || client.trade_name || client.corporate_name || "Cliente sem nome",
  }))

  return NextResponse.json({ clients })
}
