"use server"

import { createClient } from "@supabase/supabase-js"

// Client com service role para garantir acesso sem depender de sessão
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function getUsersByRole(role: "sdr" | "closer" | "admin") {
  const supabase = createServiceClient()

  try {
    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("role", role)
      .order("full_name")

    if (error) return []
    return users || []
  } catch {
    return []
  }
}

export async function getAllUsers() {
  const supabase = createServiceClient()

  try {
    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name")

    if (error) return []
    return users || []
  } catch {
    return []
  }
}

export async function getUsers() {
  const supabase = createServiceClient()

  try {
    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name")

    if (error) return { data: [], error }
    return { data: users || [], error: null }
  } catch (error) {
    return { data: [], error }
  }
}
