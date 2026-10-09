import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para consultar fornecedores." }, { status: 403 })

  try {
    const supabase = createAdminClient()
    const rows = await readAllPages<any>((from, to) => supabase.from("suppliers").select("id,name,document,status").order("name").order("id").range(from, to))
    return NextResponse.json({ suppliers: rows.map((row) => ({ id: row.id, name: row.name, document: row.document || "", status: row.status || "Ativo" })) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar fornecedores." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para cadastrar fornecedores." }, { status: 403 })

  try {
    const { supplier: input } = await request.json()
    if (!input || !uuid.test(input.id || "") || !String(input.name || "").trim() || !String(input.phone || "").trim()) {
      return NextResponse.json({ error: "Informe fornecedor, telefone e um identificador valido." }, { status: 400 })
    }
    const categoryIds = Array.from(new Set((Array.isArray(input.categoryIds) ? input.categoryIds : []).filter((id: unknown) => uuid.test(String(id)))))
    const row = {
      id: input.id, name: String(input.name).trim(), document: input.document || "", contact_name: input.contactName || "",
      phone: String(input.phone).trim(), email: input.email || "", category: input.category || "", category_ids: categoryIds,
      city: input.city || "", state: input.state || "", status: input.status === "Inativo" ? "Inativo" : "Ativo", notes: input.notes || "",
    }
    const { data, error } = await createAdminClient().from("suppliers").upsert(row, { onConflict: "id" }).select("*").single()
    if (error) throw new Error(`suppliers: ${error.message}`)
    return NextResponse.json({ supplier: {
      id: data.id, name: data.name, document: data.document || "", contactName: data.contact_name || "", phone: data.phone || "",
      email: data.email || "", category: data.category || "", categoryIds: Array.isArray(data.category_ids) ? data.category_ids : [],
      city: data.city || "", state: data.state || "", status: data.status || "Ativo", notes: data.notes || "",
      createdAt: data.created_at, updatedAt: data.updated_at,
    } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar fornecedor." }, { status: 400 })
  }
}
