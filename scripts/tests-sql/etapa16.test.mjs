// Etapa 16: limpeza do catálogo e das vendas/produção (script 236): transação única, trava de confirmação, sem órfãos e sem tocar clientes, fornecedores e Financeiro.
import fs from "node:fs"
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db
let keySeq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"fabrica@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => {
  let failure = null
  try { await db.query(sql, params) } catch (error) { failure = error }
  assert.ok(failure, `esperava erro: ${sql.slice(0, 100)}`)
  if (pattern) assert.match(failure.message, pattern, `erro diferente do esperado em: ${sql.slice(0, 100)}`)
}
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const key = () => `k${++keySeq}-${Math.random().toString(36).slice(2, 8)}`

async function material(name, { unit = "UN", cost = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [id, qty])
async function worker(code, name, sectors, extra = {}) {
  return (await one("select public.shop_worker_save($1::jsonb, 'gestor') id", [JSON.stringify({ code, name, sectors, pin: "1234", ...extra })])).id
}
const login = async (code, pin = "1234") => (await one("select public.shop_worker_login($1, $2, 'tablet-1') r", [code, pin])).r.token
const codeOf = async (name) => (await one("select code from public.shop_workers where name = $1", [name])).code
const start = (token, task, k = key()) => one("select public.shop_task_start($1, $2::uuid, $3) r", [token, task, k]).then((r) => r.r)
const pause = (token, task, reason = "Intervalo", k = key()) => one("select public.shop_task_pause($1, $2::uuid, $3, null, $4) r", [token, task, reason, k]).then((r) => r.r)
const finish = (token, task, extra = {}) => one("select public.shop_task_finish($1, $2::uuid, $3::jsonb) r", [token, task, JSON.stringify({ request_key: key(), ...extra })]).then((r) => r.r)
const consume = (token, task, material, quantity, k = key()) => one("select public.shop_task_consume($1, $2::uuid, $3::uuid, $4::numeric, $5) r", [token, task, material, quantity, k]).then((r) => r.r)

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql", "235_vinculos_pedido_ordem_kits.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await one("select public.shop_steps_seed('teste') n")
  await worker("S01", "Soldador A", ["Soldagem"])
  await worker("S02", "Soldador B", ["Soldagem"])
})

/** Oportunidade -> proposta aprovada -> pedido -> confirmação: o mesmo caminho do FECHAR VENDA. */
async function sell(productId, quantity) {
  const client = (await one("select id from public.clients limit 1")).id
  const sp = (await one("select id from public.salespeople limit 1")).id
  const opp = await one("insert into public.opportunities (title, client_id, salesperson_id, interest, estimated_value, stage) values ('Venda E2E', $1, $2, 'Carreta', $3, 'Negociação') returning id", [client, sp, quantity * 9000])
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [productId]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, opportunity_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, $2, $3, current_date + 15, 'Produto', 'Aprovado', $4, $4) returning id", [client, sp, opp.id, quantity * 9000])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', $3, 9000, 9000, $4, $5, $6, $7, 10, $8)",
    [quote.id, productId, quantity, snap.est_cost, quantity * 9000, snap.bom_version_id, snap.bom_version, snap.sku])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
  const confirmed = (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [order])).r
  const po = await one("select * from public.production_orders where sales_order_id = $1", [order])
  return { order, po: po.id, confirmed }
}
const productWith = async (name, kits) => (await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: { kits: kits.map((kit) => ({ kit_id: kit, quantity: 1 })), activate: true } })).product_id


const CLEANUP = fs.readFileSync(new URL("../236_limpar_catalogo_e_vendas.sql", import.meta.url), "utf8")
const orphans = async () => {
  const fks = await all(`select c.conrelid::regclass::text child, a.attname child_col, c.confrelid::regclass::text parent, pa.attname parent_col from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`)
  const found = []
  for (const fk of fks) {
    const n = num((await one(`select count(*) n from ${fk.child} c where c.${fk.child_col} is not null and not exists (select 1 from ${fk.parent} p where p.${fk.parent_col} = c.${fk.child_col})`)).n)
    if (n) found.push(`${fk.child}.${fk.child_col}: ${n}`)
  }
  return found
}
const count = async (table) => num((await one(`select count(*) n from public.${table}`)).n)

test("limpeza: recusa sem confirmação; com confirmação apaga catálogo, vendas e produção, sem órfãos e sem tocar clientes, fornecedores e Financeiro", async () => {
  // dados completos: matéria-prima -> kit -> produto -> venda confirmada -> tablet -> compra
  const barra = await material("Barra Limpeza", { unit: "M" })
  await stockIn(barra, 10)
  const kit = (await rpc("kit_save", { name: "Kit Limpeza", category: "Chassi", components: [{ component_id: barra, quantity: 6, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await productWith("Carreta Limpeza", [kit])
  const sale = await sell(product, 2)
  const sold = await login(await codeOf("Soldador A"))
  const task = await one("select * from public.shop_tasks where production_order_id = $1 and unit_number = 1 and step_code = 'soldagem'", [sale.po])
  await start(sold, task.id)
  await db.query("select public.generate_purchase_request_consolidated('Gerente')")
  await db.query("insert into public.suppliers (name) values ('Fornecedor Que Fica')")
  await db.query("insert into public.financial_transactions (type, description, expected_amount, status) values ('saida', 'Lançamento financeiro que fica', 100, 'Previsto')")
  assert.ok(await count("materials") >= 3 && await count("production_orders") === 1 && await count("shop_tasks") > 0)

  // sem confirmação: nada acontece
  await rejects(CLEANUP, [], /Nada foi apagado/)
  assert.ok(await count("materials") >= 3 && await count("sales_orders") === 1)

  // com confirmação: apaga tudo que é do catálogo/vendas/produção
  await db.exec(CLEANUP.replace("v_confirmar text := 'NAO'", "v_confirmar text := 'SIM'"))
  for (const table of ["materials", "kit_versions", "kit_components", "product_bom_versions", "product_kits", "quotes", "quote_items", "opportunities", "sales_orders", "sales_order_items", "production_orders", "production_order_kits", "production_order_materials",
    "shop_tasks", "shop_task_events", "shop_time_entries", "stock_movements", "stock_balances", "purchase_requests", "purchase_request_items", "purchase_request_sources", "vehicle_documentation", "production_events"]) {
    assert.equal(await count(table), 0, `${table} deveria estar vazia`)
  }
  assert.deepEqual(await orphans(), [], "nenhuma chave estrangeira pode ficar órfã")
  // o que NÃO é para apagar
  assert.equal(await count("clients"), 1)
  assert.equal(await count("salespeople"), 1)
  assert.equal(await count("suppliers"), 1)
  assert.equal(await count("financial_transactions"), 1)
  assert.ok(await count("shop_workers") >= 2 && await count("shop_steps") >= 8)

  // o sistema continua funcionando depois da limpeza: novo cadastro e nova venda fecham a cadeia inteira
  const barra2 = await material("Barra Depois", { unit: "M" })
  await stockIn(barra2, 100)
  const kit2 = (await rpc("kit_save", { name: "Kit Depois", category: "Chassi", components: [{ component_id: barra2, quantity: 6, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const novo = await sell(await productWith("Carreta Depois", [kit2]), 1)
  assert.equal(num((await one("select count(*) n from public.production_order_kits where production_order_id = $1", [novo.po])).n), 1)
  assert.deepEqual(await orphans(), [])
})
