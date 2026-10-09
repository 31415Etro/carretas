import { createClient } from "@/lib/supabase/client"

export async function fetchLeadsFromAPI(): Promise<{ data: any[]; error?: string }> {
  try {
    // Get the access token from the browser Supabase client
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    const headers: Record<string, string> = {}
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const res = await fetch("/api/leads", { headers })
    if (!res.ok) {
      return { data: [], error: "Failed to fetch leads" }
    }
    const json = await res.json()
    return { data: json.data || [], error: json.error }
  } catch (err: any) {
    return { data: [], error: err?.message || "Network error" }
  }
}
