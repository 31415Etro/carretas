import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function GET(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) {
      return NextResponse.json([])
    }

    const supabase = await createServerClient()
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: currentProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle()

    if (currentProfile?.role !== "admin") {
      return NextResponse.json({ error: "Somente administradores podem listar usuarios" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role")

    console.log("[v0] Fetching users from Supabase", role ? `with role=${role}` : "")

    let query = supabaseAdmin
      .from("profiles")
      .select(
        `
        *,
        manager:profiles!manager_id(
          id,
          full_name,
          email
        ),
        client:clients!client_id(
          id,
          name,
          corporate_name,
          trade_name
        )
      `,
      )
      .order("created_at", { ascending: false })

    if (role) {
      query = query.eq("role", role)
    }

    const { data: profiles, error } = await query

    if (error) {
      console.error("[v0] Error fetching profiles:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] Fetched profiles:", profiles?.length)

    // Transform profiles to match User interface
    const users = profiles?.map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.email,
      email: profile.email,
      phone: profile.phone || "",
      role: profile.role || "sdr",
      permissions: profile.page_permissions || [],
      createdAt: profile.created_at,
      createdBy: "system",
      active: profile.active !== false,
      managerId: profile.manager_id || null,
      manager: profile.manager || null,
      clientId: profile.client_id || null,
      client: profile.client ? {
        id: profile.client.id,
        name: profile.client.name || profile.client.trade_name || profile.client.corporate_name || "Cliente",
      } : null,
    }))

    if (role) {
      return NextResponse.json(users)
    }

    return NextResponse.json({ users })
  } catch (error) {
    console.error("[v0] Error fetching users:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
