import { cachedLookup, cachedUser } from "@/lib/auth-cache"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export async function currentUserRole() {
  const session = await createClient()
  const user = await cachedUser(session)
  if (!user) return { user: null, role: "" }
  const admin = createAdminClient()
  const profile = await cachedLookup(`role|${user.id}`, async () => (await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle()).data)
  if (!profile || profile.active === false) return { user: null, role: "" }
  return { user, role: String(profile.role || "user") }
}

export async function isCurrentUserAdmin() {
  const { user, role } = await currentUserRole()
  return Boolean(user && role === "admin")
}
