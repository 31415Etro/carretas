// Regras fiscais por operação do produto. CFOP e CST/CSOSN dependem da operação,
// do destinatário e do regime tributário, por isso não são campos fixos do produto.

export type FiscalRule = {
  id?: string
  operation: string
  taxRegime: string
  cfop: string
  cstCsosn: string
  ibsCbsCst: string
  ibsCbsClass: string
  validFrom: string
  validTo: string
  notes: string
}

/** Operação e o primeiro dígito de CFOP esperado (1/2/3 entradas, 5/6/7 saídas). */
export const fiscalOperations: Array<{ value: string; cfopPrefixes: string[] }> = [
  { value: "Venda dentro do estado", cfopPrefixes: ["5"] },
  { value: "Venda para outro estado", cfopPrefixes: ["6"] },
  { value: "Venda a consumidor final", cfopPrefixes: ["5", "6"] },
  { value: "Exportação", cfopPrefixes: ["7"] },
  { value: "Remessa (conserto, demonstração, industrialização)", cfopPrefixes: ["5", "6"] },
  { value: "Devolução de compra", cfopPrefixes: ["5", "6"] },
  { value: "Compra / entrada", cfopPrefixes: ["1", "2", "3"] },
  { value: "Devolução de venda (entrada)", cfopPrefixes: ["1", "2"] },
  { value: "Outra", cfopPrefixes: ["1", "2", "3", "5", "6", "7"] },
]

export const taxRegimes = ["Todos", "Simples Nacional", "MEI", "Lucro Presumido", "Lucro Real"]

const simples = (regime: string) => regime === "Simples Nacional" || regime === "MEI"

function overlaps(a: FiscalRule, b: FiscalRule) {
  const aStart = a.validFrom || "0000-01-01"
  const aEnd = a.validTo || "9999-12-31"
  const bStart = b.validFrom || "0000-01-01"
  const bEnd = b.validTo || "9999-12-31"
  return aStart <= bEnd && bStart <= aEnd
}

/** Mensagem de erro ou "" quando o conjunto de regras é válido. */
export function validateFiscalRules(rules: FiscalRule[]) {
  for (const [index, rule] of rules.entries()) {
    const label = `Regra ${index + 1} (${rule.operation || "sem operação"})`
    const operation = fiscalOperations.find((item) => item.value === rule.operation)
    if (!operation) return `${label}: escolha a operação.`
    if (!taxRegimes.includes(rule.taxRegime)) return `${label}: regime tributário inválido.`
    if (rule.cfop) {
      if (!/^[1-7]\d{3}$/.test(rule.cfop)) return `${label}: CFOP deve ter 4 dígitos.`
      if (!operation.cfopPrefixes.includes(rule.cfop[0])) return `${label}: CFOP ${rule.cfop} não corresponde à operação (esperado iniciar com ${operation.cfopPrefixes.join(" ou ")}).`
    }
    if (rule.cstCsosn) {
      if (simples(rule.taxRegime) && !/^\d{3}$/.test(rule.cstCsosn)) return `${label}: no Simples Nacional informe o CSOSN (3 dígitos, ex.: 102).`
      if (!simples(rule.taxRegime) && rule.taxRegime !== "Todos" && !/^\d{2}$/.test(rule.cstCsosn)) return `${label}: no regime normal informe o CST do ICMS (2 dígitos, ex.: 00).`
      if (rule.taxRegime === "Todos" && !/^\d{2,3}$/.test(rule.cstCsosn)) return `${label}: CST (2 dígitos) ou CSOSN (3 dígitos).`
    }
    if (rule.ibsCbsCst && !/^\d{3}$/.test(rule.ibsCbsCst)) return `${label}: CST do IBS/CBS deve ter 3 dígitos.`
    if (rule.ibsCbsClass && !/^\d{6}$/.test(rule.ibsCbsClass)) return `${label}: classificação tributária do IBS/CBS (cClassTrib) deve ter 6 dígitos.`
    if (rule.validFrom && rule.validTo && rule.validTo < rule.validFrom) return `${label}: fim da vigência anterior ao início.`
    if (!rule.cfop && !rule.cstCsosn && !rule.ibsCbsCst && !rule.ibsCbsClass) return `${label}: informe ao menos um código fiscal.`
    const clash = rules.find((other, otherIndex) => otherIndex !== index && other.operation === rule.operation && other.taxRegime === rule.taxRegime && overlaps(rule, other))
    if (clash) return `${label}: já existe outra regra para a mesma operação e regime com vigência sobreposta.`
  }
  return ""
}

/** Regra aplicável a uma operação/regime numa data (regime específico vence "Todos"). */
export function applicableFiscalRule(rules: FiscalRule[], operation: string, regime: string, date: string) {
  const valid = rules.filter((rule) => rule.operation === operation && (!rule.validFrom || rule.validFrom <= date) && (!rule.validTo || rule.validTo >= date))
  return valid.find((rule) => rule.taxRegime === regime) || valid.find((rule) => rule.taxRegime === "Todos") || null
}
