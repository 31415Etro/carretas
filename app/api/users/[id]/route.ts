import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { systemPagePermissions } from "@/lib/types"

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const session = await createClient()
    const { data: { user: currentUser } } = await session.auth.getUser()
    if (!currentUser) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    const { data: currentProfile } = await supabase.from("profiles").select("role").eq("id", currentUser.id).maybeSingle()
    if (currentProfile?.role !== "admin") return NextResponse.json({ error: "Acesso negado" }, { status: 403 })

    const body = await request.json()
    const { name, email, password, role, permissions, managerId, phone, clientId, active } = body
    const selectedPermissions = (Array.isArray(permissions) ? permissions : []).filter((permission) => systemPagePermissions.includes(permission))
    const effectivePermissions = role === "admin"
      ? systemPagePermissions
      : selectedPermissions

    if (role === "client" && !clientId) {
      return NextResponse.json({ error: "Selecione o cliente vinculado ao usuario" }, { status: 400 })
    }
    if (role !== "admin" && !effectivePermissions.length) {
      return NextResponse.json({ error: "Selecione pelo menos uma pagina permitida" }, { status: 400 })
    }
    if (role === "client") {
      const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle()
      if (!client) return NextResponse.json({ error: "Cliente vinculado nao encontrado" }, { status: 400 })
    }

    const { data: existingProfile, error: checkError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle()

    if (checkError) {
      console.error("[v0] Error checking profile:", checkError)
      return NextResponse.json({ error: checkError.message }, { status: 500 })
    }

    const updateData: any = {
      full_name: name,
      email,
      phone: phone || null,
      role,
      page_permissions: effectivePermissions,
      client_id: role === "client" ? clientId : null,
      active: active !== false,
      updated_at: new Date().toISOString(),
    }

    if (role === "representative" && managerId && managerId !== "none") {
      updateData.manager_id = managerId
    } else if (role !== "representative") {
      // Clear manager_id if role is not representative
      updateData.manager_id = null
    }

    if (password && password.length < 6) {
      return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres" }, { status: 400 })
    }

    if (password || email) {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(id, {
        email,
        ...(password ? { password } : {}),
        user_metadata: {
          full_name: name,
          role,
          page_permissions: effectivePermissions,
          client_id: role === "client" ? clientId : null,
        },
      })
      if (authUpdateError) return NextResponse.json({ error: authUpdateError.message }, { status: 400 })
    }

    let data, error

    if (!existingProfile) {
      updateData.id = id
      updateData.created_at = new Date().toISOString()

      const result = await supabase.from("profiles").insert(updateData).select().maybeSingle()
      data = result.data
      error = result.error
    } else {
      const result = await supabase.from("profiles").update(updateData).eq("id", id).select().maybeSingle()
      data = result.data
      error = result.error

      if (!data && !error) {
        updateData.id = id
        updateData.created_at = new Date().toISOString()
        const createResult = await supabase.from("profiles").insert(updateData).select().maybeSingle()
        data = createResult.data
        error = createResult.error
      }
    }

    if (error) {
      console.error("[v0] Error saving user:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      console.error("[v0] No data returned after save operation")
      return NextResponse.json({ error: "Failed to save user data" }, { status: 500 })
    }

    return NextResponse.json({ success: true, user: data })
  } catch (error: any) {
    console.error("[v0] Error updating user:", error.message)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
