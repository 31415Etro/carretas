// Executa uma vez quando o servidor inicia: liga o monitor de lentidão (Configurações > Desempenho).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installPerfHook } = await import("./lib/perf-monitor")
    installPerfHook()
  }
}
