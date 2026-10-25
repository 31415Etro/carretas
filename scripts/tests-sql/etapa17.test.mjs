// Etapa 17: kits fixos. Gerar o pedido/ordem baixa do estoque as matérias-primas dos kits, nas quantidades exatas; falta de estoque vira faltante; cancelar devolve.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)

async function material(name, { unit = "UN", cost = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [id, qty])
const stockOf = async (id) => num((await one("select current_stock s from public.materials where id = $1", [id])).s)
const consumedOf = async (po, material) => num((await one("select coalesce(sum(consumed_quantity), 0) c from public.production_order_materials where production_order_id = $1 and material_id = $2", [po, material])).c)

async function sell(productId, quantity) {
  const client = (await one("select id from public.clients limit 1")).id
  const sp = (await one("select id from public.salespeople limit 1")).id
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [productId]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, $2, current_date + 15, 'Produto', 'Aprovado', $3, $3) returning id", [client, sp, quantity * 9000])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', $3, 9000, 9000, $4, $5, $6, $7, 10, $8)",
    [quote.id, productId, quantity, snap.est_cost, quantity * 9000, snap.bom_version_id, snap.bom_version, snap.sku])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
  return order
}
const confirm = async (order) => (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [order])).r
const poOf = async (order) => (await one("select id from public.production_orders where sales_order_id = $1 and status <> 'Cancelada'", [order])).id
/** Produto: kit Chassi (6 m de barra + 2 chapas) e kit Eixos (3 m de barra). Uma carreta = 9 m de barra e 2 chapas. */
async function product(name) {
  const barra = await material(`Barra ${name}`, { unit: "M" })
  const chapa = await material(`Chapa ${name}`)
  const chassi = (await rpc("kit_save", { name: `Chassi ${name}`, category: "Chassi", components: [{ component_id: barra, quantity: 6, unit: "M", loss_percent: 0 }, { component_id: chapa, quantity: 2, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const eixos = (await rpc("kit_save", { name: `Eixos ${name}`, category: "Rodagem", components: [{ component_id: barra, quantity: 3, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const id = (await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: chassi, quantity: 1 }, { kit_id: eixos, quantity: 1 }], activate: true } })).product_id
  return { id, barra, chapa }
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql", "235_vinculos_pedido_ordem_kits.sql", "237_baixa_dos_kits_no_pedido.sql"] })
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await one("select public.shop_steps_seed('teste') n")
})

test("gerar o pedido baixa do estoque exatamente o que os kits pedem (2 carretas = 18 m de barra e 4 chapas)", async () => {
  const p = await product("Exata")
  await stockIn(p.barra, 100); await stockIn(p.chapa, 50)
  const order = await sell(p.id, 2)
  const confirmed = await confirm(order)
  const po = await poOf(order)
  assert.equal(await stockOf(p.barra), 82)                                        // 100 - 2 x (6 + 3)
  assert.equal(await stockOf(p.chapa), 46)                                        // 50 - 2 x 2
  assert.equal(await consumedOf(po, p.barra), 18)
  assert.equal(await consumedOf(po, p.chapa), 4)
  assert.ok(confirmed.materials_consumed.length >= 1)
  // cada baixa tem movimento de estoque e vínculo com a ordem; a ordem NÃO vira "Em produção" só por baixar material
  assert.equal(num((await one("select count(*) n from public.production_consumptions where production_order_id = $1 and request_key like 'kit:%' and stock_movement_id is not null", [po])).n), 2)
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Pronta para producao")
  // sem falta no MRP
  assert.equal(num((await one("select coalesce(sum(shortage_now), 0) s from public.mrp_overview() where material_id in ($1, $2)", [p.barra, p.chapa])).s), 0)
})

test("confirmar de novo não baixa duas vezes", async () => {
  const p = await product("Idempotente")
  await stockIn(p.barra, 100); await stockIn(p.chapa, 50)
  const order = await sell(p.id, 1)
  await confirm(order); await confirm(order)
  assert.equal(await stockOf(p.barra), 91)
  assert.equal(await stockOf(p.chapa), 48)
  const po = await poOf(order)
  assert.equal(await consumedOf(po, p.barra), 9)
  assert.equal(num((await one("select count(*) n from public.production_consumptions where production_order_id = $1", [po])).n), 2)
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 1)
})

test("estoque insuficiente: baixa o que existe, o resto vira faltante no MRP e é baixado quando o material chega", async () => {
  const p = await product("Curto")
  await stockIn(p.barra, 5); await stockIn(p.chapa, 50)                           // precisa de 9 m por carreta
  const order = await sell(p.id, 1)
  const confirmed = await confirm(order)
  const po = await poOf(order)
  assert.equal(await stockOf(p.barra), 0)                                         // baixou os 5 m que existiam
  assert.equal(await consumedOf(po, p.barra), 5)
  assert.equal(await consumedOf(po, p.chapa), 2)
  const missing = confirmed.materials_consumed.flatMap((r) => r.missing)
  assert.equal(num(missing.find((m) => m.material_id === p.barra).missing), 4)
  const mrp = (await all("select * from public.mrp_overview() where material_id = $1", [p.barra]))[0]
  assert.equal(num(mrp.shortage_now), 4)                                          // faltam 4 m: vira solicitação de compra
  // o material chega: a baixa do restante acontece sozinha (uma vez só)
  await stockIn(p.barra, 10)
  const pending = (await one("select public.production_consume_pending_all('Gerente') r")).r
  assert.ok(num(pending.orders) >= 1)
  assert.equal(await stockOf(p.barra), 6)                                         // 0 + 10 - 4
  assert.equal(await consumedOf(po, p.barra), 9)
  const again = (await one("select public.production_consume_pending_all('Gerente') r")).r
  assert.equal(num(again.materials), 0)
  assert.equal(await stockOf(p.barra), 6)
})

test("a mesma matéria-prima em duas ordens: a primeira leva o que há, a segunda fica com a falta", async () => {
  const p = await product("Disputa")
  await stockIn(p.barra, 12); await stockIn(p.chapa, 50)
  const a = await sell(p.id, 1); await confirm(a)
  const b = await sell(p.id, 1); await confirm(b)
  assert.equal(await consumedOf(await poOf(a), p.barra), 9)                       // 12 -> 3
  assert.equal(await consumedOf(await poOf(b), p.barra), 3)                       // só 3 m restavam
  assert.equal(await stockOf(p.barra), 0)
  const mrp = (await all("select * from public.mrp_overview() where material_id = $1", [p.barra]))[0]
  assert.equal(num(mrp.shortage_now), 6)
})

test("cancelar a ordem devolve ao estoque a baixa automática e preserva o histórico", async () => {
  const p = await product("Cancela")
  await stockIn(p.barra, 100); await stockIn(p.chapa, 50)
  const order = await sell(p.id, 2)
  await confirm(order)
  const po = await poOf(order)
  assert.equal(await stockOf(p.barra), 82)
  await db.query("select public.cancel_production_order($1::uuid, 'Cliente desistiu')", [po])
  assert.equal(await stockOf(p.barra), 100)
  assert.equal(await stockOf(p.chapa), 50)
  assert.equal(num((await one("select count(*) n from public.production_consumption_reversals r join public.production_consumptions c on c.id = r.consumption_id where c.production_order_id = $1", [po])).n), 2)   // estorno por consumo
  assert.equal(num((await one("select count(*) n from public.production_consumptions where production_order_id = $1", [po])).n), 2)    // o histórico de consumo continua intacto
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Cancelada")
  await db.query("select public.cancel_production_order($1::uuid, 'de novo')", [po])                       // idempotente
  assert.equal(await stockOf(p.barra), 100)
})

test("consumo apontado por pessoa continua exigindo ajuste antes de cancelar", async () => {
  const p = await product("Apontado")
  await stockIn(p.barra, 100); await stockIn(p.chapa, 50)
  const order = await sell(p.id, 1)
  await confirm(order)
  const po = await poOf(order)
  await rpc("record_production_consumption", { production_order_id: po, material_id: p.barra, quantity: 1, kind: "Adicional", request_key: "manual-1", responsible: "Chefe" })
  await rejects("select public.cancel_production_order($1::uuid, 'x')", [po], /já tem consumo apontado/)
})

test("ordem aberta direto na produção: a baixa dos kits é feita por production_order_consume_kits", async () => {
  const p = await product("Avulsa")
  await stockIn(p.barra, 100); await stockIn(p.chapa, 50)
  const created = await rpc("production_order_create_manual", { product_id: p.id, quantity: 2 })
  assert.equal(await stockOf(p.barra), 100)                                       // a criação em si não baixa (o servidor chama a baixa em seguida)
  const result = (await one("select public.production_order_consume_kits($1::uuid, 'Gerente') r", [created.production_order_id])).r
  assert.equal(result.consumed.length, 2)
  assert.equal(await stockOf(p.barra), 82)
  assert.equal((await one("select public.production_order_consume_kits($1::uuid, 'Gerente') r", [created.production_order_id])).r.consumed.length, 0)   // sem repetir
})
