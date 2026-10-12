// Mascaramento dos valores gravados na auditoria: sem senhas, tokens ou dados sigilosos desnecessários.
// (O trigger do banco, audit_redact em scripts/213_auditoria.sql, aplica a mesma regra.)

const SENSITIVE_KEY = /(pass|senha|token|secret|api_?key|authorization|credential|signature|private)/i
const MASKED_KEY = /(^|_)(document|cpf|cnpj|cnh|renavam|pix|account_number|agency)(_|$)/i

/** Remove segredos, mascara documentos e limita o tamanho dos valores antes de gravar no log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return depth > 3 ? "[dados extensos]" : value.slice(0, 50).map((item) => redact(item, depth + 1))
  if (typeof value === "object") {
    if (depth > 3) return "[dados extensos]"
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "updated_at" || SENSITIVE_KEY.test(key)) continue
      if (typeof item === "string" && MASKED_KEY.test(key) && item.length > 4) out[key] = `••••${item.slice(-4)}`
      else out[key] = redact(item, depth + 1)
    }
    return out
  }
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "[arquivo]"
    return value.length > 500 ? `${value.slice(0, 500)}…` : value
  }
  return value
}
