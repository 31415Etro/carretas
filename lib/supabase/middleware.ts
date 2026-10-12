import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { clientIp, logAuditEdge, originFor, sessionIdFromToken, withAuditHeaders } from "@/lib/audit-edge"

const publicPaths = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/user",
  "/api/auth/companies",
  // Agendador de contratos: autenticado por CRON_SECRET dentro da própria rota.
  "/api/contratos/cron",
  "/api/relatorios/cron",
  "/api/auditoria/cron",
  "/api/notificacoes/cron",
]

const pagePermissions = [
  { prefix: "/dashboard", permission: "dashboard" },
  { prefix: "/clientes", permission: "comercial" },
  { prefix: "/servicos", permission: "produtos_servicos" },
  { prefix: "/ordens-servico", permission: "ordens_servico" },
  { prefix: "/frota", permission: "frota" },
  { prefix: "/estoque", permission: "estoque" },
  { prefix: "/compras", permission: "compras" },
  { prefix: "/financeiro", permission: "financeiro" },
  { prefix: "/comercial", permission: "comercial" },
  { prefix: "/orcamento", permission: "orcamento" },
  { prefix: "/contratos", permission: "contratos" },
  { prefix: "/relatorios", permission: "relatorios" },
  { prefix: "/configuracoes", permission: "configuracoes" },
] as const

function isPublicPath(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function redirectWithCookies(request: NextRequest, pathname: string, source: NextResponse, returnTo = false) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ""
  if (returnTo && request.nextUrl.pathname !== "/") url.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`)
  const response = NextResponse.redirect(url)
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Contexto de auditoria: usuário, IP, sessão e requisição seguem para as rotas e para o banco (cabeçalhos x-audit-*).
  // Valores vindos do cliente são descartados; só valem os verificados aqui.
  let sessionToken: string | null | undefined
  try {
    sessionToken = (await supabase.auth.getSession()).data.session?.access_token
  } catch {
    sessionToken = null
  }
  const audit = { actorId: user?.id || "", actorEmail: user?.email || "", ip: clientIp(request.headers), session: sessionIdFromToken(sessionToken), request: crypto.randomUUID(), origin: originFor(pathname, Boolean(user)) }
  const forwarded = NextResponse.next({ request: { headers: withAuditHeaders(request.headers, audit) } })
  supabaseResponse.cookies.getAll().forEach((cookie) => forwarded.cookies.set(cookie))
  supabaseResponse = forwarded

  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
    return redirectWithCookies(request, "/login", supabaseResponse, true)
  }

  if (!user) return supabaseResponse

  const hasSelectedCompany = Boolean(request.cookies.get("system_company_id")?.value)
  if (!hasSelectedCompany && pathname !== "/login" && !pathname.startsWith("/api/auth/")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Selecione a empresa" }, { status: 409 })
    return redirectWithCookies(request, "/login", supabaseResponse, true)
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,page_permissions,active")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || profile.active === false) {
    await supabase.auth.signOut()
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Usuario inativo ou sem perfil" }, { status: 403 })
    return redirectWithCookies(request, "/login", supabaseResponse)
  }

  // empresa do cookie precisa estar entre as autorizadas (perfil sem vínculos mantém todas)
  if (profile.role !== "admin" && hasSelectedCompany) {
    const { data: links } = await supabase.from("profile_companies").select("company_id").eq("profile_id", user.id)
    if (links && links.length && !links.some((link) => link.company_id === request.cookies.get("system_company_id")?.value)) {
      await logAuditEdge({ companyId: request.cookies.get("system_company_id")?.value, actorId: audit.actorId, actorEmail: audit.actorEmail, module: "acesso", action: "Acesso negado", description: "Tentativa de usar uma empresa sem autorização.", result: "Negado", ip: audit.ip, session: audit.session, request: audit.request })
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Empresa nao autorizada para este usuario" }, { status: 403 })
      return redirectWithCookies(request, "/login", supabaseResponse)
    }
  }

  const storedPermissions = Array.isArray(profile.page_permissions) ? profile.page_permissions : []
  const permissions = storedPermissions
  const firstAllowed = pagePermissions.find((page) => permissions.includes(page.permission))?.prefix || "/acesso-negado"

  if (pathname === "/" || (pathname === "/login" && hasSelectedCompany)) {
    return redirectWithCookies(request, profile.role === "admin" ? "/dashboard" : firstAllowed, supabaseResponse)
  }

  const page = pagePermissions.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`))
  if (page && profile.role !== "admin" && !permissions.includes(page.permission)) {
    await logAuditEdge({ companyId: request.cookies.get("system_company_id")?.value, actorId: audit.actorId, actorEmail: audit.actorEmail, module: "acesso", action: "Acesso negado", description: `Tentativa de abrir ${pathname} sem a permissão "${page.permission}".`, result: "Negado", ip: audit.ip, session: audit.session, request: audit.request })
    return redirectWithCookies(request, firstAllowed, supabaseResponse)
  }

  return supabaseResponse
}
