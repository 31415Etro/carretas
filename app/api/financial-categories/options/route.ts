import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })

    const supabase = createAdminClient()
    const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle()
    if (!profile || profile.active === false || profile.role === "client") {
      return NextResponse.json({ error: "Acesso restrito as categorias de fornecedores." }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("financial_categories")
      .select("id,name")
      .eq("status", "Ativo")
      .eq("type", "saida")
      .order("name", { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ categories: data || [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar categorias." }, { status: 500 })
  }
}
