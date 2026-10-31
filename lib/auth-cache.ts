import type { SupabaseClient, User } from "@supabase/supabase-js"

// Cada requisição refazia, no servidor, a consulta de quem é o usuário (GoTrue), do perfil e das empresas autorizadas — no proxy e depois de novo na rota.
// Aqui o resultado fica guardado por 30 segundos por token de acesso: o token continua sendo validado no GoTrue a cada 30 s (sair/ser desativado vale em até 30 s).
const TTL_MS = 30_000
type Store = { users: Map<string, { user: User; expires: number }>; values: Map<string, { value: unknown; expires: number }> }
const shared = globalThis as unknown as { __ndAuthCache?: Store }
const store: Store = (shared.__ndAuthCache ||= { users: new Map(), values: new Map() })

function sweep(map: Map<string, { expires: number }>) {
  if (map.size < 500) return
  const now = Date.now()
  for (const [key, entry] of map) if (entry.expires <= now) map.delete(key)
}

/** Usuário autenticado (validado no GoTrue no máximo uma vez a cada 30 s por sessão). */
export async function cachedUser(client: SupabaseClient): Promise<User | null> {
  let token = ""
  try { token = (await client.auth.getSession()).data.session?.access_token || "" } catch { token = "" }
  if (!token) return (await client.auth.getUser()).data.user ?? null
  const hit = store.users.get(token)
  if (hit && hit.expires > Date.now()) return hit.user
  const user = (await client.auth.getUser()).data.user ?? null
  if (user) { store.users.set(token, { user, expires: Date.now() + TTL_MS }); sweep(store.users) } else store.users.delete(token)
  return user
}

/** Guarda por 30 s o resultado de uma consulta de perfil/permissão (a chave inclui o usuário). */
export async function cachedLookup<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.values.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as T
  const value = await load()
  store.values.set(key, { value, expires: Date.now() + TTL_MS })
  sweep(store.values)
  return value
}

/** Esquece perfis guardados (ex.: depois de mudar permissões de um usuário). */
export function forgetLookups(prefix = "") {
  for (const key of [...store.values.keys()]) if (key.startsWith(prefix)) store.values.delete(key)
}
