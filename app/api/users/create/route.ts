import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { systemPagePermissions } from "@/lib/types"

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase desabilitado temporariamente" }, { status: 503 })
    }

    console.log("[v0] User creation API called")

    const supabase = await createServerClient()
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    if (!currentUser) {
      const { count, error: countError } = await supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
      if (countError || (count ?? 0) > 0) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    } else {
      const { data: currentProfile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", currentUser.id)
        .maybeSingle()
      if (currentProfile?.role !== "admin") {
        return NextResponse.json({ error: "Somente administradores podem criar usuarios" }, { status: 403 })
      }
    }

    const body = await request.json()
    const { email, password, name, role, permissions, managerId, phone, clientId } = body
    const selectedPermissions = (Array.isArray(permissions) ? permissions : []).filter((permission) => systemPagePermissions.includes(permission))
    const effectivePermissions = role === "admin"
      ? systemPagePermissions
      : selectedPermissions

    console.log("[v0] Creating user:", { email, name, role, managerId, phone })

    // Validate required fields
    if (!email || !password || !name || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (role === "client" && !clientId) {
      return NextResponse.json({ error: "Selecione o cliente vinculado ao usuario" }, { status: 400 })
    }
    if (role !== "admin" && !effectivePermissions.length) {
      return NextResponse.json({ error: "Selecione pelo menos uma pagina permitida" }, { status: 400 })
    }

    if (role === "client") {
      const { data: client } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle()
      if (!client) return NextResponse.json({ error: "Cliente vinculado nao encontrado" }, { status: 400 })
    }

    // Validate password strength
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
    }

    const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers()
    const userExists = existingUser.users.some((u) => u.email === email)

    if (userExists) {
      console.error("[v0] User with this email already exists")
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 })
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        role: role,
        page_permissions: effectivePermissions,
        client_id: role === "client" ? clientId : null,
      },
    })

    if (authError) {
      console.error("[v0] Auth error:", authError.message)
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    console.log("[v0] User created in auth:", authData.user.id)

    // Wait for trigger to potentially create profile
    await new Promise((resolve) => setTimeout(resolve, 500))

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .single()

    if (!existingProfile) {
      const profileData: any = {
        id: authData.user.id,
        email,
        full_name: name,
        phone: phone || null,
        role,
        page_permissions: effectivePermissions,
        client_id: role === "client" ? clientId : null,
        created_by: currentUser?.id || null,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      // Only set manager_id if role is representative and managerId is provided
      if (role === "representative" && managerId && managerId !== "none") {
        profileData.manager_id = managerId
      }

      const { error: profileError } = await supabaseAdmin.from("profiles").insert(profileData)

      if (profileError) {
        console.error("[v0] Profile error:", profileError.message)
        // If profile creation fails, delete the auth user
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json({ error: "Failed to create user profile: " + profileError.message }, { status: 500 })
      }

      console.log("[v0] Profile created successfully")
    } else {
      console.log("[v0] Profile already exists (created by trigger)")

      const updateData: any = {
        created_by: currentUser?.id || null,
        page_permissions: effectivePermissions,
        phone: phone || null,
        client_id: role === "client" ? clientId : null,
      }

      // Only update manager_id if role is representative
      if (role === "representative" && managerId && managerId !== "none") {
        updateData.manager_id = managerId
      } else if (role !== "representative") {
        // Clear manager_id if role is not representative
        updateData.manager_id = null
      }

      await supabaseAdmin.from("profiles").update(updateData).eq("id", authData.user.id)
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email,
        name,
        role,
        permissions: effectivePermissions,
        managerId: role === "representative" && managerId && managerId !== "none" ? managerId : null,
        clientId: role === "client" ? clientId : null,
      },
    })
  } catch (error) {
    console.error("[v0] Error creating user:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}
