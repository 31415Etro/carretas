import { createBrowserClient } from "@supabase/ssr"
import { DEFAULT_SYSTEM_COMPANY_ID, SYSTEM_COMPANY_COOKIE, SYSTEM_COMPANY_HEADER } from "@/lib/system-company"

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase client is disabled because environment variables are missing")
  }

  client = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    global: {
      fetch: async (input, init) => {
        const companyId = document.cookie
          .split("; ")
          .find((item) => item.startsWith(`${SYSTEM_COMPANY_COOKIE}=`))
          ?.split("=")[1] || DEFAULT_SYSTEM_COMPANY_ID
        const headers = new Headers(input instanceof Request ? input.headers : undefined)
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
        headers.set(SYSTEM_COMPANY_HEADER, decodeURIComponent(companyId))
        headers.set("x-client-info", "supabase-ssr")
        return fetch(input, { ...init, headers })
      },
    },
  })
  return client
}
