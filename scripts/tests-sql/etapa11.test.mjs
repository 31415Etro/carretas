// Etapa 11: matrícula automática, ordem de produção aberta direto na produção e documentação veicular sem pedido de venda.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db
let vinSeq = 0
let keySeq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"avulsa@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => {
  let failure = null
  try { await db.query(sql, params) } catch (error) { failure = error }
  assert.ok(failure, `esperava erro: ${sql.slice(0, 100)}`)
  if (pattern) assert.match(failure.message, pattern, `erro diferente do esperado em: ${sql.slice(0, 100)}`)
}
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const key = () => `k${++keySeq}-${Math.random().toString(36).slice(2, 8)}`
const newVin = () => `9BWZZZ377VT${String(300000 + vinSeq++).slice(-6)}`

async function material(name, { unit = "UN" } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, 1, 1, 'Aço') returning id", [name, unit, sku])).id
}
async function product(name, { withBom = true, stock = 500 } = {}) {
  const aco = await material(`Aço ${name}`, { unit: "M" })
  await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [aco, stock])
  const kit = (await rpc("kit_save", { name: `Kit ${name}`, category: "Chassi", components: [{ component_id: aco, quantity: 6, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const r = await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: withBom ? { kits: [{ kit_id: kit, quantity: 1 }], activate: true } : undefined })
  return { id: r.product_id, aco }
}
const clientId = async () => (await one("select id from public.clients where document is not null limit 1")).id
const docsOf = (po) => all("select * from public.vehicle_documentation where production_order_id = $1 order by unit_number", [po])
const taskOf = async (po, unit, code) => one("select * from public.shop_tasks where production_order_id = $1 and unit_number = $2 and step_code = $3", [po, unit, code])

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await db.exec(`select public.sales_settings_update('{"require_payment_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)
  await one("select public.shop_steps_seed('teste') n")
})

test("matrícula do colaborador é gerada pelo sistema, sequencial por empresa, e não muda", async () => {
  const a = await rpc("shop_worker_save", { name: "Ana", pin: "1234", sectors: ["Soldagem"], code: "MANUAL-1" }).catch(async () => (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name: "Ana", pin: "1234", sectors: ["Soldagem"], code: "MANUAL-1" })])).id)
  const b = (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name: "Bruno", pin: "1234" })])).id
  const codes = (await all("select name, code from public.shop_workers where system_company_id = $1 order by created_at, name", [COMPANY_A])).map((w) => [w.name, w.code])
  assert.deepEqual(codes, [["Ana", "F0001"], ["Bruno", "F0002"]])          // o código digitado é ignorado
  await db.query("select public.shop_worker_save($1::jsonb, 'g')", [JSON.stringify({ worker_id: b, name: "Bruno Silva", code: "TROCADO" })])
  assert.equal((await one("select code from public.shop_workers where id = $1", [b])).code, "F0002")   // a matrícula não muda na edição
  assert.equal((await one("select (public.shop_worker_login('F0001', '1234', 'tablet') ->> 'ok')::boolean ok")).ok, true)
  await rejects("select public.shop_worker_save('{\"pin\":\"1234\"}'::jsonb, 'g')", [], /nome/)
  await asCompany(COMPANY_B)                                              // outra empresa começa a sua própria sequência
  const carla = (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name: "Carla", pin: "1234" })])).id
  assert.equal((await one("select code from public.shop_workers where id = $1", [carla])).code, "F0001")
  await asCompany(COMPANY_A)
  await db.query("update public.shop_workers set active = false where id = $1", [a])
  const davi = (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name: "Davi", pin: "1234" })])).id
  assert.equal((await one("select code from public.shop_workers where id = $1", [davi])).code, "F0003")                                                // inativos não liberam número
  assert.ok(a)
})

test("ordem de produção aberta direto na produção: estrutura ativa congelada, materiais reservados e tarefas da esteira, sem pedido de venda", async () => {
  const p = await product("Avulsa Um")
  const r = await rpc("production_order_create_manual", { product_id: p.id, quantity: 2, planned_end: "2026-12-20", priority: 2, notes: "Para exposição" })
  const po = await one("select * from public.production_orders where id = $1", [r.production_order_id])
  assert.equal(po.sales_order_id, null); assert.equal(po.sales_order_item_id, null); assert.equal(num(po.quantity), 2); assert.equal(po.status, "Pronta para producao")
  assert.equal(po.notes, "Para exposição"); assert.equal(num(po.priority), 2)
  const mats = await all("select * from public.production_order_materials where production_order_id = $1", [po.id])
  assert.equal(mats.length, 1); assert.equal(num(mats[0].required_quantity), 12); assert.equal(num(mats[0].reserved_quantity), 12)
  assert.equal(num((await one("select count(*) n from public.production_order_kits where production_order_id = $1", [po.id])).n), 1)
  assert.equal(num((await one("select count(*) n from public.shop_tasks where production_order_id = $1", [po.id])).n), 16)   // 8 etapas x 2 unidades
  assert.equal(num((await one("select count(*) n from public.shop_unit_tokens where production_order_id = $1", [po.id])).n), 2)
  await rejects("select public.production_order_create_manual($1::jsonb)", [JSON.stringify({ product_id: p.id, quantity: 1.5 })], /inteiro/)
  await rejects("select public.production_order_create_manual($1::jsonb)", [JSON.stringify({ product_id: p.id, quantity: 0 })], /inteiro/)
  await rejects("select public.production_order_create_manual($1::jsonb)", [JSON.stringify({ quantity: 1 })], /Escolha o produto/)
  const semEstrutura = await product("Avulsa Sem Estrutura", { withBom: false })
  await rejects("select public.production_order_create_manual($1::jsonb)", [JSON.stringify({ product_id: semEstrutura.id, quantity: 1 })], /estrutura de fabricação ativa/)
  // estoque insuficiente não cria ordem "pela metade": a ordem fica aguardando materiais, igual às ordens do pedido
  const grande = await rpc("production_order_create_manual", { product_id: p.id, quantity: 200 })
  assert.equal(grande.status, "Aguardando materiais")
})

test("a ordem avulsa anda na esteira e no tablet: chassi pela documentação ligada à ordem libera a tarefa e a fabricação começa", async () => {
  await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name: "Soldador Avulsa", pin: "1234", sectors: ["Soldagem"] })])
  const code = (await one("select code from public.shop_workers where name = 'Soldador Avulsa'")).code
  const token = (await one("select public.shop_worker_login($1, '1234', 'tablet') r", [code])).r.token
  const p = await product("Avulsa Dois")
  const r = await rpc("production_order_create_manual", { product_id: p.id, quantity: 1, client_id: await clientId(), create_documentation: true })
  assert.equal(r.documentation_created, 1)
  const doc = (await docsOf(r.production_order_id))[0]
  assert.equal(doc.sales_order_id, null); assert.equal(doc.status, "Pendente de dados"); assert.equal(doc.unit_number, 1)
  let sold = await taskOf(r.production_order_id, 1, "soldagem")
  assert.equal(sold.status, "Bloqueada"); assert.match(sold.blocked_reason, /chassi/i)
  const vin = newVin()
  await rpc("vehicle_doc_update", { documentation_id: doc.id, vin })
  await db.query("select public.shop_task_refresh($1::uuid)", [r.production_order_id])
  sold = await taskOf(r.production_order_id, 1, "soldagem")
  assert.equal(sold.status, "Pronta")
  const started = (await one("select public.shop_task_start($1, $2::uuid, $3) r", [token, sold.id, key()])).r
  assert.equal(started.status, "Em execucao")
  assert.equal((await one("select status from public.production_orders where id = $1", [r.production_order_id])).status, "Em producao")
  const card = (await one("select public.shop_my_tasks($1) r", [token])).r.tasks.find((t) => t.order_code === r.code)
  assert.equal(card.vin, vin)
  const board = (await one("select public.shop_board() b")).b
  assert.ok(board.units.some((u) => u.order_code === r.code && u.vin === vin))
})

test("documentação veicular sem pedido: avulsa ou por ordem, com lista, detalhe, unidades e chassi único", async () => {
  const p = await product("Doc Avulsa")
  const client = await clientId()
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ product_id: p.id })], /cliente/)
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ client_id: client })], /produto/)
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ client_id: client, product_id: p.id, vin: "ABC" })], /inválido/)
  const vin = newVin()
  const created = await rpc("vehicle_documentation_create_manual", { client_id: client, product_id: p.id, vin, notes: "Carreta de demonstração" })
  assert.equal(created.unit_number, 1)
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ client_id: client, product_id: p.id, vin })], /chassi já está/)
  const list = (await all("select * from public.vehicle_doc_list(null, null, null, 50, 0)")).find((d) => d.id === created.documentation_id)
  assert.equal(list.order_number, "Avulsa"); assert.equal(list.client_name, "Cliente Teste"); assert.equal(list.vin, vin); assert.equal(list.units_in_item, 1)
  const detail = (await one("select public.vehicle_doc_detail($1::uuid) d", [created.documentation_id])).d
  assert.equal(detail.documentation.order_number, "Avulsa"); assert.deepEqual(detail.documentation.missing, [])
  // o envio funciona sem pedido (o conteúdo vai com os dados do chassi, do cliente e do modelo)
  const begin = (await one("select public.vehicle_doc_begin_submit($1::uuid, $2, 'Operador') r", [created.documentation_id, key()])).r
  assert.equal(begin.duplicate, false); assert.equal(begin.payload.sales_order, null); assert.equal(begin.payload.vin, vin)
  assert.ok((await all("select * from public.vehicle_documentation_events where documentation_id = $1", [created.documentation_id])).some((e) => /sem pedido de venda/.test(e.description)))
  // por ordem: usa a próxima unidade livre e para quando acabam
  const order = await rpc("production_order_create_manual", { product_id: p.id, quantity: 2 })
  const d1 = await rpc("vehicle_documentation_create_manual", { client_id: client, production_order_id: order.production_order_id })
  const d2 = await rpc("vehicle_documentation_create_manual", { client_id: client, production_order_id: order.production_order_id })
  assert.deepEqual([d1.unit_number, d2.unit_number], [1, 2])
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ client_id: client, production_order_id: order.production_order_id })], /já têm documentação/)
  await db.query("update public.vehicle_documentation set status = 'Cancelado', cancelled_reason = 'erro' where id = $1", [d1.documentation_id])
  assert.equal((await rpc("vehicle_documentation_create_manual", { client_id: client, production_order_id: order.production_order_id })).unit_number, 1)   // unidade cancelada volta a ficar livre
})

test("o fluxo de venda continua igual: documentação do pedido aparece com o número do pedido e a produção nasce do pedido", async () => {
  const p = await product("Fluxo Venda")
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [p.id]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', 9000, 9000) returning id", [await clientId()])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', 1, 9000, 9000, $3, 9000, $4, $5, 10, $6)", [quote.id, p.id, snap.est_cost, snap.bom_version_id, snap.bom_version, snap.sku])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order.sales_order_id])
  const doc = (await all("select * from public.vehicle_doc_list(null, null, $1::uuid, 10, 0)", [order.sales_order_id]))[0]
  assert.equal(doc.order_number, order.order_number)
  const po = await one("select * from public.production_orders where sales_order_id = $1", [order.sales_order_id])
  assert.ok(po && num((await one("select count(*) n from public.shop_tasks where production_order_id = $1", [po.id])).n) === 8)
})

test("isolamento: outra empresa não vê nem cria documentação para ordem de uma empresa", async () => {
  const p = await product("Isola Avulsa")
  const order = await rpc("production_order_create_manual", { product_id: p.id, quantity: 1 })
  await asCompany(COMPANY_B)
  await rejects("select public.vehicle_documentation_create_manual($1::jsonb)", [JSON.stringify({ client_id: await clientId().catch(() => null), production_order_id: order.production_order_id })], /Ordem de produção não encontrada|cliente/)
  assert.deepEqual((await all("select * from public.vehicle_doc_list(null, null, null, 50, 0)")), [])
  await asCompany(COMPANY_A)
})
