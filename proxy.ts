import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  // Módulos fora do escopo do ERP de carretas
  const removedRoutes = [
    "/analytics",
    "/cadastro",
    "/calendar",
    "/clients",
    "/kanban",
    "/messages",
    "/pmoc",
    "/equipe",
    "/equipe-prestadores",
    "/campo",
    "/operacao-campo",
    "/equipamento",
    "/dashboard/obras",
    "/dashboard/ambientes",
    "/users",
  ]

  if (request.nextUrl.pathname === "/empresas") {
    return NextResponse.redirect(new URL("/configuracoes", request.url))
  }

  const pathname = request.nextUrl.pathname
  if (removedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return updateSession(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
