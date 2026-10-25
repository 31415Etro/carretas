// Etapa 14: vínculos Pedido -> Ordem -> Kits -> Matérias-primas. Snapshot técnico na confirmação, imutabilidade, pendências e reconciliação assistida.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"gestor@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r

async function rawMaterial(name, cost = 2) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, 'M', 'Materia-prima', $2, 'Ativo', false, $3, $3, 'Aço') returning id", [name, sku, cost])).id
}
/** Produto com 2 kits: Chassi (2 matérias-primas, uma com perda) e Eixos (uma matéria-prima que também está no chassi). */
async function product(name, { structure = true } = {}) {
  const barra = await rawMaterial(`Barra ${name}`)
  const chapa = await rawMaterial(`Chapa ${name}`)
  const chassi = (await rpc("kit_save", { name: `Kit Chassi ${name}`, category: "Chassi", components: [{ component_id: barra, quantity: 6, unit: "M", loss_percent: 5 }, { component_id: chapa, quantity: 2, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const eixos = (await rpc("kit_save", { name: `Kit Eixos ${name}`, category: "Rodagem", components: [{ component_id: barra, quantity: 3, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const payload = { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN" }
  if (structure) payload.structure = { kits: [{ kit_id: chassi, quantity: 1 }, { kit_id: eixos, quantity: 2 }], activate: true }
  const r = await rpc("product_save", payload)
  return { id: r.product_id, barra, chapa, chassi, eixos }
}
async function sale(items) {
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ((select id from public.clients limit 1), (select id from public.salespeople limit 1), current_date + 10, 'Produto', 'Aprovado', 5000, 5000) returning id")
  let position = 0
  for (const item of items) {
    const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [item.product]))[0]
    await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, $2, 'Produto', $3, 'Carreta', $4, 5000, 5000, $5, 5000, $6, $7, 10, $8)",
      [quote.id, position++, item.product, item.quantity, snap?.est_cost || 0, snap?.bom_version_id || null, snap?.bom_version || null, snap?.sku || null])
  }
  return (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql", "235_vinculos_pedido_ordem_kits.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await one("select public.shop_steps_seed('teste') n")
})

test("confirmar o pedido leva kits e matérias-primas EXATOS do produto vendido para a ordem (3 unidades) e congela o snapshot", async () => {
  const p = await product("Carreta A")
  const order = await sale([{ product: p.id, quantity: 3 }])
  const confirmed = (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [order])).r
  assert.equal(confirmed.snapshots_frozen, 1)
  const po = await one("select * from public.production_orders where sales_order_id = $1", [order])
  assert.equal(num(po.quantity), 3)
  const kits = await all("select k.kit_id, k.quantity, kv.version from public.production_order_kits k join public.kit_versions kv on kv.id = k.kit_version_id where k.production_order_id = $1 order by k.quantity", [po.id])
  assert.equal(kits.length, 2)
  assert.deepEqual(kits.map((k) => num(k.quantity)), [3, 6])                       // chassi x1 por carreta, eixos x2 por carreta
  const mats = await all("select material_id, kit_id, required_quantity from public.production_order_materials where production_order_id = $1", [po.id])
  const barraChassi = mats.find((m) => m.material_id === p.barra && m.kit_id === p.chassi)
  const barraEixos = mats.find((m) => m.material_id === p.barra && m.kit_id === p.eixos)
  assert.ok(barraChassi && barraEixos)                                             // mesma matéria-prima em dois kits: duas linhas, rastreáveis
  assert.ok(num(barraChassi.required_quantity) >= 18 && num(barraEixos.required_quantity) === 18)
  // snapshot técnico no item e na ordem
  const item = await one("select technical_snapshot s, snapshot_at from public.sales_order_items where sales_order_id = $1 and line_type = 'Produto'", [order])
  assert.ok(item.snapshot_at)
  assert.equal(item.s.product.id, p.id)
  assert.equal(num(item.s.quantity), 3)
  assert.equal(item.s.kits.length, 2)
  const kitChassi = item.s.kits.find((k) => k.kit_id === p.chassi)
  assert.equal(kitChassi.version, 1)
  assert.equal(kitChassi.components.length, 2)
  assert.equal(num(kitChassi.components.find((c) => c.material_id === p.barra).loss_percent), 5)
  assert.ok(item.s.consolidated.find((m) => m.material_id === p.barra))            // total consolidado por matéria-prima
  assert.equal(num(item.s.consolidated.find((m) => m.material_id === p.barra).required_quantity), num(barraChassi.required_quantity) + 18)
  assert.equal((await one("select technical_snapshot->'production_order_code' c from public.production_orders where id = $1", [po.id])).c, po.code)
})

test("alterar o kit depois da venda NÃO muda a ordem nem o snapshot; congelar de novo não sobrescreve", async () => {
  const p = await product("Carreta B")
  const order = await sale([{ product: p.id, quantity: 1 }])
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order])
  const before = (await one("select technical_snapshot s from public.sales_order_items where sales_order_id = $1 and line_type = 'Produto'", [order])).s
  const matsBefore = await all("select material_id, kit_id, required_quantity from public.production_order_materials where production_order_id = (select id from public.production_orders where sales_order_id = $1) order by 1, 2", [order])
  // engenharia publica uma NOVA versão do kit (v2) com a barra do chassi de 6 -> 60 m: o catálogo muda, o que foi vendido não
  const v2 = await rpc("kit_save", { kit_id: p.chassi, name: "Kit Chassi Carreta B", category: "Chassi", components: [{ component_id: p.barra, quantity: 60, unit: "M", loss_percent: 5 }, { component_id: p.chapa, quantity: 2, unit: "M", loss_percent: 0 }], activate: true })
  assert.equal(num((await one("select version from public.kit_versions where kit_id = $1 and status = 'Ativa'", [p.chassi])).version), 2)
  assert.equal(num((await one("select public.sales_order_freeze_snapshots($1::uuid) n", [order])).n), 0)
  const after = (await one("select technical_snapshot s from public.sales_order_items where sales_order_id = $1 and line_type = 'Produto'", [order])).s
  assert.deepEqual(after, before)
  const matsAfter = await all("select material_id, kit_id, required_quantity from public.production_order_materials where production_order_id = (select id from public.production_orders where sales_order_id = $1) order by 1, 2", [order])
  assert.deepEqual(matsAfter, matsBefore)
})

test("pedido com vários produtos: cada item tem seu snapshot e sua ordem", async () => {
  const a = await product("Multi A")
  const b = await product("Multi B")
  const order = await sale([{ product: a.id, quantity: 2 }, { product: b.id, quantity: 1 }])
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order])
  const items = await all("select material_id, technical_snapshot s from public.sales_order_items where sales_order_id = $1 and line_type = 'Produto' order by position", [order])
  assert.equal(items.length, 2)
  assert.equal(items[0].s.product.id, a.id); assert.equal(items[1].s.product.id, b.id)
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 2)
  assert.equal(num((await one("select count(*) n from public.shop_tasks where production_order_id in (select id from public.production_orders where sales_order_id = $1) and unit_number = 2", [order])).n) > 0, true)   // a ordem de 2 unidades tem tarefas da 2ª carreta
})

test("pendências: produto vendido sem estrutura aparece; ordem sem composição aparece; kit sem etapa aparece", async () => {
  const semEstrutura = await product("Sem Estrutura", { structure: false })
  const order = await sale([{ product: semEstrutura.id, quantity: 1 }])
  const pend = (await one("select public.production_link_pendencies() r")).r
  assert.ok(pend.items_without_structure.some((row) => row.sales_order_id === order && /sem estrutura/.test(row.problem)))
  // a confirmação é recusada com a mensagem do produto (nada é criado pela metade)
  await rejects("select public.confirm_sales_order($1::uuid, 'Gerente')", [order], /não tem estrutura de fabricação ativa/)
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 0)
  assert.ok(Array.isArray(pend.kits_without_step) && Array.isArray(pend.orders_without_composition))
})

test("reconciliação assistida: ordem antiga sem composição recebe kits/materiais da estrutura DA PRÓPRIA ORDEM, com motivo e auditoria", async () => {
  const p = await product("Legado")
  const created = await rpc("production_order_create_manual", { product_id: p.id, quantity: 2 })
  const po = created.production_order_id
  await db.query("delete from public.production_order_materials where production_order_id = $1", [po])
  await db.query("delete from public.production_order_kits where production_order_id = $1", [po])
  const pend = (await one("select public.production_link_pendencies() r")).r
  assert.ok(pend.orders_without_composition.some((row) => row.id === po && row.bom_has_kits === true))
  await rejects("select public.production_order_relink($1::uuid, 'curto', 'Gerente')", [po], /mínimo 10/)
  const result = (await one("select public.production_order_relink($1::uuid, 'Ordem criada antes do vínculo de kits; reconciliação autorizada pelo gestor.', 'Gerente') r", [po])).r
  assert.equal(num(result.kits), 2)
  assert.ok(num(result.materials) >= 2)
  assert.equal(num((await one("select count(*) n from public.production_events where production_order_id = $1 and event = 'Reconciliação de composição' and actor = 'Gerente'", [po])).n), 1)
  await rejects("select public.production_order_relink($1::uuid, 'Tentativa repetida de reconciliar.', 'Gerente')", [po], /já tem kits e matérias-primas/)
})

test("reconciliação respeita a empresa", async () => {
  await asCompany(COMPANY_A)
  const p = await product("Empresa A")
  const po = (await rpc("production_order_create_manual", { product_id: p.id, quantity: 1 })).production_order_id
  await db.query("delete from public.production_order_materials where production_order_id = $1", [po])
  await db.query("delete from public.production_order_kits where production_order_id = $1", [po])
  await asCompany(COMPANY_B)
  await rejects("select public.production_order_relink($1::uuid, 'Tentativa de outra empresa mexer na ordem.', 'Invasor')", [po], /não encontrada/)
  await asCompany(COMPANY_A)
})
