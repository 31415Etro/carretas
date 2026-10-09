import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"
import { SYSTEM_COMPANY_COOKIE } from "@/lib/system-company"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
  return NextResponse.json({ companies: await listSystemCompanies(true) })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })

  const { companyId } = await request.json()
  const companies = await listSystemCompanies(true)
  const company = companies.find((item) => item.id === companyId)
  if (!company) return NextResponse.json({ error: "Empresa invalida ou inativa" }, { status: 400 })

  const response = NextResponse.json({ success: true, company })
  response.cookies.set(SYSTEM_COMPANY_COOKIE, company.id, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
