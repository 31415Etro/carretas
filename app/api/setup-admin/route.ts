import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

// This endpoint creates/updates the first admin user in Supabase Auth.
// The email/password come from the request body and are stored only by Supabase Auth.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const adminEmail = String(body.email || "").trim().toLowerCase()
    const adminPassword = String(body.password || "")
    const adminName = String(body.name || "Administrador").trim() || "Administrador"

    if (!adminEmail || !adminPassword) {
      return NextResponse.json({ error: "Informe email e password no corpo do POST." }, { status: 400 })
    }

    if (adminPassword.length < 6) {
      return NextResponse.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 })
    }

    // Create Supabase Admin client
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const permissions = [
      "dashboard",
      "clientes_obras",
      "ordens_servico",
      "equipe_prestadores",
      "operacao_campo",
      "frota",
      "estoque",
      "financeiro",
      "comercial",
      "pmoc",
      "orcamento",
      "contratos",
      "relatorios",
      "configuracoes",
      "users",
    ]

    const { count: adminCount, error: countError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")

    if (!countError && (adminCount ?? 0) > 0) {
      return NextResponse.json({ error: "Admin ja existe. Crie novos usuarios pela tela Configuracoes > Usuarios e permissoes." }, { status: 403 })
    }

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuthUser = existingUsers.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase())
    let userId = existingAuthUser?.id

    if (existingAuthUser) {
      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        password: adminPassword,
        email_confirm: true,
        user_metadata: { full_name: adminName, role: "admin", page_permissions: permissions },
      })
      if (updateAuthError) {
        return NextResponse.json({ error: "Failed to update admin user", details: updateAuthError.message }, { status: 500 })
      }
    } else {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: {
          full_name: adminName,
          role: "admin",
          page_permissions: permissions,
        },
      })

      if (authError || !authData.user) {
        return NextResponse.json({ error: "Failed to create admin user", details: authError?.message }, { status: 500 })
      }

      userId = authData.user.id
    }

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      email: adminEmail,
      role: "admin",
      full_name: adminName,
      page_permissions: permissions,
      active: true,
      updated_at: new Date().toISOString(),
    })

    if (profileError) {
      console.error("[v0] Error creating profile:", profileError)
      return NextResponse.json(
        { error: "User created but profile failed", details: profileError.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      message: "Admin user created successfully! You can now login with your credentials.",
      email: adminEmail,
      userId,
    })
  } catch (error: any) {
    console.error("[v0] Setup admin error:", error)
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 })
  }
}
