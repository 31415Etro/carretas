import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { currentUserRole } from "@/lib/server-authorization"
import { listAuthorizedCompanies } from "@/lib/system-company-server"
import { SYSTEM_COMPANY_COOKIE, cookieSecure } from "@/lib/system-company"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
  const { role } = await currentUserRole()
  return NextResponse.json({ companies: await listAuthorizedCompanies(user.id, role || "user") })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

  const { companyId } = await request.json()
  const { role } = await currentUserRole()
  const companies = await listAuthorizedCompanies(user.id, role || "user")
  const company = companies.find((item) => item.id === companyId)
  if (!company) return NextResponse.json({ error: "Empresa invalida, inativa ou sem autorizacao para este usuario" }, { status: 400 })

  const response = NextResponse.json({ success: true, company })
  response.cookies.set(SYSTEM_COMPANY_COOKIE, company.id, {
    httpOnly: false,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
