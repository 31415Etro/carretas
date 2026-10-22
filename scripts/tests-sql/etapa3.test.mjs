// Etapa 3: consultas da tela de matéria-prima (lista e detalhes) no Postgres local descartável (PGlite).
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true))

async function material(name, extra = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one(
    "insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, minimum_stock, reorder_point, category, cost_price) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $5, $6, $7) returning id",
    [name, extra.unit || "UN", sku, extra.min || 0, extra.reorder || 0, extra.category || "Aço", extra.cost || 0],
  )).id
}
const stockIn = (id, qty, cost) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', $3::numeric))`, [id, qty, cost])

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
})

test("lista: custo vigente, posição da empresa, abaixo do mínimo, ponto de reposição e filtros", async () => {
  const perfil = await material("Perfil U 6mm", { unit: "M", min: 50, reorder: 80, cost: 12 })
  const chapa = await material("Chapa 3mm", { min: 0 })
  await stockIn(perfil, 40, 10)
  await stockIn(chapa, 20, 100)
  const rows = await all("select * from public.raw_material_list()")
  const p = rows.find((r) => r.id === perfil)
  assert.equal(Number(p.physical), 40)
  assert.equal(p.below_minimum, true)
  assert.equal(p.needs_reorder, true)
  assert.equal(Number(p.unit_cost), 10) // custo médio vigente (a entrada a R$ 10), não o cadastro
  assert.match(p.sku, /^MP-\d{6}$/)
  assert.equal(rows.find((r) => r.id === chapa).below_minimum, false)
  assert.equal((await all("select * from public.raw_material_list('perfil')")).length, 1)
  assert.equal((await all("select * from public.raw_material_list(null, null, true)")).every((r) => r.below_minimum), true)
  assert.equal((await all("select * from public.raw_material_list($1)", [rows.find((r) => r.id === perfil).sku.toLowerCase()])).length, 1) // busca por SKU
  // a empresa B não enxerga o estoque da A (mesmo cadastro compartilhado)
  await asCompany(COMPANY_B)
  const asB = (await all("select * from public.raw_material_list()")).find((r) => r.id === perfil)
  assert.equal(Number(asB.physical), 0)
  await asCompany(COMPANY_A)
})

test("fornecedores: um principal só, substitui a lista, e o principal vai para o cadastro do item", async () => {
  const id = await material("MP fornecedores")
  const s1 = (await one("insert into public.suppliers (name) values ('Fornecedor 1') returning id")).id
  const s2 = (await one("insert into public.suppliers (name) values ('Fornecedor 2') returning id")).id
  await rejects("select public.raw_material_set_suppliers($1, $2::jsonb)", [id, JSON.stringify([{ supplier_id: s1, is_primary: true }, { supplier_id: s2, is_primary: true }])], /apenas um fornecedor principal/)
  await db.query("select public.raw_material_set_suppliers($1, $2::jsonb)", [id, JSON.stringify([{ supplier_id: s1, is_primary: true, supplier_code: "F1-77", last_cost: 9.5, lead_time_days: 7 }, { supplier_id: s2, last_cost: 11 }])])
  const detail = (await one("select public.raw_material_detail($1) d", [id])).d
  assert.deepEqual(detail.suppliers.map((s) => [s.supplier_name, s.is_primary]), [["Fornecedor 1", true], ["Fornecedor 2", false]])
  assert.equal((await one("select supplier_id from public.materials where id = $1", [id])).supplier_id, s1)
  await db.query("select public.raw_material_set_suppliers($1, '[]'::jsonb)", [id])
  assert.equal((await one("select public.raw_material_detail($1) d", [id])).d.suppliers.length, 0)
  await rejects("select public.raw_material_set_suppliers($1, '[]'::jsonb)", [(await one("insert into public.materials (name, unit, item_type) values ('Produto','UN','Produto') returning id")).id], /não encontrada/)
})

test("detalhes: compras, movimentações, estoque por depósito, kits que usam o item e ordens de produção que o consomem", async () => {
  const perfil = await material("Perfil detalhe", { unit: "M", cost: 10 })
  const parafuso = await material("Parafuso detalhe", { cost: 1 })
  await stockIn(perfil, 100, 10); await stockIn(parafuso, 200, 1)
  // compra aprovada com recebimento parcial
  const supplier = (await one("insert into public.suppliers (name) values ('Aços do Sul') returning id")).id
  const po = (await one("insert into public.purchase_orders (order_number, supplier_id, supplier_name, status) values ('PC-1', $1, 'Aços do Sul', 'Aprovado') returning id", [supplier])).id
  await db.query("insert into public.purchase_order_items (purchase_order_id, material_id, description, unit, quantity, unit_cost, total, received_quantity) values ($1, $2, 'Perfil', 'M', 50, 11, 550, 20)", [po, perfil])
  // kit e produto que usam o perfil + ordem de produção
  const kit = (await one("insert into public.materials (name, unit, item_type, internal_code, controls_stock) values ('Kit Chassi', 'UN', 'Kit', 'KIT-T1', false) returning id")).id
  const kv = (await one("insert into public.kit_versions (kit_id, version) values ($1, 1) returning id", [kit])).id
  await db.query("insert into public.kit_components (kit_version_id, component_id, quantity, unit, loss_percent) values ($1, $2, 6, 'M', 5), ($1, $3, 16, 'UN', 0)", [kv, perfil, parafuso])
  await db.query("select public.kit_activate_version($1)", [kv])
  const product = (await one("insert into public.materials (name, unit, item_type, internal_code, sale_price) values ('Carreta Detalhe', 'UN', 'Produto', 'PRD-T1', 1000) returning id")).id
  const bom = (await one("insert into public.product_bom_versions (product_id, version) values ($1, 1) returning id", [product])).id
  await db.query("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, 1)", [bom, kit])
  await db.query("select public.product_bom_activate_version($1)", [bom])
  const client = (await one("select id from public.clients limit 1")).id
  const sale = (await one("insert into public.sales_orders (order_number, client_id) values ('PV-T', $1) returning id", [client])).id
  await db.query("insert into public.sales_order_items (sales_order_id, material_id, description, quantity, unit_price, total) values ($1, $2, 'x', 2, 1000, 2000)", [sale, product])
  await db.query("select public.confirm_sales_order($1)", [sale])

  const d = (await one("select public.raw_material_detail($1) d", [perfil])).d
  assert.equal(Number(d.availability.physical), 100)
  assert.equal(Number(d.availability.reserved), 12.6) // 2 carretas x 6 m x (1 + 5%)
  assert.equal(Number(d.availability.incoming), 30) // 50 pedidos - 20 recebidos
  assert.equal(d.stock_by_warehouse.length, 1)
  assert.equal(d.purchases[0].order_number, "PC-1")
  assert.equal(Number(d.purchases[0].unit_cost), 11)
  assert.equal(d.movements[0].movement_type, "Saldo inicial")
  assert.equal(d.kits.length, 1)
  assert.deepEqual([d.kits[0].kit_name, Number(d.kits[0].quantity), Number(d.kits[0].loss_percent)], ["Kit Chassi", 6, 5])
  assert.deepEqual(d.kits[0].products.map((p) => p.product_name), ["Carreta Detalhe"]) // do material ao kit e ao produto que o usa
  assert.equal(d.production.length, 1)
  assert.equal(Number(d.production[0].required), 12.6)
  assert.equal(d.production[0].status, "Pronta para producao")

  // outra empresa vê o mesmo cadastro e os kits (catálogo compartilhado), mas nenhum estoque, compra, movimento ou ordem
  await asCompany(COMPANY_B)
  const b = (await one("select public.raw_material_detail($1) d", [perfil])).d
  assert.equal(Number(b.availability.physical), 0)
  assert.deepEqual([b.purchases.length, b.movements.length, b.production.length, b.stock_by_warehouse.length], [0, 0, 0, 0])
  assert.equal(b.kits.length, 1)
  await asCompany(COMPANY_A)
})

test("lista e detalhes só tratam matéria-prima (produto e kit não entram)", async () => {
  const kit = (await one("insert into public.materials (name, unit, item_type, internal_code) values ('Kit fora', 'UN', 'Kit', 'KIT-OUT') returning id")).id
  assert.equal((await all("select * from public.raw_material_list()")).some((r) => r.id === kit), false)
  await rejects("select public.raw_material_detail($1)", [kit], /não encontrada/)
})
