// Etapa 15: jornada completa de integração. Matéria-prima -> kit -> produto -> oportunidade -> proposta -> pedido -> ordem -> MRP -> compra -> tablet -> esteira -> carreta pronta.
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

test("jornada completa: do kit à carreta pronta, com os mesmos vínculos em todas as etapas", async () => {
  // 1-3) matéria-prima (estoque BAIXO de propósito), kit e produto
  const barra = await material("Barra E2E", { unit: "M", cost: 3 })
  const chapa = await material("Chapa E2E", { cost: 5 })
  await stockIn(barra, 10); await stockIn(chapa, 100)
  const kitChassi = (await rpc("kit_save", { name: "Kit Chassi E2E", category: "Chassi", components: [{ component_id: barra, quantity: 6, unit: "M", loss_percent: 5 }, { component_id: chapa, quantity: 2, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const kitEixos = (await rpc("kit_save", { name: "Kit Eixos E2E", category: "Rodagem", components: [{ component_id: barra, quantity: 2, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await productWith("Carreta E2E", [kitChassi, kitEixos])
  // 4-9) oportunidade -> proposta -> fechar venda -> pedido -> ordem de produção (2 carretas)
  const sale = await sell(product, 2)
  assert.equal(sale.confirmed.snapshots_frozen, 1)
  assert.notEqual((await one("select status from public.sales_orders where id = $1", [sale.order])).status, "Rascunho")
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [sale.order])).n), 1)
  // 10-13) a Central recebe os kits e as matérias-primas certos, com versões e quantidades
  const detail = (await one("select public.production_order_detail($1::uuid) r", [sale.po])).r
  assert.deepEqual(detail.kits.map((k) => [k.name, k.kit_version, num(k.quantity)]).sort(), [["Kit Chassi E2E", 1, 2], ["Kit Eixos E2E", 1, 2]])
  const barraRows = detail.materials.filter((m) => m.material_id === barra)
  assert.equal(barraRows.length, 2)                                                         // mesma matéria-prima em dois kits: duas linhas rastreáveis
  const snapshot = (await one("select technical_snapshot s from public.sales_order_items where sales_order_id = $1 and line_type = 'Produto'", [sale.order])).s
  assert.equal(snapshot.kits.length, 2)
  assert.equal(snapshot.consolidated.find((m) => m.material_id === barra).name, "Barra E2E")
  // 15-17) MRP: falta de barra (precisa de mais que os 10 m em estoque) e solicitação de compra rastreável
  const mrp = (await all("select * from public.mrp_overview() where material_id = $1", [barra]))[0]
  assert.ok(num(mrp.shortage_now) > 0, "o MRP enxerga a falta")
  const request = (await one("select public.generate_purchase_request_consolidated('Gerente') r")).r
  const sources = await all("select production_order_id from public.purchase_request_sources where purchase_request_id = $1 and material_id = $2", [request, barra])
  assert.equal(sources.length, 1)
  assert.equal(sources[0].production_order_id, sale.po)                                      // a demanda guarda a ordem de origem
  await rejects("select public.generate_purchase_request_consolidated('Gerente')", [], /Não há falta de material a solicitar/)   // sem duplicar
  assert.equal(num((await one("select count(*) n from public.purchase_requests")).n), 1)
  // 18-23) tablet: iniciar, pausar, retomar, apontar consumo e finalizar
  const sold = await login(await codeOf("Soldador A"))
  const t1 = await one("select * from public.shop_tasks where production_order_id = $1 and unit_number = 1 and step_code = 'soldagem'", [sale.po])
  assert.equal(t1.status, "Pronta")                                                          // pedido confirmado: a fabricação já pode começar (sem chassi nem pagamento)
  const materials = (await one("select public.shop_task_materials($1::uuid) r", [t1.id])).r
  assert.deepEqual([...new Set(materials.map((m) => m.kit))], ["Kit Chassi E2E"])            // soldagem do chassi vê só o kit do chassi
  assert.equal((await start(sold, t1.id)).status, "Em execucao")
  assert.equal((await pause(sold, t1.id, "Intervalo")).status, "Pausada")
  assert.equal((await start(sold, t1.id)).status, "Em execucao")
  const ck = key()
  await consume(sold, t1.id, chapa, 2, ck)
  assert.equal((await consume(sold, t1.id, chapa, 2, ck)).duplicate, true)                   // reenvio (perda de conexão do tablet) não baixa duas vezes
  assert.equal(num((await one("select consumed_quantity c from public.production_order_materials where production_order_id = $1 and material_id = $2", [sale.po, chapa])).c), 2)
  assert.equal((await finish(sold, t1.id)).status, "Concluida")
  // 24) a Esteira (painel do gestor) enxerga o mesmo andamento
  const board = (await one("select public.shop_board() r")).r
  const unit1 = board.units.find((u) => u.order_id === sale.po && u.unit_number === 1)
  assert.notEqual(unit1.current_step, "soldagem")
  assert.equal(num(unit1.done_tasks), 1)
  // 25) o gestor conclui as demais etapas com um clique e a carreta entra no estoque de acabados
  let last = null
  for (let i = 0; i < 20; i++) {
    const pending = num((await one("select count(*) n from public.shop_tasks where production_order_id = $1 and unit_number = 1 and status not in ('Concluida','Cancelada')", [sale.po])).n)
    if (!pending) break
    last = (await one("select public.shop_unit_advance($1::uuid, 1, 'gestor') r", [sale.po])).r
  }
  assert.equal(last.unit_finished, true)
  assert.ok(num((await one("select produced_quantity p from public.production_orders where id = $1", [sale.po])).p) >= 1)
  assert.equal(num((await one("select count(*) n from public.shop_tasks where production_order_id = $1 and unit_number = 2 and status = 'Concluida'", [sale.po])).n), 0)   // a carreta 2 segue intacta
  // 26) histórico completo
  const events = (await all("select event from public.shop_task_events where task_id = $1 order by at", [t1.id])).map((e) => e.event.toLowerCase())
  assert.ok(events.some((e) => e.startsWith("inici")) && events.some((e) => e.startsWith("paus")) && events.some((e) => e.startsWith("conclu")), `eventos: ${events.join(", ")}`)
  assert.ok(num((await one("select count(*) n from public.shop_task_events where event = 'Concluída pelo gestor'")).n) >= 1)
  const pend = (await one("select public.production_link_pendencies() r")).r
  assert.ok(!pend.orders_without_composition.some((row) => row.id === sale.po))             // vínculo íntegro
})

test("duas ordens disputando a mesma matéria-prima: a necessidade consolida e cada demanda mantém a origem", async () => {
  const fio = await material("Fio E2E", { unit: "M" })
  await stockIn(fio, 1)
  const kit = (await rpc("kit_save", { name: "Kit Elétrica E2E", category: "Elétrica", components: [{ component_id: fio, quantity: 4, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await productWith("Carreta Fio", [kit])
  const a = await sell(product, 1)
  const b = await sell(product, 2)
  const mrp = (await all("select * from public.mrp_overview() where material_id = $1", [fio]))[0]
  assert.equal(num(mrp.required), 12)                                                        // 4 + 8 m, somando as duas ordens
  const request = (await one("select public.generate_purchase_request_consolidated('Gerente') r")).r
  const sources = await all("select production_order_id from public.purchase_request_sources where purchase_request_id = $1 and material_id = $2", [request, fio])
  assert.deepEqual(sources.map((s) => s.production_order_id).sort(), [a.po, b.po].sort())
})

test("dois colaboradores na mesma tarefa; outra empresa não enxerga a ordem nem a esteira", async () => {
  const aco = await material("Aço Dupla", { unit: "M" })
  await stockIn(aco, 500)
  const kit = (await rpc("kit_save", { name: "Kit Dupla", category: "Chassi", components: [{ component_id: aco, quantity: 3, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await productWith("Carreta Dupla", [kit])
  const sale = await sell(product, 1)
  const task = await one("select * from public.shop_tasks where production_order_id = $1 and unit_number = 1 and step_code = 'soldagem'", [sale.po])
  await db.query("update public.shop_steps set allow_multiple = true where step_code = 'soldagem' or code = 'soldagem'").catch(async () => { await db.query("update public.shop_steps set allow_multiple = true where code = 'soldagem'") })
  const s1 = await login(await codeOf("Soldador A")), s2 = await login(await codeOf("Soldador B"))
  await start(s1, task.id); await start(s2, task.id)
  assert.equal(num((await one("select count(*) n from public.shop_time_entries where task_id = $1 and ended_at is null", [task.id])).n), 2)   // um trecho aberto por pessoa
  await asCompany(COMPANY_B)
  assert.equal((await all("select * from public.production_order_list(null, null, 50, 0)")).length, 0)             // a lista de ordens é da empresa
  assert.equal((await one("select public.shop_board() r")).r.units.length, 0)
  await rejects("select public.shop_unit_advance($1::uuid, 1, 'invasor')", [sale.po], /não encontrada/)               // nem avançar a carreta de outra empresa
  await asCompany(COMPANY_A)
})
