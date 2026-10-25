// Cadastra como matéria-prima e dá entrada no estoque dos materiais comprados nas notas de ENTRADA da Contabilidade (accounting_invoices).
// Sem --aplicar só mostra o que faria (e grava a conferência em CSV). Com --aplicar cadastra e lança as entradas.
//   node scripts/importar-materiais-das-notas.mjs [--desde 2026-01-01] [--ate 2026-12-31] [--csv arquivo.csv] [--aplicar]
// Regras: só mercadoria (CFOPs de compra/revenda; fora retornos, remessas, industrialização, combustível e serviços); o mesmo material (descrição + unidade)
// vira UM cadastro; material que já existe como matéria-prima não é duplicado; a quantidade entra no estoque da empresa que recebeu a nota
// (movimento "Entrada por compra", documento CARGA-NF-AAAA) e a carga nunca é repetida para o mesmo material/empresa.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
}
const args = process.argv.slice(2)
const option = (name, fallback = "") => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback }
const apply = args.includes("--aplicar")
const from = option("desde", "2026-01-01"), to = option("ate", "2026-12-31")
const year = from.slice(0, 4)
const marker = `CARGA-NF-${year}`
const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`, key = process.env.SUPABASE_SERVICE_ROLE_KEY
const request = async (method, url, body, companyId) => {
  const response = await fetch(base + url, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(companyId ? { "x-system-company-id": companyId } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${url.split("?")[0]} ${response.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const GOODS_CFOP = new Set(["5101", "5102", "5103", "5104", "5105", "5106", "5401", "5402", "5403", "5405", "6101", "6102", "6103", "6104", "6105", "6106", "6107", "6108", "6401", "6402", "6403", "6404", "6123", "5123"])
const UNIT = { UN: "UN", UNID: "UN", UND: "UN", "1UN": "UN", PC: "PC", PCS: "PC", PÇ: "PC", PEÇA: "PC", PECA: "PC", PAR: "PAR", PARES: "PAR", PR: "PAR", KG: "KG", QUILO: "KG", M: "M", MT: "M", MTS: "M", ML: "M", M2: "M2", M3: "M3", "M³": "M3", "M²": "M2", L: "L", LT: "L", JG: "JG", BR: "BR", CX: "CX", RL: "RL", BL: "BL", PT: "PT", BB: "BB", GL: "GL", CJ: "CJ", KIT: "KIT" }
const unitOf = (raw) => { const value = String(raw || "UN").trim().toUpperCase(); return UNIT[value] || value.slice(0, 6) || "UN" }
const norm = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
// veículos e peças/serviços de um carro específico (placa, renavam) e carretas prontas não são material
const NOT_MATERIAL = (item) => /^MARCA MOD|RENAVAN|PLACA:? ?[A-Z]{3}\d|ANO 20\d\d ?\/ ?MOD|^BMW/i.test(String(item.description || "")) || String(item.ncm || "").startsWith("8703")
const csv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`

console.log(`Lendo as notas de entrada de ${from} a ${to}...`)
const invoices = []
for (let offset = 0; ; offset += 200) {
  const page = await request("GET", `/accounting_invoices?select=system_company_id,kind,number,issued_at,issuer_name,data&operation=eq.Entrada&issued_at=gte.${from}T00:00:00-03:00&issued_at=lte.${to}T23:59:59-03:00&order=id&offset=${offset}&limit=200`)
  invoices.push(...page)
  if (page.length < 200) break
}
const companies = Object.fromEntries((await request("GET", "/system_companies?select=id,name,trade_name")).map((company) => [company.id, company.trade_name || company.name]))

const groups = new Map()
const skipped = { cfop: new Map(), noQuantity: 0 }
let items = 0, kept = 0
for (const invoice of invoices) {
  for (const item of invoice.data?.items || []) {
    items++
    const cfop = String(item.cfop || "")
    if (!GOODS_CFOP.has(cfop)) { skipped.cfop.set(cfop || "sem CFOP", (skipped.cfop.get(cfop || "sem CFOP") || 0) + 1); continue }
    if (NOT_MATERIAL(item)) { skipped.cfop.set("veículo/carreta pronta", (skipped.cfop.get("veículo/carreta pronta") || 0) + 1); continue }
    const quantity = Number(item.quantity || 0)
    if (!(quantity > 0) || !String(item.description || "").trim()) { skipped.noQuantity++; continue }
    kept++
    const unit = unitOf(item.unit)
    const id = `${norm(item.description)}|${unit}`
    const group = groups.get(id) || { name: String(item.description).trim().replace(/\s+/g, " ").slice(0, 200), unit, ncms: new Map(), suppliers: new Set(), notes: new Set(), byCompany: new Map(), total: 0, quantity: 0 }
    group.quantity += quantity; group.total += Number(item.total || 0)
    const ncm = String(item.ncm || "").replace(/\D/g, "")
    if (ncm.length === 8) group.ncms.set(ncm, (group.ncms.get(ncm) || 0) + 1)
    if (invoice.issuer_name) group.suppliers.add(invoice.issuer_name)
    group.notes.add(`${invoice.number}`)
    const company = group.byCompany.get(invoice.system_company_id) || { quantity: 0, total: 0 }
    company.quantity += quantity; company.total += Number(item.total || 0)
    group.byCompany.set(invoice.system_company_id, company)
    groups.set(id, group)
  }
}

const existing = await request("GET", "/materials?select=id,name,unit,item_type,internal_code&item_type=eq.Materia-prima&limit=5000")
const existingByName = new Map(existing.map((row) => [norm(row.name), row]))
const warehouseCompany = Object.fromEntries((await request("GET", "/warehouses?select=id,system_company_id")).map((row) => [row.id, row.system_company_id]))
const loaded = await request("GET", `/stock_movements?select=material_id,to_warehouse_id&document_reference=eq.${marker}&limit=20000`)
const alreadyLoaded = new Set(loaded.map((row) => `${row.material_id}|${warehouseCompany[row.to_warehouse_id]}`))

const list = [...groups.values()].sort((a, b) => b.total - a.total)
let toCreate = 0, toReuse = 0
for (const group of list) { group.existing = existingByName.get(norm(group.name)); if (group.existing) toReuse++; else toCreate++ }
console.log(`Notas: ${invoices.length} · itens nas notas: ${items} · itens de mercadoria: ${kept} · materiais distintos: ${list.length} (${toCreate} novos, ${toReuse} já cadastrados)`)
console.log("Itens fora (não é compra de material):", [...skipped.cfop.entries()].sort((a, b) => b[1] - a[1]).map(([cfop, n]) => `${cfop}: ${n}`).join(" · ") || "nenhum", `· sem quantidade/descrição: ${skipped.noQuantity}`)
const perCompany = {}
for (const group of list) for (const [id, data] of group.byCompany) { perCompany[id] = perCompany[id] || { materials: 0, total: 0 }; perCompany[id].materials++; perCompany[id].total += data.total }
for (const [id, data] of Object.entries(perCompany)) console.log(`  ${companies[id] || id}: ${data.materials} materiais, ${data.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em compras`)

const csvFile = option("csv", path.join(root, "notas-baixadas", `materiais-das-notas-${year}.csv`))
fs.mkdirSync(path.dirname(csvFile), { recursive: true })
fs.writeFileSync(csvFile, "﻿" + ["Material;Un.;NCM;Quantidade total;Custo médio;Total;Notas;Fornecedores;Situação;" + Object.values(companies).join(";"), ...list.map((group) => [csv(group.name), group.unit, [...group.ncms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "", String(group.quantity).replace(".", ","), String(group.quantity ? Math.round((group.total / group.quantity) * 10000) / 10000 : 0).replace(".", ","), String(Math.round(group.total * 100) / 100).replace(".", ","), group.notes.size, csv([...group.suppliers].slice(0, 3).join(" / ")), group.existing ? `já cadastrado (${group.existing.internal_code})` : "novo", ...Object.keys(companies).map((id) => String(group.byCompany.get(id)?.quantity ?? 0).replace(".", ","))].join(";"))].join("\n"), "utf8")
console.log("Conferência gravada em", csvFile)
if (!apply) { console.log("\nNada foi gravado. Para cadastrar e dar entrada no estoque, rode de novo com --aplicar."); process.exit(0) }

let created = 0, movements = 0, skippedMovements = 0
const errors = []
for (const group of list) {
  try {
    let material = group.existing
    if (!material) {
      const code = await request("POST", "/rpc/next_item_sku", { p_item_type: "Materia-prima" })
      const ncm = [...group.ncms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
      const average = group.quantity ? Math.round((group.total / group.quantity) * 10000) / 10000 : 0
      const rows = await request("POST", "/materials", { item_type: "Materia-prima", name: group.name, internal_code: code, unit: group.unit, status: "Ativo", ncm, cost_price: average, controls_stock: true, allows_sale: false, sale_price: 0, category: "Importado das notas", notes: `Cadastrado pela carga das notas de entrada de ${year}. Fornecedores: ${[...group.suppliers].slice(0, 5).join(" / ")}` })
      material = rows[0]; created++
    }
    for (const [companyId, data] of group.byCompany) {
      if (alreadyLoaded.has(`${material.id}|${companyId}`)) { skippedMovements++; continue }
      await request("POST", "/rpc/apply_stock_movement", { p: { material_id: material.id, movement_type: "Entrada por compra", quantity: Math.round(data.quantity * 1000) / 1000, unit_cost: data.quantity ? Math.round((data.total / data.quantity) * 10000) / 10000 : 0, document_reference: marker, reason: `Carga das notas de entrada de ${year}`, responsible: "Carga das notas" } }, companyId)
      movements++
    }
  } catch (error) { errors.push(`${group.name}: ${error.message}`) }
}
console.log(`\nCadastrados: ${created} · entradas lançadas: ${movements} · já carregadas antes (puladas): ${skippedMovements} · erros: ${errors.length}`)
for (const message of errors.slice(0, 20)) console.log("ERRO", message)
