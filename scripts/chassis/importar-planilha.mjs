// Importa a planilha "Controle de Chassis (WhatsApp)" para o cadastro de chassis (tabela chassis_registry, script 242).
//
//   node --experimental-strip-types scripts/chassis/importar-planilha.mjs "<planilha.xlsx>"            (simulação: só mostra os números, não grava)
//   node --experimental-strip-types scripts/chassis/importar-planilha.mjs "<planilha.xlsx>" --gravar   (grava no banco)
//
// Idempotente: roda de novo com uma planilha mais nova e atualiza pelo número do chassi (empresa + VIN), sem duplicar.
// Lê SUPABASE_SERVICE_ROLE_KEY e a URL do .env.local da pasta atual.
import fs from "node:fs"
import XLSX from "xlsx"
import { createClient } from "@supabase/supabase-js"
import { FORT_COMPANY_ID, ND_COMPANY_ID, modelFromGroup, parseMention } from "../../lib/chassis-registry.ts"

XLSX.set_fs(fs) // no ESM a biblioteca precisa receber o fs
const file = process.argv[2]
const write = process.argv.includes("--gravar")
if (!file) { console.error("Informe o caminho da planilha."); process.exit(1) }

const sheet = XLSX.readFile(file, { cellDates: true }).Sheets["Cadastro de chassis"]
if (!sheet) { console.error('A planilha não tem a aba "Cadastro de chassis".'); process.exit(1) }
const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }).slice(1).filter((row) => row[1])

const text = (value) => (value === null || value === undefined ? "" : String(value).trim())
const number = (value) => { const n = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null }
const year = (value) => { const m = text(value).match(/\d{4}/); return m ? m[0] : null }

// um registro por empresa + chassi; o mesmo VIN em dois grupos da planilha (14 casos) é unido: primeiro valor preenchido, menções somadas
const records = new Map()
for (const row of table) {
  const group = text(row[0])
  const vin = text(row[1]).toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (vin.length < 10) continue
  const companyId = vin.startsWith("980VPR") ? FORT_COMPANY_ID : ND_COMPANY_ID // a empresa vem do número do chassi (980VPR... = Fort Com de Ferro; 980ND... = ND Carretas), não do grupo da planilha
  let { model, family, axles } = modelFromGroup(group)
  // grupo "Fort" com chassi ND (980ND...): o modelo está no próprio número (980NDFZ1E... = FZ 1E)
  const fromVin = vin.match(/^980N[DS]([A-Z]{2,3})(\d)/)
  if (/^fort/i.test(group) && fromVin) { family = fromVin[1]; axles = family === "JET" ? 0 : Number(fromVin[2]); model = axles ? `${family} ${axles}E` : family }
  const next = {
    system_company_id: companyId, vin, group_name: group, model, family, axles: axles || null, description: text(row[5]) || null,
    year_manufacture: year(row[6]), year_model: year(row[7]), pbt_kg: number(row[8]), capacity_kg: number(row[9]), tare_kg: number(row[10]), axle_capacity_kg: number(row[11]),
    color: text(row[12]) || null, client_hint: text(row[13]) || null, first_mention: parseMention(row[2]), last_mention: parseMention(row[3]), mentions: Number(row[4]) || 1,
    evidence: text(row[15]).slice(0, 1000) || null, alerts: text(row[16]) || null,
  }
  const key = `${companyId}|${vin}`
  const current = records.get(key)
  if (!current) { records.set(key, next); continue }
  // o mesmo chassi em um grupo "Fort" e em um grupo de modelo (14 casos): vale o modelo do grupo de modelo, e a descrição vem de qualquer um dos dois
  if (/^fort/i.test(current.group_name) && !/^fort/i.test(group)) for (const field of ["group_name", "model", "family", "axles"]) current[field] = next[field]
  for (const field of Object.keys(next)) if (current[field] === null || current[field] === "" || current[field] === undefined) current[field] = next[field]
  current.mentions += next.mentions
  if (next.first_mention && (!current.first_mention || next.first_mention < current.first_mention)) current.first_mention = next.first_mention
  if (next.last_mention && (!current.last_mention || next.last_mention > current.last_mention)) current.last_mention = next.last_mention
}

const list = [...records.values()]
const count = (predicate) => list.filter(predicate).length
console.log(`linhas na planilha: ${table.length} | chassis distintos a cadastrar: ${list.length}`)
console.log(`com descrição/tamanho: ${count((r) => r.description)} | com PBT: ${count((r) => r.pbt_kg)} | com capacidade: ${count((r) => r.capacity_kg)} | com cliente citado: ${count((r) => r.client_hint)}`)
const byModel = {}
for (const r of list) byModel[r.model || "(sem modelo)"] = (byModel[r.model || "(sem modelo)"] || 0) + 1
console.log("por modelo:", byModel)
console.log("por empresa:", Object.entries(list.reduce((acc, r) => ({ ...acc, [r.system_company_id]: (acc[r.system_company_id] || 0) + 1 }), {})))
if (!write) { console.log("\nSimulação: nada foi gravado. Rode com --gravar depois de executar o script 242 no Supabase."); process.exit(0) }

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]))
let written = 0
for (const companyId of new Set(list.map((r) => r.system_company_id))) {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { headers: { "x-system-company-id": companyId } } })
  const part = list.filter((r) => r.system_company_id === companyId)
  for (let start = 0; start < part.length; start += 500) {
    const { error } = await db.from("chassis_registry").upsert(part.slice(start, start + 500), { onConflict: "system_company_id,vin" })
    if (error) { console.error("Erro ao gravar:", error.message); process.exit(1) }
    written += Math.min(500, part.length - start)
    process.stdout.write(`\rgravados ${written}/${list.length}`)
  }
}
console.log("\nConcluído.")
