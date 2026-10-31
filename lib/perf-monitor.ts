import http from "node:http"
import fs from "node:fs"
import path from "node:path"

// Monitor de lentidão: mede o tempo de TODA requisição atendida pelo servidor (páginas e APIs), soma por rota e guarda as lentas (a partir de 1 s).
// Roda só no servidor Node (instrumentation.ts instala o gancho); os dados ficam em memória e num arquivo, para sobreviver a reinício.
export const SLOW_MS = Number(process.env.PERF_SLOW_MS || 1000)
const MAX_SLOW = 1500
const FILE = process.env.PERF_LOG_FILE || path.join(process.cwd(), ".perf-monitor.json")

export type SlowEntry = { at: string; method: string; route: string; url: string; status: number; ms: number }
export type RouteStat = { route: string; count: number; totalMs: number; maxMs: number; slow: number; lastSlowAt: string; samples: number[] }
type State = { since: string; slow: SlowEntry[]; routes: Record<string, RouteStat>; dirty: boolean; loaded: boolean; timer?: ReturnType<typeof setInterval> }
const shared = globalThis as unknown as { __ndPerf?: State; __ndPerfHook?: boolean }
const state: State = (shared.__ndPerf ||= { since: new Date().toISOString(), slow: [], routes: {}, dirty: false, loaded: false })

function load() {
  if (state.loaded) return
  state.loaded = true
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<State>
    if (saved.since) state.since = saved.since
    if (Array.isArray(saved.slow)) state.slow = saved.slow.concat(state.slow).slice(-MAX_SLOW)
    if (saved.routes) for (const [key, value] of Object.entries(saved.routes)) if (!state.routes[key]) state.routes[key] = value
  } catch { /* primeiro uso ou arquivo ilegível: começa vazio */ }
}

function save() {
  if (!state.dirty) return
  state.dirty = false
  try { fs.writeFileSync(FILE, JSON.stringify({ since: state.since, slow: state.slow, routes: state.routes })) } catch { /* pasta sem escrita (ex.: Vercel): fica só em memória */ }
}

/** Rota sem IDs e sem parâmetros, para somar chamadas iguais (/api/os/123 -> /api/os/:id). */
export function normalizeRoute(pathname: string) {
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/\d{3,}(?=\/|$)/g, "/:id") || "/"
}

export function recordRequest(method: string, rawUrl: string, status: number, ms: number) {
  load()
  const [pathname, query = ""] = rawUrl.split("?")
  if (pathname.startsWith("/_next/") || /\.(?:png|jpe?g|svg|ico|webp|gif|css|js|map|woff2?|traineddata|gz|wasm)$/i.test(pathname)) return
  const route = `${method === "GET" || method === "HEAD" ? "" : `${method} `}${normalizeRoute(pathname)}`
  const stat = (state.routes[route] ||= { route, count: 0, totalMs: 0, maxMs: 0, slow: 0, lastSlowAt: "", samples: [] })
  stat.count += 1; stat.totalMs += ms; stat.maxMs = Math.max(stat.maxMs, ms)
  stat.samples.push(Math.round(ms)); if (stat.samples.length > 200) stat.samples.shift() // últimas 200 medidas: base do p95
  if (ms >= SLOW_MS) {
    const at = new Date().toISOString()
    stat.slow += 1; stat.lastSlowAt = at
    state.slow.push({ at, method, route: normalizeRoute(pathname), url: `${pathname}${query ? `?${query.slice(0, 160)}` : ""}`, status, ms: Math.round(ms) })
    if (state.slow.length > MAX_SLOW) state.slow.splice(0, state.slow.length - MAX_SLOW)
  }
  state.dirty = true
}

/** Instala a medição em todas as requisições HTTP do servidor (chamado uma vez por instrumentation.ts). */
export function installPerfHook() {
  if (shared.__ndPerfHook) return
  shared.__ndPerfHook = true
  load()
  const original = http.Server.prototype.emit
  http.Server.prototype.emit = function patched(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage, response = args[1] as http.ServerResponse
      const started = performance.now()
      let done = false
      const finish = () => { if (done) return; done = true; try { recordRequest(request.method || "GET", request.url || "/", response.statusCode, performance.now() - started) } catch { /* medir nunca pode derrubar a requisição */ } }
      response.once("finish", finish)
      response.once("close", finish)
    }
    return Reflect.apply(original, this, [event, ...args]) as boolean
  } as typeof original
  state.timer = setInterval(save, 15_000)
  state.timer.unref?.()
}

const percentile = (values: number[], p: number) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] }

export function perfSnapshot(limit = 200) {
  load()
  const routes = Object.values(state.routes).map((stat) => ({ route: stat.route, count: stat.count, avgMs: Math.round(stat.totalMs / Math.max(1, stat.count)), p95Ms: percentile(stat.samples, 0.95), maxMs: Math.round(stat.maxMs), slow: stat.slow, lastSlowAt: stat.lastSlowAt }))
  return { since: state.since, thresholdMs: SLOW_MS, routes: routes.sort((a, b) => b.slow - a.slow || b.p95Ms - a.p95Ms).slice(0, 80), recent: state.slow.slice(-limit).reverse(), totalRequests: routes.reduce((sum, item) => sum + item.count, 0), totalSlow: state.slow.length }
}

export function clearPerf() {
  state.slow = []; state.routes = {}; state.since = new Date().toISOString(); state.dirty = true; save()
}
