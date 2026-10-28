// Leitura rápida de tabelas grandes no Supabase e cache curto em memória.
// Antes: páginas de 200 linhas, uma depois da outra (~1,5 s cada). Agora: páginas de 1.000 lidas várias de uma vez, e o resultado fica guardado por alguns segundos.

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/** Lê todas as linhas: `concurrency` páginas de `pageSize` ao mesmo tempo, mantendo a ordem. Pare quando uma página vier incompleta. */
export async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<PageResult<T>>, pageSize = 1000, concurrency = 4): Promise<T[]> {
  const out: T[] = []
  for (let start = 0; ; start += pageSize * concurrency) {
    const wave = await Promise.all(Array.from({ length: concurrency }, (_, index) => build(start + index * pageSize, start + (index + 1) * pageSize - 1)))
    let complete = true
    for (const page of wave) {
      if (page.error) throw page.error
      const rows = page.data || []
      out.push(...rows)
      if (rows.length < pageSize) complete = false
    }
    if (!complete) return out
  }
}

const store = new Map<string, { expires: number; value: Promise<unknown> }>()

/** Guarda o resultado de `load` por `ttlMs` (e junta pedidos iguais que chegam ao mesmo tempo). Falha não fica guardada. */
export function memoize<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) return hit.value as Promise<T>
  const value = load().catch((error) => { store.delete(key); throw error })
  store.set(key, { expires: now + ttlMs, value })
  if (store.size > 200) for (const [name, entry] of store) if (entry.expires <= now) store.delete(name)
  return value
}

/** Esquece o que foi guardado (ex.: depois de importar ou excluir notas). */
export function forgetCache(prefix = "") {
  for (const name of [...store.keys()]) if (name.startsWith(prefix)) store.delete(name)
}
