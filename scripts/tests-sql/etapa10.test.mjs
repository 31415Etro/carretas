// Etapa 10: chão de fábrica digital (tablets): sessões por colaborador, esteira, tarefas por unidade, tempo, consumo, checklist, medidas, terceirizado, QR e expedição.
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
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"fabrica@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => {
  let failure = null
  try { await db.query(sql, params) } catch (error) { failure = error }
  assert.ok(failure, `esperava erro: ${sql.slice(0, 100)}`)
  if (pattern) assert.match(failure.message, pattern, `erro diferente do esperado em: ${sql.slice(0, 100)}`)
}
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const key = () => `k${++keySeq}-${Math.random().toString(36).slice(2, 8)}`
const newVin = () => `9BWZZZ377VT${String(100000 + vinSeq++).slice(-6)}`

async function material(name, { unit = "UN", cost = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [id, qty])

const WORKERS = {}
async function worker(code, name, sectors, extra = {}) {
  const id = await one("select public.shop_worker_save($1::jsonb, 'gestor') id", [JSON.stringify({ code, name, sectors, pin: "1234", hourly_rate: 20, ...extra })])
  WORKERS[code] = id.id
  return id.id
}
const login = async (code, pin = "1234") => (await one("select public.shop_worker_login($1, $2, 'tablet-1') r", [code, pin])).r.token

/** Produto com dois kits (chassi e elétrica), estoque, pedido confirmado e as unidades (uma documentação por unidade). */
async function setupOrder(name, quantity = 2, { stock = 1000 } = {}) {
  const aco = await material(`Aço ${name}`, { unit: "M" }); const chapa = await material(`Chapa ${name}`); const fio = await material(`Fio ${name}`, { unit: "M" })
  for (const m of [aco, chapa, fio]) await stockIn(m, stock)
  const kitChassi = (await rpc("kit_save", { name: `Kit Chassi ${name}`, category: "Chassi", components: [{ component_id: aco, quantity: 6, unit: "M", loss_percent: 0 }, { component_id: chapa, quantity: 2, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const kitEletrica = (await rpc("kit_save", { name: `Kit Elétrica ${name}`, category: "Elétrica", components: [{ component_id: fio, quantity: 4, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: kitChassi, quantity: 1 }, { kit_id: kitEletrica, quantity: 1 }], activate: true } })
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [product.product_id]))[0]
  const client = (await one("select id from public.clients where document is not null limit 1")).id
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', $2, $2) returning id", [client, quantity * 9000])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', $3, 9000, 9000, $4, $5, $6, $7, 10, $8)",
    [quote.id, product.product_id, quantity, snap.est_cost, quantity * 9000, snap.bom_version_id, snap.bom_version, snap.sku])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order])
  const po = await one("select * from public.production_orders where sales_order_id = $1", [order])
  return { order, po: po.id, code: po.code, product: product.product_id, materials: { aco, chapa, fio }, kits: { kitChassi, kitEletrica } }
}
const docs = (order) => all("select * from public.vehicle_documentation where sales_order_id = $1 order by unit_number", [order])
const setVin = async (docId) => { const vin = newVin(); await rpc("vehicle_doc_update", { documentation_id: docId, vin }); return vin }
const tasks = (po, unit) => all("select * from public.shop_tasks where production_order_id = $1 and unit_number = $2 order by seq", [po, unit])
const taskOf = async (po, unit, code) => (await one("select * from public.shop_tasks where production_order_id = $1 and unit_number = $2 and step_code = $3", [po, unit, code]))
const statusOf = async (id) => (await one("select status from public.shop_tasks where id = $1", [id])).status
const refresh = (po) => db.query("select public.shop_task_refresh($1::uuid)", [po])
const start = (token, task, k = key()) => one("select public.shop_task_start($1, $2::uuid, $3) r", [token, task, k]).then((r) => r.r)
const pause = (token, task, reason = "Intervalo", note = null, k = key()) => one("select public.shop_task_pause($1, $2::uuid, $3, $4, $5) r", [token, task, reason, note, k]).then((r) => r.r)
const finish = (token, task, extra = {}) => one("select public.shop_task_finish($1, $2::uuid, $3::jsonb) r", [token, task, JSON.stringify({ request_key: key(), ...extra })]).then((r) => r.r)
const consume = (token, task, material, quantity, k = key()) => one("select public.shop_task_consume($1, $2::uuid, $3::uuid, $4::numeric, $5) r", [token, task, material, quantity, k]).then((r) => r.r)

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  // sem exigir sinal nem autorização: o foco aqui é a esteira (as regras de liberação têm testes próprios)
  await db.exec(`select public.sales_settings_update('{"require_payment_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)
  await one("select public.shop_steps_seed('teste') n")
  await worker("S01", "Soldador A", ["Soldagem"])
  await worker("S02", "Soldador B", ["Soldagem"])
  await worker("M01", "Montador", ["Montagem"])
  await worker("Q01", "Inspetor", ["Qualidade"], { is_inspector: true })
  await worker("E01", "Expedição", ["Expedição"])
  await worker("G01", "Supervisor", [], { is_supervisor: true })
})

test("esteira oficial: 8 etapas, tarefas por unidade, chassi reservado libera e dependências avançam sozinhas", async () => {
  assert.equal(num((await one("select count(*) n from public.shop_steps where system_company_id = $1", [COMPANY_A])).n), 8)
  assert.equal(num((await one("select public.shop_steps_seed() n")).n), 0)   // repetir não duplica
  const o = await setupOrder("Esteira", 2)
  const t1 = await tasks(o.po, 1)
  assert.equal(t1.length, 8)
  assert.deepEqual(t1.map((t) => t.step_code), ["soldagem", "acabamento", "montagem", "gravacao", "checklist", "medidas", "faixas", "despachante"])
  assert.equal(t1[0].status, "Bloqueada"); assert.match(t1[0].blocked_reason, /chassi/i)   // chassi ainda não reservado
  assert.equal(t1[1].status, "Bloqueada")
  const [d1] = await docs(o.order)
  await setVin(d1.id)
  await refresh(o.po)
  const after = await tasks(o.po, 1)
  assert.equal(after[0].status, "Pronta")
  assert.equal(after[1].status, "Aguardando")
  assert.equal((await tasks(o.po, 2))[0].status, "Bloqueada")        // a unidade 2 continua sem chassi
  assert.equal(num((await one("select count(*) n from public.shop_unit_tokens where production_order_id = $1", [o.po])).n), 2)
})

test("login por matrícula e PIN: erro genérico, bloqueio temporário, sessão por inatividade e encerramento", async () => {
  const tryLogin = async (code, pin) => (await one("select public.shop_worker_login($1, $2, 'tablet-2') r", [code, pin])).r
  assert.deepEqual([(await tryLogin("S01", "0000")).ok, (await tryLogin("S01", "0000")).message], [false, "Matrícula ou PIN inválidos."])
  assert.equal((await tryLogin("NAOEXISTE", "1234")).message, "Matrícula ou PIN inválidos.")          // mesma resposta: não revela se a matrícula existe
  assert.equal(JSON.stringify(await one("select public.shop_workers_list() l")).includes("pin"), JSON.stringify(await one("select public.shop_workers_list() l")).includes("has_pin"))
  assert.equal((await one("select pin_hash from public.shop_workers where code = 'S02'")).pin_hash.startsWith("$2"), true)   // só o hash bcrypt
  await worker("L01", "Bloqueado", ["Soldagem"])
  for (let i = 0; i < 5; i++) assert.equal((await tryLogin("L01", "9999")).ok, false)
  const locked = await tryLogin("L01", "1234")                                                         // PIN certo, mas já bloqueado
  assert.equal(locked.ok, false); assert.match(locked.message, /bloqueado/)
  await db.query("update public.shop_workers set locked_until = null where code = 'L01'")
  const token = await login("L01")
  assert.equal((await one("select (public.shop_session_worker($1)).name n", [token])).n, "Bloqueado")
  await db.query("update public.shop_sessions set last_seen_at = clock_timestamp() - interval '11 minutes' where worker_id = $1", [WORKERS.L01])
  await rejects("select public.shop_session_worker($1)", [token], /Sessão expirada/)
  const token2 = await login("L01")
  await db.query("select public.shop_worker_logout($1)", [token2])
  await rejects("select public.shop_session_worker($1)", [token2], /Sessão expirada/)
  await rejects("select public.shop_session_worker('token-inventado')", [], /Sessão expirada/)
  // trocar de colaborador no mesmo tablet não expõe credenciais: cada um tem seu token
  const a = await login("S01"); const b = await login("S02")
  assert.notEqual(a, b)
  assert.equal((await one("select (public.shop_session_worker($1)).code c", [a])).c, "S01")
  await db.query("update public.shop_workers set active = false where code = 'L01'")
})

test("cada colaborador vê só o que está autorizado a apontar; tarefa de outro setor é recusada", async () => {
  const o = await setupOrder("Autoriza", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const sold = await login("S01"); const mont = await login("M01")
  const mine = (await one("select public.shop_my_tasks($1) r", [sold])).r.tasks.filter((t) => t.order_code === o.code)
  assert.deepEqual(mine.map((t) => t.step_code), ["soldagem"])
  assert.equal((await one("select public.shop_my_tasks($1) r", [mont])).r.tasks.filter((t) => t.order_code === o.code).length, 0)   // montagem ainda não liberada
  const task = await taskOf(o.po, 1, "soldagem")
  await rejects("select public.shop_task_start($1, $2::uuid, $3)", [mont, task.id, key()], /não está autorizado/)
  await rejects("select public.shop_task_detail($1, $2::uuid)", [mont, task.id], /não está autorizado/)
  const detail = (await one("select public.shop_task_detail($1, $2::uuid) r", [sold, task.id])).r
  assert.equal(detail.task.model, "FZ 1E"); assert.equal(detail.task.unit_number, 1)
})

test("iniciar, pausar, retomar e finalizar: horário do servidor, motivos de pausa e sem apontamento duplicado", async () => {
  const o = await setupOrder("Ciclo", 1)
  const [d] = await docs(o.order); const vin = await setVin(d.id); await refresh(o.po)
  const sold = await login("S01")
  const task = await taskOf(o.po, 1, "soldagem")
  const k = key()
  const before = Date.now()
  const started = (await one("select public.shop_task_start($1, $2::uuid, $3, 'tablet-1', '2001-01-01T00:00:00Z') r", [sold, task.id, k])).r
  assert.equal(started.status, "Em execucao")
  const entry = await one("select * from public.shop_time_entries where task_id = $1", [task.id])
  assert.ok(Math.abs(new Date(entry.started_at).getTime() - before) < 15000, "horário vem do servidor, não do tablet")
  assert.equal((await one("select client_at from public.shop_task_events where task_id = $1 and request_key = $2", [task.id, k])).client_at.getUTCFullYear(), 2001)   // só auditoria
  assert.equal((await start(sold, task.id, k)).duplicate, true)                  // reenvio da mesma operação
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1", [task.id])).n), 1)
  assert.equal((await one("select status from public.production_orders where id = $1", [o.po])).status, "Em producao")
  await rejects("select public.shop_task_pause($1, $2::uuid, 'Fumar', null, $3)", [sold, task.id, key()], /motivo da pausa/)
  await rejects("select public.shop_task_pause($1, $2::uuid, 'Outro motivo', null, $3)", [sold, task.id, key()], /Descreva/)
  const pk = key()
  assert.equal((await pause(sold, task.id, "Falta de material", null, pk)).status, "Pausada")
  assert.equal((await pause(sold, task.id, "Falta de material", null, pk)).duplicate, true)
  await rejects("select public.shop_task_pause($1, $2::uuid, 'Intervalo', null, $3)", [sold, task.id, key()], /não está executando/)
  assert.equal(await statusOf(task.id), "Pausada")
  await start(sold, task.id)                                                      // retomada: novo trecho
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1", [task.id])).n), 2)
  const fk = key()
  const done = (await one("select public.shop_task_finish($1, $2::uuid, $3::jsonb) r", [sold, task.id, JSON.stringify({ request_key: fk, quantity_done: 1, notes: "Soldagem ok" })])).r
  assert.equal(done.status, "Concluida")
  assert.equal((await one("select public.shop_task_finish($1, $2::uuid, $3::jsonb) r", [sold, task.id, JSON.stringify({ request_key: fk })])).r.duplicate, true)
  await rejects("select public.shop_task_finish($1, $2::uuid, $3::jsonb)", [sold, task.id, JSON.stringify({ request_key: key() })], /já foi concluída/)
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1 and ended_at is null", [task.id])).n), 0)
  assert.equal((await taskOf(o.po, 1, "acabamento")).status, "Pronta")            // a seguinte foi liberada
  assert.equal((await one("select pause_reason from public.shop_time_entries where task_id = $1 and end_reason = 'pausa'", [task.id])).pause_reason, "Falta de material")
  await rejects("update public.shop_task_events set event = 'x' where task_id = $1", [task.id], /não podem ser alterados/)
  await rejects("delete from public.shop_time_entries where task_id = $1", [task.id], /não pode ser apagado/)
  assert.ok(vin)
})

test("dois colaboradores na mesma tarefa: horas individuais, tempo cronológico sem soma e um trecho aberto por pessoa", async () => {
  const o = await setupOrder("Dupla", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const a = await login("S01"); const b = await login("S02")
  const task = await taskOf(o.po, 1, "soldagem")
  await start(a, task.id); await start(b, task.id)            // soldagem admite colaboração simultânea
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1 and ended_at is null", [task.id])).n), 2)
  await rejects("select public.shop_task_start($1, $2::uuid, $3)", [a, task.id, key()], /já está executando/)
  // montamos trechos conhecidos para conferir a conta: A 09:00–11:30 (150 min), B 09:30–12:45 (195 min) => cronológico 225 min, mão de obra 345 min
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp() where task_id = $1", [task.id])
  const t2 = await taskOf(o.po, 1, "montagem")
  await db.query("insert into public.shop_time_entries (task_id, worker_id, started_at, ended_at, end_reason, system_company_id) values ($1, $2, '2026-03-02T09:00:00Z', '2026-03-02T11:30:00Z', 'fim', $4), ($1, $3, '2026-03-02T09:30:00Z', '2026-03-02T12:45:00Z', 'fim', $4)", [t2.id, WORKERS.S01, WORKERS.S02, COMPANY_A])
  const metrics = (await one("select public.shop_task_metrics($1::uuid) m", [t2.id])).m
  assert.equal(num(metrics.elapsed_productive_minutes), 225)
  assert.equal(num(metrics.labor_minutes), 345)
  assert.deepEqual(metrics.workers.map((w) => [w.name, num(w.minutes)]), [["Soldador A", 150], ["Soldador B", 195]])
  // mesmo colaborador não aponta duas tarefas ao mesmo tempo (sem dupla contagem de horas)
  const o2 = await setupOrder("Dupla2", 1)
  const [d2] = await docs(o2.order); await setVin(d2.id); await refresh(o2.po)
  const other = await taskOf(o2.po, 1, "soldagem")
  await start(a, other.id)
  const o3 = await setupOrder("Dupla3", 1)
  const [d3] = await docs(o3.order); await setVin(d3.id); await refresh(o3.po)
  const another = await taskOf(o3.po, 1, "soldagem")
  await rejects("select public.shop_task_start($1, $2::uuid, $3)", [a, another.id, key()], /já está executando/)
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp(), end_reason = 'troca' where ended_at is null")
})

test("materiais da tarefa: só o kit da etapa, composição congelada na ordem e quantidade por unidade", async () => {
  const o = await setupOrder("Materiais", 2)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const sold = await taskOf(o.po, 1, "soldagem"); const mont = await taskOf(o.po, 1, "montagem")
  const ms = (await one("select public.shop_task_materials($1::uuid) m", [sold.id])).m
  assert.deepEqual(ms.map((m) => m.name).sort(), [`Aço Materiais`, `Chapa Materiais`])
  const aco = ms.find((m) => m.name === "Aço Materiais")
  assert.equal(num(aco.planned), 6); assert.equal(num(aco.planned_order), 12); assert.equal(num(aco.consumed), 0); assert.equal(aco.kit, "Kit Chassi Materiais"); assert.ok(aco.kit_version >= 1)
  assert.deepEqual((await one("select public.shop_task_materials($1::uuid) m", [mont.id])).m.map((m) => m.name), ["Fio Materiais"])   // montagem: kits não reivindicados por outras etapas
  // mudar o kit depois NÃO altera a ordem já emitida
  await rpc("kit_save", { kit_id: o.kits.kitChassi, name: "Kit Chassi Materiais", category: "Chassi", components: [{ component_id: o.materials.aco, quantity: 99, unit: "M", loss_percent: 0 }], activate: true })
  const again = (await one("select public.shop_task_materials($1::uuid) m", [sold.id])).m.find((m) => m.name === "Aço Materiais")
  assert.equal(num(again.planned), 6)
})

test("consumo: operação própria e idempotente, só materiais da tarefa, insuficiência recusada e finalizar não baixa estoque", async () => {
  const o = await setupOrder("Consumo", 1, { stock: 20 })
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const sold = await login("S01"); const task = await taskOf(o.po, 1, "soldagem")
  await rejects("select public.shop_task_consume($1, $2::uuid, $3::uuid, 1, $4)", [sold, task.id, o.materials.aco, key()], /só se aponta consumo em tarefa/i)   // ainda não iniciada
  await start(sold, task.id)
  const k = key()
  assert.equal((await consume(sold, task.id, o.materials.aco, 6, k)).duplicate, false)
  assert.equal((await consume(sold, task.id, o.materials.aco, 6, k)).duplicate, true)           // retentativa não baixa duas vezes
  assert.equal(num((await one("select sum(quantity) q from public.production_consumptions where production_order_id = $1 and material_id = $2", [o.po, o.materials.aco])).q), 6)
  assert.equal(num((await one("select count(*) n from public.shop_task_consumptions where task_id = $1", [task.id])).n), 1)
  await rejects("select public.shop_task_consume($1, $2::uuid, $3::uuid, 1, $4)", [sold, task.id, o.materials.fio, key()], /não faz parte da composição/)
  await rejects("select public.shop_task_consume($1, $2::uuid, $3::uuid, 500, $4)", [sold, task.id, o.materials.chapa, key()])   // estoque insuficiente
  const before = num((await one("select sum(quantity) q from public.production_consumptions where production_order_id = $1", [o.po])).q)
  await finish(sold, task.id)
  assert.equal(num((await one("select sum(quantity) q from public.production_consumptions where production_order_id = $1", [o.po])).q), before)   // finalizar não consome nada
})

test("checklist digital: obrigatórios, não conformidade vira ocorrência e pendência; retrabalho reabre; sem checklist configurado não conclui", async () => {
  const o = await setupOrder("Check", 1)
  const [d] = await docs(o.order); await setVin(d.id)
  // conduz a unidade até a gravação
  const adv = async (code, w) => { await refresh(o.po); const t = await taskOf(o.po, 1, code); const tk = await login(w); await start(tk, t.id); await finish(tk, t.id); return t }
  await adv("soldagem", "S01")
  const acab = await taskOf(o.po, 1, "acabamento")
  await db.query("select public.shop_external_send($1::uuid, '{\"provider_name\":\"Galvanizadora X\",\"finish_type\":\"galvanizacao_a_fogo\"}'::jsonb, 'Gestor')", [acab.id])
  await db.query("select public.shop_external_return($1::uuid, 350, 'ok', 'Gestor')", [acab.id])
  await adv("montagem", "M01")
  const grav = await taskOf(o.po, 1, "gravacao")
  const mont = await login("M01")
  await start(mont, grav.id)
  await rejects("select public.shop_task_finish($1, $2::uuid, $3::jsonb)", [mont, grav.id, JSON.stringify({ request_key: key() })], /checklist desta etapa ainda não foi configurado/)
  const step = (await one("select id from public.shop_steps where code = 'gravacao' and system_company_id = $1", [COMPANY_A])).id
  const i1 = await one("select public.shop_checklist_item_save($1::jsonb) id", [JSON.stringify({ step_id: step, label: "Chassi gravado e legível", mandatory: true })])
  const i2 = await one("select public.shop_checklist_item_save($1::jsonb) id", [JSON.stringify({ step_id: step, label: "Foto da gravação", mandatory: false, allow_na: true })])
  await rejects("select public.shop_task_finish($1, $2::uuid, $3::jsonb)", [mont, grav.id, JSON.stringify({ request_key: key() })], /Faltam itens obrigatórios/)
  await rejects("select public.shop_task_check($1, $2::uuid, $3::uuid, 'nao_conforme', null, '{}', $4)", [mont, grav.id, i1.id, key()], /Descreva a não conformidade/)
  await rejects("select public.shop_task_check($1, $2::uuid, $3::uuid, 'na', null, '{}', $4)", [mont, grav.id, i1.id, key()], /não admite/)
  const nc = (await one("select public.shop_task_check($1, $2::uuid, $3::uuid, 'nao_conforme', 'Gravação torta', '{}', $4) r", [mont, grav.id, i1.id, key()])).r
  assert.ok(nc.occurrence_id)
  const pend = await finish(mont, grav.id)
  assert.equal(pend.status, "Com pendencia")                                       // não conclui automaticamente
  assert.equal((await taskOf(o.po, 1, "checklist")).status, "Aguardando")          // a esteira não avança
  const occ = (await all("select * from public.shop_occurrences where task_id = $1 and status = 'Aberta'", [grav.id]))[0]
  assert.equal(occ.kind, "nao_conformidade"); assert.equal(occ.unit_number, 1); assert.equal(occ.step_code, "gravacao")
  await rejects("select public.shop_occurrence_resolve($1::uuid, 'retrabalho', 'x', 'Gestor')", [occ.id], /justificativa/)
  await db.query("select public.shop_occurrence_resolve($1::uuid, 'retrabalho', 'Refazer a gravação do chassi', 'Gestor')", [occ.id])
  const reopened = await taskOf(o.po, 1, "gravacao")
  assert.equal(reopened.status, "Pronta"); assert.equal(reopened.rework_count, 1)
  await start(mont, grav.id)
  await db.query("select public.shop_task_check($1, $2::uuid, $3::uuid, 'conforme', null, '{}', $4)", [mont, grav.id, i1.id, key()])
  assert.equal((await finish(mont, grav.id)).status, "Concluida")
  assert.equal((await taskOf(o.po, 1, "checklist")).status, "Pronta")
  assert.ok(i2.id)
})

test("conferência de medidas usa a configuração VENDIDA congelada; divergência vai para análise e só avança com decisão", async () => {
  const o = await setupOrder("Medidas", 1)
  const [d] = await docs(o.order); await setVin(d.id)
  const cfg = (await one("insert into public.product_configurations (product_id, status, homologated, params, summary, price, cost_total) values ($1, 'Valida', false, $2::jsonb, 'FZ 1E 4000x1800x1200', 9000, 6000) returning id", [o.product, JSON.stringify({ comprimento: 4000, largura: 1800, altura: 1200 })])).id
  await db.query("update public.production_orders set configuration_id = $1 where id = $2", [cfg, o.po])
  // libera a etapa de medidas sem passar por todas as outras (conclusão direta, como se já tivessem sido feitas)
  await db.query("update public.shop_tasks set status = 'Concluida', finished_at = now() where production_order_id = $1 and step_code in ('soldagem', 'acabamento', 'montagem', 'gravacao', 'checklist')", [o.po])
  await refresh(o.po)
  const qual = await login("Q01"); const t = await taskOf(o.po, 1, "medidas")
  assert.equal(t.status, "Pronta")
  const draw = (await one("select public.shop_task_drawing($1::uuid) d", [t.id])).d
  assert.equal(draw.configuration.params.comprimento, 4000)                        // o tablet mostra o que foi vendido
  await start(qual, t.id)
  await rejects("select public.shop_task_finish($1, $2::uuid, $3::jsonb)", [qual, t.id, JSON.stringify({ request_key: key() })], /Registre as medidas/)
  await rejects("select public.shop_task_measure($1, $2::uuid, $3::jsonb, $4)", [qual, t.id, JSON.stringify([{ param: "peso", measured: 10 }]), key()], /não existe na configuração/)
  const m = (await one("select public.shop_task_measure($1, $2::uuid, $3::jsonb, $4) r", [qual, t.id, JSON.stringify([{ param: "comprimento", measured: 4000 }, { param: "largura", measured: 1750 }, { param: "altura", measured: 1200 }]), key()])).r
  assert.equal(m.divergent, 1)
  const res = await finish(qual, t.id)
  assert.equal(res.status, "Com pendencia"); assert.match(res.pending_reason, /divergente/)
  assert.equal((await taskOf(o.po, 1, "faixas")).status, "Aguardando")
  const occ = (await all("select * from public.shop_occurrences where task_id = $1 and status = 'Aberta'", [t.id]))[0]
  assert.equal(occ.kind, "divergencia_medida"); assert.match(occ.description, /vendido 1800.*conferido 1750/)
  await db.query("select public.shop_occurrence_resolve($1::uuid, 'aceito', 'Engenharia aprovou a diferença de 50 mm', 'Engenharia')", [occ.id])
  assert.equal(await statusOf(t.id), "Concluida")
  assert.equal((await taskOf(o.po, 1, "faixas")).status, "Pronta")
})

test("etapa terceirizada: envio e retorno do prestador sem horas de colaborador e com custo e prazo registrados", async () => {
  const o = await setupOrder("Terceiro", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const acab = await taskOf(o.po, 1, "acabamento")
  await rejects("select public.shop_external_send($1::uuid, '{\"provider_name\":\"X\"}'::jsonb, 'Gestor')", [acab.id], /só se envia ao prestador/)
  const sold = await login("S01"); const s = await taskOf(o.po, 1, "soldagem")
  await start(sold, s.id); await finish(sold, s.id)
  await rejects("select public.shop_external_send($1::uuid, '{}'::jsonb, 'Gestor')", [acab.id], /Informe o prestador/)
  await rejects("select public.shop_task_start($1, $2::uuid, $3)", [await login("S02"), acab.id, key()], /terceirizada|autorizado/)
  await db.query("select public.shop_external_send($1::uuid, $2::jsonb, 'Gestor')", [acab.id, JSON.stringify({ provider_name: "Galvanizadora Sul", finish_type: "galvanizacao_a_fogo", expected_return: "2026-12-10" })])
  assert.equal(await statusOf(acab.id), "Em execucao")
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1", [acab.id])).n), 0)
  await db.query("select public.shop_external_return($1::uuid, 480.50, 'Peça galvanizada', 'Gestor')", [acab.id])
  assert.equal(await statusOf(acab.id), "Concluida")
  const ext = await one("select * from public.shop_task_external where task_id = $1", [acab.id])
  assert.equal(ext.provider_name, "Galvanizadora Sul"); assert.equal(num(ext.cost), 480.5); assert.ok(ext.returned_at)
  const metrics = (await one("select public.shop_task_metrics($1::uuid) m", [acab.id])).m
  assert.equal(num(metrics.labor_minutes), 0); assert.ok(metrics.external_days !== null)
  assert.equal((await taskOf(o.po, 1, "montagem")).status, "Pronta")
  await rejects("select public.shop_external_return($1::uuid, 1, 'x', 'Gestor')", [acab.id], /não está com o prestador/)
})

test("fabricação parcial: cada unidade tem sua esteira e o acabado entra no estoque unidade a unidade", async () => {
  const o = await setupOrder("Parcial", 2)
  const ds = await docs(o.order)
  for (const d of ds) await setVin(d.id)
  await refresh(o.po)
  const sold = await login("S01"); const mont = await login("M01"); const qual = await login("Q01")
  const cfg = (await one("insert into public.product_configurations (product_id, status, homologated, params, summary, price, cost_total) values ($1, 'Valida', false, $2::jsonb, 'x', 9000, 6000) returning id", [o.product, JSON.stringify({ comprimento: 3000, largura: 1500, altura: 1000 })])).id
  await db.query("update public.production_orders set configuration_id = $1 where id = $2", [cfg, o.po])
  for (const [step, tk] of [["checklist", qual], ["gravacao", mont], ["faixas", mont]]) {
    const sid = (await one("select id from public.shop_steps where code = $1 and system_company_id = $2", [step, COMPANY_A])).id
    if (!(await one("select 1 x from public.shop_checklist_items where step_id = $1", [sid]))) await db.query("select public.shop_checklist_item_save($1::jsonb)", [JSON.stringify({ step_id: sid, label: `Item ${step}`, mandatory: true })])
  }
  const run = async (unit) => {
    for (const [code, tk] of [["soldagem", sold], ["acabamento", null], ["montagem", mont], ["gravacao", mont], ["checklist", qual], ["medidas", qual], ["faixas", mont]]) {
      await refresh(o.po)
      const t = await taskOf(o.po, unit, code)
      if (!tk) {
        await db.query("select public.shop_external_send($1::uuid, '{\"provider_name\":\"Galv\"}'::jsonb, 'G')", [t.id]); await db.query("select public.shop_external_return($1::uuid, 100, null, 'G')", [t.id]); continue
      }
      await start(tk, t.id)
      if (code === "soldagem") { await consume(tk, t.id, o.materials.aco, 6); await consume(tk, t.id, o.materials.chapa, 2) }
      if (code === "montagem") await consume(tk, t.id, o.materials.fio, 4)
      for (const item of await all("select item_id from public.shop_task_check_state($1::uuid)", [t.id])) await db.query("select public.shop_task_check($1, $2::uuid, $3::uuid, 'conforme', null, '{}', $4)", [tk, t.id, item.item_id, key()])
      if (code === "medidas") await db.query("select public.shop_task_measure($1, $2::uuid, $3::jsonb, $4)", [tk, t.id, JSON.stringify([{ param: "comprimento", measured: 3000 }, { param: "largura", measured: 1500 }, { param: "altura", measured: 1000 }]), key()])
      assert.equal((await finish(tk, t.id)).status, "Concluida", `${code} unidade ${unit}`)
    }
  }
  await run(1)
  await rejects("select public.shop_unit_receive($1::uuid, 2, 'Gestor')", [o.po], /ainda tem/)
  const rec = await one("select public.shop_unit_receive($1::uuid, 1, 'Gestor') r", [o.po])
  assert.equal(rec.r.duplicate, false)
  assert.equal((await one("select public.shop_unit_receive($1::uuid, 1, 'Gestor') r", [o.po])).r.duplicate, true)    // idempotente
  const po = await one("select produced_quantity, status from public.production_orders where id = $1", [o.po])
  assert.equal(num(po.produced_quantity), 1); assert.notEqual(po.status, "Concluida")   // fabricação parcial
  assert.equal((await taskOf(o.po, 2, "soldagem")).status, "Pronta")                      // a unidade 2 segue sua própria esteira
  const board = (await one("select public.shop_board() b")).b
  const u1 = board.units.find((u) => u.order_code === o.code && u.unit_number === 1)
  assert.equal(u1.current_step, "despachante"); assert.equal(u1.done_tasks, 7)
})

test("reatribuição e cancelamento com justificativa e auditoria; histórico preservado", async () => {
  const o = await setupOrder("Reatribui", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const a = await login("S01"); const t = await taskOf(o.po, 1, "soldagem")
  await start(a, t.id)
  await rejects("select public.shop_task_reassign($1::uuid, $2::uuid, 'x', 'Gestor')", [t.id, WORKERS.S02], /justificativa/)
  await db.query("select public.shop_task_reassign($1::uuid, $2::uuid, 'Colaborador saiu para atendimento médico', 'Gestor')", [t.id, WORKERS.S02])
  assert.equal(await statusOf(t.id), "Pausada")
  assert.equal((await one("select end_reason from public.shop_time_entries where task_id = $1", [t.id])).end_reason, "reatribuicao")
  const ev = await one("select actor, detail from public.shop_task_events where task_id = $1 and event = 'Reatribuída'", [t.id])
  assert.equal(ev.actor, "Gestor"); assert.match(ev.detail.reason, /atendimento médico/)
  await rejects("select public.shop_task_start($1, $2::uuid, $3)", [await login("M01"), t.id, key()], /autorizado/)
  assert.equal((await start(await login("S02"), t.id)).status, "Em execucao")            // o novo responsável retoma
  await db.query("select public.shop_task_set_block($1::uuid, true, 'Falta chapa de reforço no almoxarifado', 'Gestor')", [t.id])
  assert.equal(await statusOf(t.id), "Bloqueada")
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1 and ended_at is null", [t.id])).n), 0)
  await refresh(o.po); assert.equal(await statusOf(t.id), "Bloqueada")                   // bloqueio manual não é desfeito pelo recálculo
  await db.query("select public.shop_task_set_block($1::uuid, false, 'Material chegou ao almoxarifado', 'Gestor')", [t.id])
  assert.ok(["Pronta", "Aguardando"].includes(await statusOf(t.id)))
  await db.query("select public.shop_task_cancel($1::uuid, 'Etapa dispensada pelo gestor', 'Gestor')", [t.id])
  assert.equal(await statusOf(t.id), "Cancelada")
  assert.equal((await taskOf(o.po, 1, "acabamento")).status, "Pronta")                   // cancelada conta como cumprida para a dependência
  await rejects("select public.shop_task_cancel($1::uuid, 'de novo', 'Gestor')", [t.id], /já está/)
})

test("documentação pendente não bloqueia a fabricação, mas bloqueia a expedição", async () => {
  const o = await setupOrder("Docs", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const prod = (await one("select public.production_eligibility($1::uuid) r", [o.order])).r
  assert.equal(prod.eligible, true); assert.equal(prod.documentation.blocks_production, false); assert.equal(prod.documentation.blocks_expedition, true)
  const sold = await login("S01"); const t = await taskOf(o.po, 1, "soldagem")
  await start(sold, t.id)                                                                  // fabricar com pré-cadastro ainda pendente
  const exp = (await one("select public.expedition_eligibility($1::uuid) r", [o.order])).r
  assert.equal(exp.eligible, false); assert.match(exp.blockers[0].message, /Documentação veicular: 0 de 1/)
  await rejects("insert into public.sales_order_deliveries (sales_order_id, items, delivered_by) values ($1, '[]'::jsonb, 'x')", [o.order], /Expedição bloqueada/)
  await db.query("update public.vehicle_documentation set status = 'Aprovado para liberacao' where sales_order_id = $1", [o.order])
  assert.equal((await one("select public.expedition_eligibility($1::uuid) r", [o.order])).r.eligible, true)
})

test("QR por unidade: identificador opaco, sem dados do cliente, e só da própria empresa", async () => {
  const o = await setupOrder("Unidade QR", 1)
  const [d] = await docs(o.order); const vin = await setVin(d.id); await refresh(o.po)
  const token = (await one("select token from public.shop_unit_tokens where production_order_id = $1", [o.po])).token
  assert.match(token, /^[0-9a-f]{32}$/)
  const view = (await one("select public.shop_unit_view($1) v", [token])).v
  assert.equal(view.order_code, o.code); assert.equal(view.vin, vin); assert.equal(view.product.model, "FZ 1E"); assert.equal(view.current_step, "Soldagem / produção do chassi")
  const text = JSON.stringify(view)
  assert.equal(text.includes("Cliente Teste"), false); assert.equal(text.includes("12345678000195"), false); assert.equal(text.includes("password"), false)
  await rejects("select public.shop_unit_view('00000000000000000000000000000000')", [], /não encontrado/)
  await asCompany(COMPANY_B)
  await rejects("select public.shop_unit_view($1)", [token], /não encontrado/)
  await asCompany(COMPANY_A)
})

test("isolamento multiempresa: sessão, tarefas, colaboradores e esteira de uma empresa não aparecem em outra", async () => {
  const o = await setupOrder("Isola", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  const sold = await login("S01")
  const t = await taskOf(o.po, 1, "soldagem")
  await asCompany(COMPANY_B)
  await rejects("select public.shop_session_worker($1)", [sold], /Sessão expirada/)
  assert.equal((await one("select public.shop_worker_login('S01', '1234', 'x') r")).r.ok, false)
  assert.deepEqual((await one("select public.shop_workers_list() l")).l, [])
  assert.deepEqual((await one("select public.shop_board() b")).b.units, [])
  await rejects("select public.shop_task_cancel($1::uuid, 'tentativa de outra empresa', 'X')", [t.id], /não encontrada/)
  await rejects("select public.shop_task_reassign($1::uuid, null, 'tentativa de outra empresa', 'X')", [t.id], /não encontrada/)
  await asCompany(COMPANY_A)
})

test("painel do gestor e produtividade: colaboradores em atividade, paradas, ocorrências e horas sem dupla contagem", async () => {
  const o = await setupOrder("Painel", 1)
  const [d] = await docs(o.order); await setVin(d.id); await refresh(o.po)
  await db.query("update public.shop_time_entries set ended_at = clock_timestamp() where ended_at is null")
  const sold = await login("S01"); const t = await taskOf(o.po, 1, "soldagem")
  await start(sold, t.id)
  let board = (await one("select public.shop_board() b")).b
  assert.ok(board.active_workers.some((w) => w.worker === "Soldador A" && w.order_code === o.code))
  await pause(sold, t.id, "Aguardando equipamento")
  board = (await one("select public.shop_board() b")).b
  const stopped = board.stopped.find((s) => s.task_id === t.id)
  assert.equal(stopped.status, "Pausada"); assert.match(stopped.reason, /Aguardando equipamento/)
  assert.equal(board.steps.length, 8)
  await one("select public.shop_occurrence_open($1, $2::uuid, 'ocorrencia', 'Máquina de solda com falha', '{}') id", [sold, t.id])
  board = (await one("select public.shop_board() b")).b
  assert.ok(board.open_occurrences.some((x) => /Máquina de solda/.test(x.description)))
  // horas históricas conhecidas: 2h e 3h a R$ 20/h
  await db.query("insert into public.shop_time_entries (task_id, worker_id, started_at, ended_at, end_reason, system_company_id) values ($1, $2, now() - interval '5 hours', now() - interval '3 hours', 'pausa', $3), ($1, $2, now() - interval '3 hours' + interval '1 minute', now() - interval '1 minute', 'fim', $3)", [t.id, WORKERS.S01, COMPANY_A])
  const prod = (await one("select public.shop_productivity() p")).p
  const me = prod.by_worker.find((w) => w.worker_id === WORKERS.S01)
  assert.ok(num(me.hours) >= 4.9 && num(me.hours) <= 5.1)
  assert.ok(num(me.cost) >= num(me.hours) * 20 - 0.5 && num(me.cost) <= num(me.hours) * 20 + 0.5)
  assert.ok(prod.by_step.some((s) => s.step === "Soldagem / produção do chassi"))
  assert.equal(prod.by_step.some((s) => /despachante|acabamento/i.test(s.step)), false)  // administrativa e terceirizada fora da mão de obra de fabricação
})
