// Importa os chassis da planilha "Controle de pgtos" (da aba Fábrica até o fim) para o cadastro de chassis (tabela chassis_registry):
// vendedor, valor, NF, consumidor, baixa e tamanho. Chassi que ainda não está no cadastro é incluído; linhas "Total" não entram.
//
//   node --experimental-strip-types scripts/chassis/importar-pagamentos.mjs "<planilha.xlsx>" [sistema_chassis.json]            (simulação)
//   node --experimental-strip-types scripts/chassis/importar-pagamentos.mjs "<planilha.xlsx>" --gravar                         (grava; precisa do script 243)
//
// Idempotente. Lê SUPABASE_SERVICE_ROLE_KEY e a URL do .env.local da pasta atual.
import fs from "node:fs"
import XLSX from "xlsx"
import { createClient } from "@supabase/supabase-js"
import { FORT_COMPANY_ID, ND_COMPANY_ID } from "../../lib/chassis-registry.ts"
import { mergeSales, modelFromVin, parseSheet } from "../../lib/pagamentos-chassis.ts"

XLSX.set_fs(fs)
const file = process.argv[2]
const write = process.argv.includes("--gravar")
const systemFile = process.argv.slice(3).find((arg) => arg.endsWith(".json"))
if (!file) { console.error("Informe o caminho da planilha."); process.exit(1) }

const book = XLSX.readFile(file, { cellDates: true })
const start = book.SheetNames.findIndex((name) => /^f[aá]brica$/i.test(name.trim()))
if (start < 0) { console.error('A planilha não tem a aba "Fábrica".'); process.exit(1) }

const lines = []
const perSheet = []
let skipped = 0
for (const name of book.SheetNames.slice(start)) {
  const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: null, raw: true })
  const parsed = parseSheet(name, rows, /^f[aá]brica$/i.test(name.trim()) ? "fabrica" : "externo")
  lines.push(...parsed.sales); skipped += parsed.skipped
  perSheet.push([name.trim(), parsed.sales.length])
}
const sales = mergeSales(lines)
const withValue = sales.filter((sale) => sale.saleValue !== null || sale.externalValue !== null).length
console.log(`abas lidas (da Fábrica ao fim): ${perSheet.length} | linhas com chassi: ${lines.length} | chassis distintos: ${sales.length} | linhas com texto mas sem chassi (ignoradas): ${skipped}`)
console.log(`com vendedor da fábrica: ${sales.filter((sale) => sale.seller).length} | com vendedor externo (aba): ${sales.filter((sale) => sale.externalSeller).length} | com valor: ${withValue} | com baixa de pagamento: ${sales.filter((sale) => sale.payment).length} | com tamanho/descrição: ${sales.filter((sale) => sale.description).length}`)
console.log(`chassis repetidos entre abas/linhas: ${sales.filter((sale) => sale.lines > 1).length}`)
console.log("vendedores da fábrica:", Object.entries(sales.reduce((acc, sale) => (sale.seller ? { ...acc, [sale.seller]: (acc[sale.seller] || 0) + 1 } : acc), {})))

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// cadastro atual (o service role enxerga todas as empresas)
const registry = new Map()
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin.from("chassis_registry").select("vin,description,system_company_id").order("vin").range(from, from + 999)
  if (error) { console.error("Não foi possível ler o cadastro:", error.message); process.exit(1) }
  for (const row of data) registry.set(row.vin, row)
  if (data.length < 1000) break
}
const noteVins = new Set()
if (systemFile) for (const row of JSON.parse(fs.readFileSync(systemFile, "utf8")).rows || []) if (row.chassis) noteVins.add(row.chassis)

const inRegistry = sales.filter((sale) => registry.has(sale.vin))
const fresh = sales.filter((sale) => !registry.has(sale.vin))
console.log(`\nno cadastro de chassis: ${inRegistry.length} | fora do cadastro (serão incluídos): ${fresh.length}`)
if (systemFile) console.log(`com nota fiscal no sistema: ${sales.filter((sale) => noteVins.has(sale.vin)).length} | sem nota e sem cadastro: ${fresh.filter((sale) => !noteVins.has(sale.vin)).length}`)
console.log("exemplos de chassis novos:", fresh.slice(0, 5).map((sale) => `${sale.vin} (${sale.seller || sale.externalSeller})`))
if (!write) { console.log("\nSimulação: nada foi gravado. Rode o script 243 no Supabase e depois use --gravar."); process.exit(0) }

const saleColumns = (sale) => ({
  seller: sale.seller || null, external_seller: sale.externalSeller || null, sale_value: sale.saleValue, external_value: sale.externalValue, paid_value: sale.paidValue,
  sale_date: sale.saleDate, sale_invoice: sale.saleInvoice || null, consumer: sale.consumer || null, payment_note: sale.payment || null,
})
// existentes: só as colunas novas (e a descrição quando o cadastro não tinha); novos: registro completo
const updates = inRegistry.map((sale) => ({ vin: sale.vin, system_company_id: registry.get(sale.vin).system_company_id, ...saleColumns(sale), ...(sale.description && !registry.get(sale.vin).description ? { description: sale.description } : {}) }))
const inserts = fresh.map((sale) => {
  const model = modelFromVin(sale.vin)
  const companyId = sale.vin.startsWith("980VPR") ? FORT_COMPANY_ID : ND_COMPANY_ID
  return { vin: sale.vin, system_company_id: companyId, group_name: "Planilha Controle de pgtos", model: model.model || null, family: model.family || null, axles: model.axles || null, year_model: model.year || null, year_manufacture: model.year || null, description: sale.description || null, source: "Planilha Controle de pgtos 2026", mentions: 0, ...saleColumns(sale) }
})
let done = 0
for (const [label, list] of [["atualizados", updates], ["novos", inserts]]) {
  for (const companyId of new Set(list.map((row) => row.system_company_id))) {
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { headers: { "x-system-company-id": companyId } } })
    const part = list.filter((row) => row.system_company_id === companyId)
    // lotes com as mesmas colunas (a descrição só existe em parte dos existentes)
    const withDescription = part.filter((row) => "description" in row), withoutDescription = part.filter((row) => !("description" in row))
    for (const group of [withDescription, withoutDescription]) {
      for (let from = 0; from < group.length; from += 500) {
        const { error } = await db.from("chassis_registry").upsert(group.slice(from, from + 500), { onConflict: "system_company_id,vin" })
        if (error) { console.error(`Erro ao gravar (${label}):`, error.message); process.exit(1) }
        done += Math.min(500, group.length - from)
        process.stdout.write(`\rgravados ${done}/${sales.length}`)
      }
    }
  }
}
console.log("\nConcluído.")
