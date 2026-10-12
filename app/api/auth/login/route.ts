import { NextResponse } from "next/server"
import { audit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { SYSTEM_COMPANY_COOKIE } from "@/lib/system-company"

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()
    console.log("[v0] Login API called with email:", email)

    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error("[v0] Login error:", error.message)
      await audit({ module: "acesso", action: "Login", description: `Falha de login para ${String(email || "").slice(0, 120)}: credenciais inválidas ou conta bloqueada.`, result: "Falha", actorEmail: String(email || "").slice(0, 120), companyId: null, origin: "Usuário" })
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    if (!data.user || !data.session) {
      return NextResponse.json({ error: "Login failed" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id,active")
      .eq("id", data.user.id)
      .maybeSingle()
    if (!profile || profile.active === false) {
      await supabase.auth.signOut()
      await audit({ module: "acesso", action: "Login", description: `Login negado para ${String(email || "").slice(0, 120)}: usuário inativo ou sem perfil.`, result: "Negado", actorId: data.user.id, actorEmail: String(email || "").slice(0, 120), companyId: null, origin: "Usuário" })
      return NextResponse.json({ error: "Usuario inativo ou sem perfil de acesso" }, { status: 403 })
    }
    await audit({ module: "acesso", action: "Login", description: `Login de ${String(data.user.email || "").slice(0, 120)}.`, actorId: data.user.id, actorEmail: String(data.user.email || ""), companyId: null, origin: "Usuário" })

    console.log("[v0] Login successful for user:", data.user.id)

    const response = NextResponse.json({
      success: true,
      requiresCompanySelection: true,
      companies: await listSystemCompanies(true),
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    })
    response.cookies.delete(SYSTEM_COMPANY_COOKIE)
    return response
  } catch (error) {
    console.error("[v0] Login exception:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
