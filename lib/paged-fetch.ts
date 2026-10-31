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

const store = new Map<string, { expires: number; stale: number; value: Promise<unknown>; refreshing?: boolean }>()
const STALE_MS = 60 * 60_000

/**
 * Guarda o resultado de `load` por `ttlMs` (e junta pedidos iguais que chegam ao mesmo tempo). Falha não fica guardada.
 * Passado o prazo, ainda devolve o resultado anterior NA HORA (por até 1 hora) e atualiza por baixo dos panos: a tela abre sem esperar a leitura completa do banco.
 */
export function memoize<T>(key: string, ttlMs: number, load: () => Promise<T>, staleMs = STALE_MS): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expires > now) return hit.value as Promise<T>
  if (hit && hit.stale > now) {
    if (!hit.refreshing) {
      hit.refreshing = true
      load().then((fresh) => store.set(key, { expires: Date.now() + ttlMs, stale: Date.now() + staleMs, value: Promise.resolve(fresh) }), () => { hit.refreshing = false })
    }
    return hit.value as Promise<T>
  }
  const value = load().catch((error) => { store.delete(key); throw error })
  store.set(key, { expires: now + ttlMs, stale: now + staleMs, value })
  if (store.size > 200) for (const [name, entry] of store) if (entry.stale <= now) store.delete(name)
  return value
}

/** Marca o que foi guardado com o prefixo como vencido: o próximo pedido ainda recebe o resultado anterior na hora e dispara a atualização (usado quando o robô importa notas). */
export function staleCache(prefix = "") {
  for (const [name, entry] of store) if (name.startsWith(prefix)) entry.expires = 0
}

/** Esquece o que foi guardado (ex.: depois de importar ou excluir notas). */
export function forgetCache(prefix = "") {
  for (const name of [...store.keys()]) if (name.startsWith(prefix)) store.delete(name)
}
