// Etapa 12: esteira sem impedimentos. Designar um colaborador e a tarefa roda (sem exigir material reservado, pagamento ou chassi).
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
let db
let keySeq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const rejects = async (sql, params, pattern) => {
  let failure = null
  try { await db.query(sql, params) } catch (error) { failure = error }
  assert.ok(failure, `esperava erro: ${sql.slice(0, 100)}`)
  if (pattern) assert.match(failure.message, pattern)
}
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const key = () => `k${++keySeq}-${Math.random().toString(36).slice(2, 8)}`
const taskOf = (po, unit, code) => one("select * from public.shop_tasks where production_order_id = $1 and unit_number = $2 and step_code = $3", [po, unit, code])
const workers = {}

async function product(name, { stock = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  const aco = (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, 'M', 'Materia-prima', $2, 'Ativo', false, 1, 1, 'Aço') returning id", [`Aço ${name}`, sku])).id
  if (stock > 0) await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [aco, stock])
  const kit = (await rpc("kit_save", { name: `Kit ${name}`, category: "Chassi", components: [{ component_id: aco, quantity: 6, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const r = await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: kit, quantity: 1 }], activate: true } })
  return r.product_id
}
async function worker(name, sectors, extra = {}) {
  const id = (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name, sectors, pin: "1234", ...extra })])).id
  const code = (await one("select code from public.shop_workers where id = $1", [id])).code
  workers[name] = { id, code, token: (await one("select public.shop_worker_login($1, '1234', 'tablet') r", [code])).r.token }
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql"] })
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await one("select public.shop_steps_seed('teste') n")
  await worker("Soldador", ["Soldagem"])
  await worker("Montador", ["Montagem"])
})

test("ordem sem material: as tarefas não ficam bloqueadas e iniciar leva a ordem para Em produção", async () => {
  const p = await product("Sem Material", { stock: 1 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 2 })
  assert.equal(r.status, "Pronta para producao")                              // a ordem não espera material
  assert.equal(num((await one("select count(*) n from public.stock_reservations where production_order_id = $1", [r.production_order_id])).n), 0)
  const t = await taskOf(r.production_order_id, 1, "soldagem")
  assert.equal(t.status, "Pronta"); assert.equal(t.blocked_reason, null)       // produto exige documentação e não há chassi: ainda assim liberada
  assert.equal((await taskOf(r.production_order_id, 1, "acabamento")).status, "Aguardando")   // a sequência da esteira continua valendo
  const started = (await one("select public.shop_task_start($1, $2::uuid, $3) r", [workers.Soldador.token, t.id, key()])).r
  assert.equal(started.status, "Em execucao")
  assert.equal((await one("select status from public.production_orders where id = $1", [r.production_order_id])).status, "Em producao")
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'troca' where ended_at is null")
})

test("tarefas que já estavam bloqueadas pela regra antiga se liberam sozinhas", async () => {
  const p = await product("Bloqueada Antiga", { stock: 100 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  const t = await taskOf(r.production_order_id, 1, "soldagem")
  await db.query("update public.shop_tasks set status = 'Bloqueada', blocked_reason = 'Produção não liberada: Falta a autorização operacional da produção.' where id = $1", [t.id])
  const mine = (await one("select public.shop_my_tasks($1) r", [workers.Soldador.token])).r.tasks.find((x) => x.id === t.id)
  assert.equal(mine.status, "Pronta")
})

test("chassi só bloqueia se a empresa ligar a opção", async () => {
  const p = await product("Chassi Opcional", { stock: 100 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  assert.equal((await taskOf(r.production_order_id, 1, "soldagem")).status, "Pronta")
  await rpc("shop_settings_update", { require_vin_before_tasks: true })
  await db.query("select public.shop_task_refresh($1::uuid)", [r.production_order_id])
  assert.equal((await taskOf(r.production_order_id, 1, "soldagem")).status, "Bloqueada")
  await rpc("shop_settings_update", { require_vin_before_tasks: false })
  await db.query("select public.shop_task_refresh($1::uuid)", [r.production_order_id])
  assert.equal((await taskOf(r.production_order_id, 1, "soldagem")).status, "Pronta")
})

test("designar a tarefa a um colaborador não exige justificativa; trocar quem já está com ela exige", async () => {
  const p = await product("Designar", { stock: 100 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  const t = await taskOf(r.production_order_id, 1, "soldagem")
  // o Montador não é do setor de soldagem: só vê a tarefa depois de designada a ele
  assert.equal((await one("select public.shop_my_tasks($1) r", [workers.Montador.token])).r.tasks.some((x) => x.id === t.id), false)
  await db.query("select public.shop_task_reassign($1::uuid, $2::uuid, null, 'Gestor')", [t.id, workers.Montador.id])
  assert.equal((await one("select event from public.shop_task_events where task_id = $1 order by at desc limit 1", [t.id])).event, "Designada")
  assert.equal((await one("select public.shop_my_tasks($1) r", [workers.Montador.token])).r.tasks.some((x) => x.id === t.id), true)
  assert.equal((await one("select public.shop_my_tasks($1) r", [workers.Soldador.token])).r.tasks.some((x) => x.id === t.id), false)   // quem recebeu é quem roda
  await rejects("select public.shop_task_reassign($1::uuid, $2::uuid, null, 'Gestor')", [t.id, workers.Soldador.id], /justificativa/)
  await db.query("select public.shop_task_reassign($1::uuid, $2::uuid, 'Montador foi para outra frente', 'Gestor')", [t.id, workers.Soldador.id])
  assert.equal((await one("select public.shop_task_start($1, $2::uuid, $3) r", [workers.Soldador.token, t.id, key()])).r.status, "Em execucao")
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'troca' where ended_at is null")
})

test("designar a unidade inteira de uma vez atribui só o que ainda não tem responsável", async () => {
  const p = await product("Designar Tudo", { stock: 100 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 2 })
  const first = await taskOf(r.production_order_id, 1, "montagem")
  await db.query("select public.shop_task_reassign($1::uuid, $2::uuid, null, 'Gestor')", [first.id, workers.Soldador.id])
  const n = (await one("select public.shop_order_assign($1::uuid, 1, $2::uuid, 'Gestor') n", [r.production_order_id, workers.Montador.id])).n
  assert.equal(num(n), 6)                                                    // 8 etapas - acabamento (terceirizada) - montagem (já designada)
  assert.equal((await taskOf(r.production_order_id, 1, "montagem")).assigned_worker_id, workers.Soldador.id)
  assert.equal(num((await one("select count(*) n from public.shop_tasks where production_order_id = $1 and unit_number = 2 and assigned_worker_id is not null", [r.production_order_id])).n), 0)
})

test("pedido com sinal ainda não confirmado: as tarefas aparecem liberadas (a regra de pagamento fica nas Configurações de Vendas)", async () => {
  await db.exec(`select public.sales_settings_update('{"require_payment_before_production":true,"require_operational_authorization":true}'::jsonb, 'teste')`)
  const p = await product("Pedido Sinal", { stock: 100 })
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [p]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ((select id from public.clients limit 1), (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', 9000, 9000) returning id")
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', 1, 9000, 9000, $3, 9000, $4, $5, 10, $6)", [quote.id, p, snap.est_cost, snap.bom_version_id, snap.bom_version, snap.sku])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order])
  const po = await one("select id from public.production_orders where sales_order_id = $1", [order])
  const t = await taskOf(po.id, 1, "soldagem")
  assert.equal(t.status, "Pronta"); assert.equal(t.blocked_reason, null)
  await db.exec(`select public.sales_settings_update('{"require_payment_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)
  assert.equal((await one("select public.shop_task_start($1, $2::uuid, $3) r", [workers.Soldador.token, t.id, key()])).r.status, "Em execucao")
})

test("sem material: o consumo sem saldo fica registrado na tarefa e concluir a unidade não exige material", async () => {
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'troca' where ended_at is null")
  const p = await product("Sem Saldo", { stock: 0 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  const po = r.production_order_id
  const aco = (await one("select material_id from public.production_order_materials where production_order_id = $1", [po])).material_id
  const sold = workers.Soldador.token
  const t = await taskOf(po, 1, "soldagem")
  await one("select public.shop_task_start($1, $2::uuid, $3) r", [sold, t.id, key()])
  const c = (await one("select public.shop_task_consume($1, $2::uuid, $3::uuid, 6, $4) r", [sold, t.id, aco, key()])).r
  assert.equal(c.without_stock_write_off, true)
  assert.equal(num((await one("select count(*) n from public.production_consumptions where production_order_id = $1", [po])).n), 0)
  assert.equal(num((await one("select count(*) n from public.shop_task_consumptions where task_id = $1", [t.id])).n), 1)
  await one("select public.shop_task_finish($1, $2::uuid, $3::jsonb) r", [sold, t.id, JSON.stringify({ request_key: key() })])
  await db.query("update public.shop_tasks set status = 'Concluida', finished_at = now() where production_order_id = $1 and status not in ('Concluida', 'Cancelada') and kind <> 'administrativa'", [po])
  const rec = (await one("select public.shop_unit_receive($1::uuid, 1, 'Gestor') r", [po])).r
  assert.equal(rec.duplicate, false)
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Concluida")
})

test("a regra não deixa mais existir o estado 'Aguardando materiais'", async () => {
  const p = await product("Antiga Aguardando", { stock: 100 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  await db.query("update public.production_orders set status = 'Aguardando materiais' where id = $1", [r.production_order_id])
  assert.equal((await one("select status from public.production_orders where id = $1", [r.production_order_id])).status, "Pronta para producao")
})
