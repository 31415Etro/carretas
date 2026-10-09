const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const XLSX = require("xlsx")
const { createClient } = require("@supabase/supabase-js")
require("@next/env").loadEnvConfig(process.cwd())

const apply = process.argv.includes("--apply")
const sources = [
  { kind: "payable", file: "contas a pagar/relatorio_contas_pagar Janeiro a Abril.xlsx" },
  { kind: "receivable", file: "contas a receber/relatorio_contas_receber Janeiro a Abril.xlsx" },
]

function uuidFromText(value) {
  const hash = crypto.createHash("sha1").update(`finance-recovery:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase()
}

function money(value) {
  return Number(String(value || "0").replace(/\./g, "").replace(",", ".")) || 0
}

function isoDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null
}

function readRows(source) {
  const workbook = XLSX.readFile(path.resolve(process.cwd(), source.file), { cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false })
  const headerIndex = grid.findIndex((row) => row.some((cell) => normalize(cell) === "CODIGO") && row.some((cell) => normalize(cell) === "VALOR TOTAL"))
  if (headerIndex < 0) throw new Error(`Cabecalho nao encontrado: ${source.file}`)
  const headers = grid[headerIndex].map((cell) => String(cell || "").trim())
  return grid.slice(headerIndex + 1).map((cells) => Object.fromEntries(headers.map((header, index) => [normalize(header), String(cells[index] || "").trim()])))
    .filter((row) => /^\d+$/.test(row.CODIGO || "") && money(row["VALOR TOTAL"]) > 0)
}

function accountStatus(kind, situation) {
  const status = normalize(situation)
  if (status.includes("CANCEL")) return "Cancelada"
  if (status.includes("CONFIRM") || status.includes("PAGO") || status.includes("RECEB")) return kind === "payable" ? "Paga" : "Recebida"
  return "Vencida"
}

async function upsertBatches(supabase, table, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    const now = new Date().toISOString()
    const batch = rows.slice(index, index + 100).map((row) => ({ created_at: now, updated_at: now, ...row }))
    const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Credenciais do Supabase ausentes em .env.local")
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const tableNames = ["accounts_payable", "accounts_receivable", "financial_transactions", "financial_categories", "cost_centers", "dre_accounts"]
  const current = {}
  for (const table of tableNames) {
    const { data, error } = await supabase.from(table).select("*")
    if (error) throw new Error(`${table}: ${error.message}`)
    current[table] = data || []
  }

  const snapshot = path.join(process.env.TEMP || process.cwd(), `finance-before-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(snapshot, JSON.stringify(current, null, 2))

  const categories = [...current.financial_categories]
  const costCenters = [...current.cost_centers]
  const dreRevenue = current.dre_accounts.find((row) => normalize(row.name).includes("RECEITA BRUTA"))?.id || null
  const dreExpense = current.dre_accounts.find((row) => normalize(row.name).includes("SEM CLASSIFIC"))?.id || null
  const categoryByName = new Map(categories.map((row) => [`${normalize(row.name)}:${row.type}`, row]))
  const costCenterByName = new Map(costCenters.map((row) => [normalize(row.name), row]))
  const accountsPayable = []
  const accountsReceivable = []
  const transactions = []
  const totals = {}

  for (const source of sources) {
    const rows = readRows(source)
    totals[source.kind] = { rows: rows.length, amount: 0, realized: 0 }
    for (const row of rows) {
      const code = row.CODIGO
      const amount = money(row["VALOR TOTAL"])
      const type = source.kind === "payable" ? "saida" : "entrada"
      const plan = row["PLANO DE CONTAS"] || "Sem classificacao"
      const categoryKey = `${normalize(plan)}:${type}`
      let category = categoryByName.get(categoryKey)
      if (!category) {
        category = { id: uuidFromText(`category:${categoryKey}`), name: plan, type, dre_account_id: type === "entrada" ? dreRevenue : dreExpense, status: "Ativo" }
        categories.push(category)
        categoryByName.set(categoryKey, category)
      }
      const centerName = row["CENTRO DE CUSTO"]
      let center = null
      if (centerName && centerName !== "-----") {
        center = costCenterByName.get(normalize(centerName))
        if (!center) {
          center = { id: uuidFromText(`cost-center:${normalize(centerName)}`), name: centerName, description: "Importado de planilha financeira", status: "Ativo" }
          costCenters.push(center)
          costCenterByName.set(normalize(centerName), center)
        }
      }
      const status = accountStatus(source.kind, row.SITUACAO)
      const confirmed = status === (source.kind === "payable" ? "Paga" : "Recebida")
      const accountId = uuidFromText(`${source.kind}:${code}`)
      const transactionId = uuidFromText(`transaction:${source.kind}:${code}`)
      const competenceDate = isoDate(row["DATA DE COMPETENCIA"])
      const dueDate = isoDate(row["DATA DE VENCIMENTO"]) || competenceDate
      const doneDate = isoDate(row["DATA DE CONFIRMACAO"])
      const description = row.DESCRICAO || `Lancamento ${code}`
      const notes = `Recuperado da planilha | Codigo: ${code} | Arquivo: ${path.basename(source.file)}\nSituacao: ${row.SITUACAO}\nPlano de contas: ${plan}`
      const commonTransaction = {
        id: transactionId, type, description, category_id: category.id, subcategory_id: null, cost_center_id: center?.id || null,
        dre_account_id: category.dre_account_id, competence_date: competenceDate, due_date: dueDate, realized_date: confirmed ? (doneDate || dueDate) : null,
        expected_amount: amount, realized_amount: confirmed ? amount : 0, payment_method: row["FORMA DE PAGAMENTO"] || "",
        bank_account_id: null, status: confirmed ? "Realizado" : "Previsto", origin: source.kind === "payable" ? "Conta a pagar" : "Conta a receber",
        notes, attachment_url: path.basename(source.file), supplier_name: source.kind === "payable" ? (row["DESTINADO A"] || "Fornecedor nao informado") : "",
      }
      if (source.kind === "payable") {
        accountsPayable.push({
          id: accountId, supplier_name: row["DESTINADO A"] || "Fornecedor nao informado", description, category_id: category.id,
          subcategory_id: null, cost_center_id: center?.id || null, dre_account_id: category.dre_account_id, competence_date: competenceDate,
          due_date: dueDate, payment_date: confirmed ? (doneDate || dueDate) : null, expected_amount: amount, paid_amount: confirmed ? amount : 0,
          payment_method: row["FORMA DE PAGAMENTO"] || "", bank_account_id: null, status, origin: "Recuperacao Excel", notes, attachment_url: path.basename(source.file),
        })
      } else {
        accountsReceivable.push({
          id: accountId, description, category_id: category.id, subcategory_id: null, cost_center_id: center?.id || null, dre_account_id: category.dre_account_id,
          competence_date: competenceDate, due_date: dueDate, received_date: confirmed ? (doneDate || dueDate) : null, expected_amount: amount,
          received_amount: confirmed ? amount : 0, receipt_method: row["FORMA DE PAGAMENTO"] || "", bank_account_id: null, status,
          origin: "Recuperacao Excel", notes: `${notes}\nCliente/Destinado: ${row["DESTINADO A"] || ""}`, attachment_url: path.basename(source.file),
        })
      }
      transactions.push(commonTransaction)
      totals[source.kind].amount += amount
      if (confirmed) totals[source.kind].realized += amount
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    snapshot,
    before: Object.fromEntries(tableNames.map((table) => [table, current[table].length])),
    recovery: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, { rows: value.rows, amount: Number(value.amount.toFixed(2)), realized: Number(value.realized.toFixed(2)) }])),
    rowsToUpsert: { categories: categories.length - current.financial_categories.length, costCenters: costCenters.length - current.cost_centers.length, accountsPayable: accountsPayable.length, accountsReceivable: accountsReceivable.length, transactions: transactions.length },
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!apply) return

  await upsertBatches(supabase, "financial_categories", categories)
  await upsertBatches(supabase, "cost_centers", costCenters)
  await upsertBatches(supabase, "accounts_payable", accountsPayable)
  await upsertBatches(supabase, "accounts_receivable", accountsReceivable)
  await upsertBatches(supabase, "financial_transactions", transactions)
  console.log("RECOVERY_APPLIED")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
