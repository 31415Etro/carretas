import { createAdminClient, createClient } from "@/lib/supabase/server"

export async function currentUserRole() {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) return { user: null, role: "" }
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle()
  if (!profile || profile.active === false) return { user: null, role: "" }
  return { user, role: String(profile.role || "user") }
}

export async function isCurrentUserAdmin() {
  const { user, role } = await currentUserRole()
  return Boolean(user && role === "admin")
}
