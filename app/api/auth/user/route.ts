import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { listSystemCompanies, getSelectedSystemCompany } from "@/lib/system-company-server"
import { SYSTEM_COMPANY_COOKIE } from "@/lib/system-company"
import { cookies } from "next/headers"

export async function GET() {
  try {
    console.log("[v0] GET /api/auth/user called")
    const supabase = await createClient()

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    console.log("[v0] Auth user check:", {
      hasUser: !!authUser,
      userId: authUser?.id,
      error: authError?.message,
    })

    if (authError || !authUser) {
      console.log("[v0] No authenticated user found")
      return NextResponse.json({ user: null })
    }

    console.log("[v0] Fetching profile for user:", authUser.id)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single()

    console.log("[v0] Profile fetch result:", {
      hasProfile: !!profile,
      profileEmail: profile?.email,
      error: profileError?.message,
    })

    if (profileError) {
      console.error("[v0] Profile fetch error:", profileError)
      return NextResponse.json({ user: null })
    }

    if (!profile || profile.active === false) {
      console.error("[v0] No profile found for user:", authUser.id)
      return NextResponse.json({ user: null })
    }

    const storedPermissions = Array.isArray(profile.page_permissions) ? profile.page_permissions : []
    const user = {
      id: authUser.id,
      name: profile.full_name || authUser.email?.split("@")[0] || "User",
      email: profile.email || authUser.email || "",
      role: profile.role || "user",
      permissions: storedPermissions,
      clientId: profile.client_id || null,
    }

    const companies = await listSystemCompanies(true)
    const selectedCookie = (await cookies()).get(SYSTEM_COMPANY_COOKIE)?.value
    if (!selectedCookie || !companies.some((item) => item.id === selectedCookie)) {
      return NextResponse.json({ user: null, authenticated: true, requiresCompanySelection: true, companies })
    }
    const company = await getSelectedSystemCompany(companies)
    console.log("[v0] Returning user data:", { id: user.id, email: user.email, role: user.role, companyId: company.id })
    const response = NextResponse.json({ user: { ...user, company }, companies })
    response.cookies.set(SYSTEM_COMPANY_COOKIE, company.id, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    })
    return response
  } catch (error) {
    console.error("[v0] Get user exception:", error)
    return NextResponse.json({ user: null })
  }
}
