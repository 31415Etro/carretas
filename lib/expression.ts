// Analisador SEGURO de expressões de engenharia (fórmulas de quantidade e regras de compatibilidade).
// O texto vira uma árvore JSON com só os nós permitidos (a mesma que o banco avalia em eng_eval): nunca há execução de código digitado.
// Operadores: + - * / == != < <= > >= e ou nao (and or not). Funções: ceil, floor, round, max, min, abs, se(condição, então, senão).
// Parâmetros: nomes em minúsculas (comprimento, largura, acc_estepe...). Texto: 'galvanizado'. Números: 1500, 2.5 ou 2,5.

export type ExprNode =
  | { n: number } | { s: string } | { p: string }
  | { op: string; a: ExprNode; b?: ExprNode }
  | { fn: string; args: ExprNode[] }
  | { if: ExprNode; then: ExprNode; else: ExprNode }

export type ParseResult = { ok: true; ast: ExprNode; params: string[] } | { ok: false; error: string }

const FUNCTIONS: Record<string, { min: number; max: number }> = { ceil: { min: 1, max: 1 }, floor: { min: 1, max: 1 }, abs: { min: 1, max: 1 }, round: { min: 1, max: 2 }, max: { min: 2, max: 8 }, min: { min: 2, max: 8 } }
const WORDS: Record<string, string> = { and: "and", e: "and", or: "or", ou: "or", not: "not", nao: "not", não: "not" }
const MAX_LENGTH = 1500
const MAX_DEPTH = 25

type Token = { type: "num" | "str" | "id" | "op" | "(" | ")" | ","; value: string; at: number }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] || ""))) {
      let j = i
      while (j < text.length && /[0-9.,]/.test(text[j])) {
        // vírgula só vale como decimal quando seguida de dígito; senão é separador de argumentos
        if (text[j] === "," && !/[0-9]/.test(text[j + 1] || "")) break
        if (text[j] === "," && j > i && tokens.length && tokens[tokens.length - 1].type === "(" && false) break
        j++
      }
      tokens.push({ type: "num", value: text.slice(i, j).replace(",", "."), at: i })
      i = j
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1)
      if (end < 0) throw new Error(`Texto sem fechar a aspa (posição ${i + 1}).`)
      tokens.push({ type: "str", value: text.slice(i + 1, end), at: i })
      i = end + 1
      continue
    }
    if (/[a-zA-ZÀ-ÿ_]/.test(ch)) {
      let j = i
      while (j < text.length && /[a-zA-ZÀ-ÿ0-9_]/.test(text[j])) j++
      tokens.push({ type: "id", value: text.slice(i, j).toLowerCase(), at: i })
      i = j
      continue
    }
    const two = text.slice(i, i + 2)
    if (["==", "!=", "<=", ">="].includes(two)) { tokens.push({ type: "op", value: two, at: i }); i += 2; continue }
    if ("+-*/<>".includes(ch)) { tokens.push({ type: "op", value: ch, at: i }); i++; continue }
    if (ch === "=") { tokens.push({ type: "op", value: "==", at: i }); i++; continue }
    if (ch === "(" || ch === ")" || ch === ",") { tokens.push({ type: ch, value: ch, at: i } as Token); i++; continue }
    throw new Error(`Caractere não permitido "${ch}" (posição ${i + 1}).`)
  }
  return tokens
}

/** Converte o texto na árvore segura. Devolve o erro em português (nunca lança). */
export function parseExpression(text: string): ParseResult {
  try {
    const source = String(text || "").trim()
    if (!source) return { ok: false, error: "Digite a expressão." }
    if (source.length > MAX_LENGTH) return { ok: false, error: "Expressão grande demais." }
    const tokens = tokenize(source)
    let position = 0
    const params = new Set<string>()
    const peek = () => tokens[position]
    const take = () => tokens[position++]
    const expect = (type: Token["type"], what: string) => {
      const token = take()
      if (!token || token.type !== type) throw new Error(`Esperava ${what}${token ? ` na posição ${token.at + 1}` : " no fim da expressão"}.`)
      return token
    }
    const depthCheck = (depth: number) => { if (depth > MAX_DEPTH) throw new Error("Expressão profunda demais.") }

    const parseOr = (depth: number): ExprNode => {
      depthCheck(depth)
      let left = parseAnd(depth + 1)
      while (peek()?.type === "id" && WORDS[peek().value] === "or") { take(); left = { op: "or", a: left, b: parseAnd(depth + 1) } }
      return left
    }
    const parseAnd = (depth: number): ExprNode => {
      let left = parseNot(depth + 1)
      while (peek()?.type === "id" && WORDS[peek().value] === "and") { take(); left = { op: "and", a: left, b: parseNot(depth + 1) } }
      return left
    }
    const parseNot = (depth: number): ExprNode => {
      depthCheck(depth)
      if (peek()?.type === "id" && WORDS[peek().value] === "not") { take(); return { op: "not", a: parseNot(depth + 1) } }
      return parseCompare(depth + 1)
    }
    const parseCompare = (depth: number): ExprNode => {
      const left = parseSum(depth + 1)
      const token = peek()
      if (token?.type === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(token.value)) { take(); return { op: token.value, a: left, b: parseSum(depth + 1) } }
      return left
    }
    const parseSum = (depth: number): ExprNode => {
      depthCheck(depth)
      let left = parseProduct(depth + 1)
      while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) { const op = take().value; left = { op, a: left, b: parseProduct(depth + 1) } }
      return left
    }
    const parseProduct = (depth: number): ExprNode => {
      depthCheck(depth)
      let left = parseUnary(depth + 1)
      while (peek()?.type === "op" && (peek().value === "*" || peek().value === "/")) { const op = take().value; left = { op, a: left, b: parseUnary(depth + 1) } }
      return left
    }
    const parseUnary = (depth: number): ExprNode => {
      depthCheck(depth)
      if (peek()?.type === "op" && peek().value === "-") { take(); return { op: "-", a: { n: 0 }, b: parseUnary(depth + 1) } }
      return parsePrimary(depth + 1)
    }
    const parsePrimary = (depth: number): ExprNode => {
      depthCheck(depth)
      const token = take()
      if (!token) throw new Error("A expressão terminou antes do esperado.")
      if (token.type === "num") {
        const value = Number(token.value)
        if (!Number.isFinite(value)) throw new Error(`Número inválido "${token.value}".`)
        return { n: value }
      }
      if (token.type === "str") return { s: token.value }
      if (token.type === "(") { const inner = parseOr(depth + 1); expect(")", '")"'); return inner }
      if (token.type === "id") {
        if (WORDS[token.value]) throw new Error(`"${token.value}" não pode ser usado aqui (posição ${token.at + 1}).`)
        if (peek()?.type === "(") {
          take()
          const args: ExprNode[] = []
          if (peek()?.type !== ")") {
            args.push(parseOr(depth + 1))
            while (peek()?.type === ",") { take(); args.push(parseOr(depth + 1)) }
          }
          expect(")", '")"')
          if (token.value === "se" || token.value === "if") {
            if (args.length !== 3) throw new Error('"se" precisa de 3 partes: se(condição, então, senão).')
            return { if: args[0], then: args[1], else: args[2] }
          }
          const rule = FUNCTIONS[token.value]
          if (!rule) throw new Error(`Função não permitida: "${token.value}". Permitidas: ceil, floor, round, max, min, abs e se.`)
          if (args.length < rule.min || args.length > rule.max) throw new Error(`"${token.value}" recebe de ${rule.min} a ${rule.max} valor(es).`)
          return { fn: token.value, args }
        }
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(token.value)) throw new Error(`Nome de parâmetro inválido: "${token.value}".`)
        params.add(token.value)
        return { p: token.value }
      }
      throw new Error(`Símbolo inesperado na posição ${token.at + 1}.`)
    }

    const ast = parseOr(0)
    if (position < tokens.length) throw new Error(`Sobrou texto depois da expressão (posição ${tokens[position].at + 1}).`)
    return { ok: true, ast, params: [...params] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Expressão inválida." }
  }
}

/** Texto legível da árvore (para mostrar fórmulas já gravadas). */
export function formatExpression(node: ExprNode, parentPrecedence = 0): string {
  if ("n" in node) return String(node.n)
  if ("s" in node) return `'${node.s}'`
  if ("p" in node) return node.p
  if ("if" in node) return `se(${formatExpression(node.if)}, ${formatExpression(node.then)}, ${formatExpression(node.else)})`
  if ("fn" in node) return `${node.fn}(${node.args.map((arg) => formatExpression(arg)).join(", ")})`
  const precedence: Record<string, number> = { or: 1, and: 2, not: 3, "==": 4, "!=": 4, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6 }
  const level = precedence[node.op] || 0
  const text = node.op === "not" ? `nao ${formatExpression(node.a, level)}` : `${formatExpression(node.a, level)} ${node.op === "and" ? "e" : node.op === "or" ? "ou" : node.op} ${formatExpression(node.b as ExprNode, level + 1)}`
  return level < parentPrecedence ? `(${text})` : text
}

/** Avaliador local só para pré-visualizar (a verdade do cálculo é a do banco). Mesmas regras: sem divisão por zero, sem parâmetro desconhecido. */
export function evaluateExpression(node: ExprNode, vars: Record<string, number | string>): number | string | boolean {
  if ("n" in node) return node.n
  if ("s" in node) return node.s
  if ("p" in node) { if (!(node.p in vars)) throw new Error(`Parâmetro desconhecido: ${node.p}`); return vars[node.p] }
  if ("if" in node) return evaluateExpression(node.if, vars) === true ? evaluateExpression(node.then, vars) : evaluateExpression(node.else, vars)
  if ("fn" in node) {
    const values = node.args.map((arg) => Number(evaluateExpression(arg, vars)))
    switch (node.fn) {
      case "ceil": return Math.ceil(values[0])
      case "floor": return Math.floor(values[0])
      case "abs": return Math.abs(values[0])
      case "round": { const f = 10 ** (values[1] || 0); return Math.round(values[0] * f) / f }
      case "max": return Math.max(...values)
      case "min": return Math.min(...values)
    }
    throw new Error("Função não permitida.")
  }
  if (node.op === "not") return evaluateExpression(node.a, vars) !== true
  const a = evaluateExpression(node.a, vars)
  if (node.op === "and") return a === true && evaluateExpression(node.b as ExprNode, vars) === true
  if (node.op === "or") return a === true || evaluateExpression(node.b as ExprNode, vars) === true
  const b = evaluateExpression(node.b as ExprNode, vars)
  if (node.op === "==") return a === b
  if (node.op === "!=") return a !== b
  const x = Number(a), y = Number(b)
  switch (node.op) {
    case "+": return x + y
    case "-": return x - y
    case "*": return x * y
    case "/": if (y === 0) throw new Error("Divisão por zero."); return x / y
    case "<": return x < y
    case "<=": return x <= y
    case ">": return x > y
    case ">=": return x >= y
  }
  throw new Error("Operador não permitido.")
}
