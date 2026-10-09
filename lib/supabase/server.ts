import { createServerClient as createServerClientSsr } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import {
  DEFAULT_SYSTEM_COMPANY_ID,
  SYSTEM_COMPANY_COOKIE,
  SYSTEM_COMPANY_HEADER,
  sharedMasterTables,
  tenantScopedTables,
} from "@/lib/system-company"

export async function getSelectedSystemCompanyId() {
  try {
    return (await cookies()).get(SYSTEM_COMPANY_COOKIE)?.value || DEFAULT_SYSTEM_COMPANY_ID
  } catch {
    return DEFAULT_SYSTEM_COMPANY_ID
  }
}

function tableFromRestUrl(url: URL) {
  const marker = "/rest/v1/"
  const index = url.pathname.indexOf(marker)
  if (index < 0) return ""
  return decodeURIComponent(url.pathname.slice(index + marker.length).split("/")[0] || "")
}

function withCompanyInBody(body: BodyInit | null | undefined, companyId: string) {
  if (typeof body !== "string") return body
  try {
    const parsed = JSON.parse(body)
    if (Array.isArray(parsed)) return JSON.stringify(parsed.map((row) => ({ ...row, system_company_id: companyId })))
    if (parsed && typeof parsed === "object") return JSON.stringify({ ...parsed, system_company_id: companyId })
  } catch {
    // Non-JSON bodies are used by storage and authentication, never by PostgREST table inserts.
  }
  return body
}

function companyAwareFetch(bypassCompanyScope = false, forcedCompanyId?: string): typeof fetch {
  return async (input, init) => {
    if (bypassCompanyScope) return fetch(input, init)

    const originalUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url
    const url = new URL(originalUrl)
    const table = tableFromRestUrl(url)
    const companyId = forcedCompanyId || await getSelectedSystemCompanyId()
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    headers.set(SYSTEM_COMPANY_HEADER, companyId)
    if (sharedMasterTables.has(table)) return fetch(input, { ...init, headers })
    if (!tenantScopedTables.has(table)) return fetch(input, { ...init, headers })

    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase()

    if (["GET", "HEAD", "PATCH", "PUT", "DELETE"].includes(method)) {
      url.searchParams.set("system_company_id", `eq.${companyId}`)
    }

    const originalBody = init?.body
    const scopedBody = method === "POST" ? withCompanyInBody(originalBody, companyId) : originalBody
    const scopedInit = { ...init, headers, body: scopedBody }
    const response = await fetch(url, scopedInit)

    // Allows the application and the database migration to be deployed independently.
    if (response.status === 400 || response.status === 404) {
      const errorText = await response.clone().text()
      if (errorText.includes("system_company_id")) return fetch(input, init)
    }
    return response
  }
}

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 * Renamed from createClient to createServerClient and added createClient alias
 */
export async function createServerClient() {
  const cookieStore = await cookies()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createServerClientSsr(supabaseUrl, supabaseKey, {
    global: { fetch: companyAwareFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The "setAll" method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}

export const createClient = createServerClient

/**
 * Creates a Supabase client with admin privileges (bypasses RLS)
 * Only use this for admin operations like managing other users
 */
export function createAdminClient(options: { bypassCompanyScope?: boolean; companyId?: string } = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
  }

  return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: companyAwareFetch(options.bypassCompanyScope, options.companyId) },
  })
}

export async function createAdminClientForServiceOrder(serviceOrderId: string) {
  const unscoped = createAdminClient({ bypassCompanyScope: true })
  const result = await unscoped.from("service_orders").select("id,system_company_id").eq("id", serviceOrderId).maybeSingle()
  if (result.error?.message.includes("system_company_id")) {
    const legacy = await unscoped.from("service_orders").select("id").eq("id", serviceOrderId).maybeSingle()
    if (legacy.error) throw legacy.error
    return { client: createAdminClient(), exists: Boolean(legacy.data) }
  }
  if (result.error) throw result.error
  return {
    client: createAdminClient({ companyId: result.data?.system_company_id || DEFAULT_SYSTEM_COMPANY_ID }),
    exists: Boolean(result.data),
  }
}
