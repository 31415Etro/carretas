// Testes de SQL da reestruturação industrial (scripts 217-219) em um Postgres local descartável (PGlite). Nenhum banco real é tocado.
// Uso: npm run test:sql   (precisa de `npm install` para o @electric-sql/pglite)
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase, BASE_BUNDLES } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}"}', false)`)
const rejects = async (sql, params, pattern) => {
  await assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 80)}`)
}

async function item(type, name, extra = {}) {
  const sku = extra.sku || (await one("select public.next_item_sku($1) sku", [type])).sku
  const r = await one(
    `insert into public.materials (name, unit, item_type, internal_code, status, controls_stock, cost_price, sale_price) values ($1, $2, $3, $4, 'Ativo', $5, $6, $7) returning id`,
    [name, extra.unit || "UN", type, sku, extra.controlsStock ?? type !== "Kit", extra.cost ?? 0, extra.price ?? 0],
  )
  return r.id
}
async function stockIn(materialId, qty, cost = null) {
  await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', $3::numeric))`, [materialId, qty, cost])
}
async function kitWith(name, components) {
  const kit = await item("Kit", name)
  const { id: version } = await one("insert into public.kit_versions (kit_id, version) values ($1, 1) returning id", [kit])
  for (const [material, quantity, unit = "UN", loss = 0] of components) {
    await db.query("insert into public.kit_components (kit_version_id, component_id, quantity, unit, loss_percent) values ($1, $2, $3, $4, $5)", [version, material, quantity, unit, loss])
  }
  await db.query("select public.kit_activate_version($1)", [version])
  return { kit, version }
}
async function productWith(name, kits, { labor = 0, overhead = 0, price = 1000 } = {}) {
  const product = await item("Produto", name, { price })
  const { id: bom } = await one("insert into public.product_bom_versions (product_id, version, labor_cost, overhead_cost) values ($1, 1, $2, $3) returning id", [product, labor, overhead])
  for (const [kit, quantity] of kits) await db.query("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, $3)", [bom, kit, quantity])
  await db.query("select public.product_bom_activate_version($1)", [bom])
  return { product, bom }
}
async function saleOf(productId, quantity, { makeToOrder = false, company = COMPANY_A } = {}) {
  await asCompany(company)
  const client = await one("select id from public.clients limit 1")
  const { number } = await one("select public.next_sales_order_number() number")
  const sale = await one("insert into public.sales_orders (order_number, client_id) values ($1, $2) returning id", [number, client.id])
  await db.query(
    "insert into public.sales_order_items (sales_order_id, material_id, description, quantity, unit_price, total, make_to_order) values ($1, $2, 'Produto', $3, 1000, $4, $5)",
    [sale.id, productId, quantity, quantity * 1000, makeToOrder],
  )
  return sale.id
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await asCompany(COMPANY_B)
  await db.exec(`insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)`)
  await asCompany(COMPANY_A)
})

test("scripts 217-219 são idempotentes (rodar de novo não falha nem duplica)", async () => {
  const { createDatabase: make } = await import("./harness.mjs")
  const again = await make({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql"] })
  const { n } = (await again.query("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('kit_versions','production_orders','purchase_requests')")).rows[0]
  assert.equal(n, 3)
})

test("SKU: prefixos por tipo, código único em TODO o catálogo e busca global sem ambiguidade", async () => {
  const mp = await one("select public.next_item_sku('Materia-prima') s")
  const kit = await one("select public.next_item_sku('Kit') s")
  const prd = await one("select public.next_item_sku('Produto') s")
  assert.match(mp.s, /^MP-\d{6}$/)
  assert.match(kit.s, /^KIT-\d{6}$/)
  assert.match(prd.s, /^PRD-\d{6}$/)
  const id = await item("Materia-prima", "Teste SKU", { sku: "DUP-1" })
  await rejects("insert into public.materials (name, unit, item_type, internal_code) values ('x','UN','Materia-prima','dup-1')", [], /já existe no catálogo/)
  await rejects("insert into public.materials (name, unit, item_type, internal_code) values ('y','UN','Produto','DUP-1')", [], /já existe no catálogo/) // mesmo código em outro tipo também é recusado
  assert.equal((await all("select * from public.find_item_by_sku(' dup-1 ')")).length, 1)
  assert.equal((await one("select id from public.find_item_by_sku('DUP-1')")).id, id)
  await rejects("select public.next_item_sku('Servico')", [], /inválido/)
  await rejects("insert into public.materials (name, unit, item_type, internal_code) values ('z','UN','Produto','SKU com espaço')", [], /SKU inválido/)
})

test("SKU: editar é livre enquanto o item não tem história; depois só pela troca controlada, com motivo e histórico", async () => {
  const id = await item("Materia-prima", "MP sku edit", { sku: "EDIT-1" })
  await db.query("update public.materials set internal_code = 'EDIT-2' where id = $1", [id]) // sem movimentos: livre
  await stockIn(id, 5, 1)
  await rejects("update public.materials set internal_code = 'EDIT-3' where id = $1", [id], /troca controlada/)
  await rejects("select public.change_item_sku($1, 'EDIT-3', '')", [id], /motivo/)
  await db.query("select public.change_item_sku($1, 'EDIT-3', 'Padronização do código', 'Teste')", [id])
  assert.equal((await one("select internal_code c from public.materials where id = $1", [id])).c, "EDIT-3")
  const hist = await one("select old_sku, new_sku, reason from public.item_sku_history where material_id = $1", [id])
  assert.deepEqual([hist.old_sku, hist.new_sku, hist.reason], ["EDIT-2", "EDIT-3", "Padronização do código"])
  const other = await item("Materia-prima", "MP outro", { sku: "EDIT-9" })
  await rejects("select public.change_item_sku($1, 'edit-9', 'colisão')", [id], /já pertence a outro item/)
  assert.ok(other)
})

test("regras por tipo: kit nunca vende; matéria-prima só vende se 'Disponível para venda' e com dados comerciais (no backend)", async () => {
  await rejects("insert into public.materials (name, unit, item_type, sale_price) values ('Kit caro','UN','Kit', 10)", [], /não possui preço de venda/)
  await rejects("insert into public.materials (name, unit, item_type, allows_sale, ncm) values ('NCM ruim','UN','Materia-prima', false, '1234')", [], /8 dígitos/)
  // padrão: consumo interno, sem preço
  const internal = await one("insert into public.materials (name, unit, item_type, allows_sale, sale_price) values ('MP interna','UN','Materia-prima', false, 99) returning allows_sale, sale_price")
  assert.deepEqual([internal.allows_sale, Number(internal.sale_price)], [false, 0]) // preço sem "disponível para venda" é descartado
  // disponível para venda: exige preço, unidade e NCM
  await rejects("insert into public.materials (name, unit, item_type, allows_sale, ncm) values ('MP venda','UN','Materia-prima', true, '72162100')", [], /preço de venda/)
  await rejects("insert into public.materials (name, unit, item_type, allows_sale, sale_price) values ('MP venda','UN','Materia-prima', true, 5)", [], /NCM de 8 dígitos/)
  const sellable = await one("insert into public.materials (name, unit, item_type, allows_sale, sale_price, ncm) values ('MP venda','UN','Materia-prima', true, 5, '7216.21.00') returning id, allows_sale")
  assert.equal(sellable.allows_sale, true)
  // desligar a opção zera o preço e volta ao consumo interno
  const back = await one("update public.materials set allows_sale = false where id = $1 returning sale_price", [sellable.id])
  assert.equal(Number(back.sale_price), 0)
  // orçamento: matéria-prima só se vendável; kit nunca
  const client = (await one("select id from public.clients limit 1")).id
  const quote = (await one("insert into public.quotes (quote_number, client_id, salesperson_id, valid_until, quote_type) select 'Q-T1', $1, (select id from public.salespeople limit 1), current_date + 5, 'Produto' returning id", [client])).id
  const internalId = (await one("select id from public.materials where name = 'MP interna'")).id
  await rejects("insert into public.quote_items (quote_id, line_type, material_id, description, quantity, unit_price) values ($1, 'Produto', $2, 'x', 1, 1)", [quote, internalId], /Disponível para venda/)
  await db.query("update public.materials set allows_sale = true, sale_price = 5, ncm = '72162100' where id = $1", [sellable.id])
  await db.query("insert into public.quote_items (quote_id, line_type, material_id, description, quantity, unit_price) values ($1, 'Produto', $2, 'ok', 1, 5)", [quote, sellable.id])
  const kit = await item("Kit", "Kit não vende")
  await rejects("insert into public.quote_items (quote_id, line_type, material_id, description, quantity, unit_price) values ($1, 'Produto', $2, 'x', 1, 1)", [quote, kit], /Kit não é vendido/)
})

test("kit: só matéria-prima como componente, versões imutáveis, custo reativo ao custo da matéria-prima", async () => {
  const perfil = await item("Materia-prima", "Perfil de aço", { unit: "M", cost: 10 })
  const parafuso = await item("Materia-prima", "Parafuso", { cost: 0.5 })
  const { kit, version } = await kitWith("Kit Chassi", [[perfil, 6, "M"], [parafuso, 16]])
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [version])).c), 68) // 6*10 + 16*0,5
  // componente que não é matéria-prima
  const produto = await item("Produto", "Produto qualquer")
  const draft = (await one("select public.kit_new_version($1) id", [kit])).id
  await rejects("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 1, 'UN')", [draft, produto], /matéria-prima/)
  // versão ativa não aceita alteração
  await rejects("update public.kit_components set quantity = 99 where kit_version_id = $1", [version], /não pode ser alterada/)
  await rejects("delete from public.kit_components where kit_version_id = $1", [version], /não pode ser alterada/)
  // custo acompanha o custo vigente da matéria-prima
  await db.query("update public.materials set average_cost = 12 where id = $1", [perfil])
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [version])).c), 80) // 6*12 + 8
  // ativar a nova versão deixa a anterior obsoleta e guarda o histórico
  await db.query("update public.kit_components set quantity = 8 where kit_version_id = $1 and component_id = $2", [draft, perfil])
  await db.query("select public.kit_activate_version($1)", [draft])
  const states = (await all("select version, status from public.kit_versions where kit_id = $1 order by version", [kit])).map((r) => `${r.version}:${r.status}`)
  assert.deepEqual(states, ["1:Obsoleta", "2:Ativa"])
  await rejects("select public.kit_activate_version($1)", [version], /obsoleta/)
})

test("kit: versão sem componente não ativa; item que não é Kit não tem versão", async () => {
  const kit = await item("Kit", "Kit vazio")
  const { id } = await one("insert into public.kit_versions (kit_id, version) values ($1, 1) returning id", [kit])
  await rejects("select public.kit_activate_version($1)", [id], /ao menos uma matéria-prima/)
  const mp = await item("Materia-prima", "MP solta")
  await rejects("insert into public.kit_versions (kit_id, version) values ($1, 1)", [mp], /tipo Kit/)
})

test("composição multinível: subkit só se habilitado e sem ciclo", async () => {
  const mp = await item("Materia-prima", "MP ciclo", { cost: 1 })
  const { kit: kitA } = await kitWith("Kit A", [[mp, 1]])
  const kitB = await item("Kit", "Kit B")
  const vb = (await one("insert into public.kit_versions (kit_id, version, composition_kind) values ($1, 1, 'multinivel') returning id", [kitB])).id
  await db.query("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 2, 'UN')", [vb, kitA])
  await db.query("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 1, 'UN')", [vb, mp])
  await db.query("select public.kit_activate_version($1)", [vb])
  // subkit em kit de fabricação comum é recusado
  const kitC = await item("Kit", "Kit C")
  const vc = (await one("insert into public.kit_versions (kit_id, version) values ($1, 1) returning id", [kitC])).id
  await rejects("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 1, 'UN')", [vc, kitA], /multinível/)
  // ciclo: kit A passa a conter o kit B (que já contém o A)
  const va2 = (await one("select public.kit_new_version($1) id", [kitA])).id
  const vaMulti = (await one("update public.kit_versions set composition_kind = 'multinivel' where id = $1 returning id", [va2])).id
  await rejects("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 1, 'UN')", [vaMulti, kitB], /circular/)
  // explosão expande o subkit: 2 kits A + 1 MP direta
  const prod = await item("Produto", "Produto multinível", { price: 10 })
  const bom = (await one("insert into public.product_bom_versions (product_id, version) values ($1, 1) returning id", [prod])).id
  await db.query("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, 1)", [bom, kitB])
  await db.query("select public.product_bom_activate_version($1)", [bom])
  const rows = await all("select material_id, required_quantity from public.explode_bom($1, 3)", [bom])
  assert.equal(rows.filter((r) => r.material_id === mp).reduce((sum, r) => sum + Number(r.required_quantity), 0), 3 * (2 * 1 + 1)) // 3 produtos x (2 subkits x 1 + 1)
})

test("produto: só vincula kits; estrutura ativa congela custos; custo = materiais + mão de obra + indiretos", async () => {
  const aco = await item("Materia-prima", "Aço produto", { cost: 100 })
  const { kit } = await kitWith("Kit custo", [[aco, 2]])
  const { product, bom } = await productWith("Carreta custo", [[kit, 1]], { labor: 300, overhead: 50, price: 2000 })
  const cost = await one("select * from public.product_bom_cost($1)", [bom])
  assert.deepEqual([cost.materials_cost, cost.labor_cost, cost.overhead_cost, cost.total_cost].map(Number), [200, 300, 50, 550])
  await rejects("update public.product_bom_versions set labor_cost = 1 where id = $1", [bom], /não podem ser alterados/)
  const mp = await item("Materia-prima", "MP solta 2")
  const draft = (await one("select public.product_bom_new_version($1) id", [product])).id
  await rejects("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, 1)", [draft, mp], /Somente kits/)
  await rejects("insert into public.product_bom_versions (product_id, version) values ($1, 9)", [mp], /tipo Produto/)
})

test("fluxo completo: venda confirmada -> ordem -> explosão -> reserva -> falta -> solicitação -> consumo -> conclusão -> acabado", async () => {
  const perfil = await item("Materia-prima", "Perfil F", { unit: "M", cost: 10 })
  const parafuso = await item("Materia-prima", "Parafuso F", { cost: 1 })
  const fio = await item("Materia-prima", "Fio F", { unit: "M", cost: 2 })
  const conector = await item("Materia-prima", "Conector F", { cost: 5 })
  const chassi = await kitWith("Kit Chassi F", [[perfil, 6, "M"], [parafuso, 16]])
  const eletrica = await kitWith("Kit Elétrica F", [[fio, 4, "M"], [conector, 2]])
  const { product } = await productWith("Carreta F", [[chassi.kit, 1], [eletrica.kit, 1]], { labor: 100 })
  await stockIn(perfil, 100, 10); await stockIn(parafuso, 30, 1); await stockIn(fio, 100, 2); await stockIn(conector, 100, 5)

  const sale = await saleOf(product, 3)
  const result = (await one("select public.confirm_sales_order($1, 'Teste') r", [sale])).r
  assert.equal(result.production_orders_created.length, 1)
  const order = (await one("select * from public.production_orders where sales_order_id = $1", [sale]))
  assert.equal(Number(order.quantity), 3)
  // explosão: 3 kits cada, 18 m de perfil, 48 parafusos, 12 m de fio, 6 conectores
  const needs = Object.fromEntries((await all("select material_id, sum(required_quantity) q from public.production_order_materials where production_order_id = $1 group by 1", [order.id])).map((r) => [r.material_id, Number(r.q)]))
  assert.deepEqual([needs[perfil], needs[parafuso], needs[fio], needs[conector]], [18, 48, 12, 6])
  assert.equal((await all("select 1 from public.production_order_kits where production_order_id = $1", [order.id])).length, 2)
  // faltam 18 parafusos (30 em estoque, 48 necessários) -> status e planejamento
  assert.equal((await one("select status from public.production_orders where id = $1", [order.id])).status, "Aguardando materiais")
  const plan = await all("select * from public.plan_materials($1) where shortage > 0", [order.id])
  assert.equal(plan.length, 1); assert.equal(Number(plan[0].shortage), 18)
  // reserva: nada além do disponível; 30 parafusos reservados
  assert.equal(Number((await one("select reserved_stock r from public.materials where id = $1", [parafuso])).r), 30)
  // solicitação de compra com a falta (não emite pedido ao fornecedor)
  const req = (await one("select public.generate_purchase_request($1, 'Teste') id", [order.id])).id
  const items = await all("select material_id, quantity from public.purchase_request_items where purchase_request_id = $1", [req])
  assert.deepEqual(items.map((i) => [i.material_id, Number(i.quantity)]), [[parafuso, 18]])
  assert.equal((await all("select 1 from public.purchase_orders")).length, 0)
  // chega material: entrada por compra e nova reserva da diferença
  await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Entrada por compra', 'quantity', 18, 'unit_cost', 1))`, [parafuso])
  await db.query("select public.reserve_production_materials($1)", [order.id])
  assert.equal((await one("select status from public.production_orders where id = $1", [order.id])).status, "Pronta para producao")
  await rejects("select public.generate_purchase_request($1)", [order.id], /não tem falta/)
  // concluir sem apontar consumo é recusado
  await rejects("select public.complete_production(jsonb_build_object('production_order_id', $1::text))", [order.id], /Faltam apontamentos/)
  // consumo real: baixa só agora; mesma chave não baixa duas vezes
  const stockBefore = Number((await one("select current_stock s from public.materials where id = $1", [perfil])).s)
  const consume = (m, q, key) => db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', $3::numeric, 'request_key', $4::text)) r", [order.id, m, q, key])
  await consume(perfil, 18, "c1"); const dup = (await consume(perfil, 18, "c1")).rows[0].r
  assert.equal(dup.duplicate, true)
  assert.equal(Number((await one("select current_stock s from public.materials where id = $1", [perfil])).s), stockBefore - 18)
  await consume(parafuso, 48, "c2"); await consume(fio, 12, "c3"); await consume(conector, 6, "c4")
  // produção parcial: 1 de 3 unidades exige consumo proporcional (já apontado) e dá entrada do acabado
  const part = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'request_key', 'r1')) r", [order.id])).r
  assert.equal(part.produced_total, 1)
  assert.equal((await one("select status from public.production_orders where id = $1", [order.id])).status, "Em producao")
  assert.equal(Number((await one("select current_stock s from public.materials where id = $1", [product])).s), 1)
  // mesma conclusão repetida não duplica a entrada
  assert.equal((await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'request_key', 'r1')) r", [order.id])).r.duplicate, true)
  assert.equal(Number((await one("select current_stock s from public.materials where id = $1", [product])).s), 1)
  const done = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 2, 'request_key', 'r2')) r", [order.id])).r
  assert.equal(done.produced_total, 3)
  const finished = await one("select status, produced_quantity from public.production_orders where id = $1", [order.id])
  assert.equal(finished.status, "Concluida")
  assert.equal(Number((await one("select current_stock s from public.materials where id = $1", [product])).s), 3)
  assert.equal((await one("select status from public.sales_orders where id = $1", [sale])).status, "Pronto para entrega")
  // custo do acabado: materiais reais (18*10+48*1+12*2+6*5 = 282) + mão de obra 100*3 = 582 / 3 unidades = 194
  const costs = await all("select quantity, unit_cost from public.production_receipts where production_order_id = $1 order by created_at", [order.id])
  const total = costs.reduce((s, r) => s + Number(r.quantity) * Number(r.unit_cost), 0)
  assert.ok(Math.abs(total - 582) < 0.05, `custo total do acabado ${total}`)
  // rastreabilidade: todo consumo e a entrada têm movimento de estoque
  assert.equal((await one("select count(*)::int n from public.production_consumptions where production_order_id = $1 and stock_movement_id is not null", [order.id])).n, 4)
  assert.equal(Number((await one("select reserved_stock r from public.materials where id = $1", [parafuso])).r), 0)
})

test("proteção contra ordens duplicadas: confirmar de novo não cria outra ordem", async () => {
  const mp = await item("Materia-prima", "MP dup", { cost: 1 })
  const { kit } = await kitWith("Kit dup", [[mp, 1]])
  const { product } = await productWith("Produto dup", [[kit, 1]])
  const sale = await saleOf(product, 2)
  await db.query("select public.confirm_sales_order($1)", [sale])
  const again = (await one("select public.confirm_sales_order($1) r", [sale])).r
  assert.equal(again.production_orders_created.length, 0)
  assert.equal(again.already_existing.length, 1)
  assert.equal((await one("select count(*)::int n from public.production_orders where sales_order_id = $1", [sale])).n, 1)
  await rejects("insert into public.production_orders (code, sales_order_item_id, product_id, bom_version_id, quantity) select 'X-1', i.id, i.material_id, (select id from public.product_bom_versions where product_id = i.material_id and status = 'Ativa'), 1 from public.sales_order_items i where i.sales_order_id = $1", [sale], /production_orders_item_uidx|duplicate/i)
})

test("estoque de acabados atende parte do pedido e fabrica o restante; sob encomenda ignora o saldo", async () => {
  const mp = await item("Materia-prima", "MP acabado", { cost: 1 }); await stockIn(mp, 1000, 1)
  const { kit } = await kitWith("Kit acabado", [[mp, 5]])
  const { product } = await productWith("Carreta acabada", [[kit, 1]])
  await stockIn(product, 1, 500) // 1 carreta pronta
  const sale = await saleOf(product, 3)
  await db.query("select public.confirm_sales_order($1)", [sale])
  const line = await one("select quantity_from_stock f, quantity_to_produce p from public.sales_order_items where sales_order_id = $1", [sale])
  assert.deepEqual([Number(line.f), Number(line.p)], [1, 2])
  assert.equal(Number((await one("select quantity q from public.production_orders where sales_order_id = $1", [sale])).q), 2)
  assert.equal(Number((await one("select reserved_stock r from public.materials where id = $1", [product])).r), 1)
  // outra venda não enxerga a carreta já reservada: só sobra para fabricar tudo
  const sale2 = await saleOf(product, 1)
  await db.query("select public.confirm_sales_order($1)", [sale2])
  assert.equal(Number((await one("select quantity q from public.production_orders where sales_order_id = $1", [sale2])).q), 1)
  // sob encomenda: fabrica mesmo havendo saldo
  const spare = await item("Produto", "Estoque sobrando", { price: 10 })
  const sale3 = await saleOf(product, 1, { makeToOrder: true })
  await db.query("select public.confirm_sales_order($1)", [sale3])
  assert.equal(Number((await one("select quantity_from_stock f from public.sales_order_items where sales_order_id = $1", [sale3])).f), 0)
  assert.ok(spare)
})

test("concorrência por estoque: duas ordens disputando o mesmo material nunca reservam mais que o saldo", async () => {
  const mp = await item("Materia-prima", "MP disputada", { cost: 1 }); await stockIn(mp, 10, 1)
  const { kit } = await kitWith("Kit disputa", [[mp, 4]])
  const { product } = await productWith("Produto disputa", [[kit, 1]])
  const s1 = await saleOf(product, 2); const s2 = await saleOf(product, 2) // cada venda precisa de 8; só há 10
  await db.query("select public.confirm_sales_order($1)", [s1])
  await db.query("select public.confirm_sales_order($1)", [s2])
  const reserved = Number((await one("select reserved_stock r from public.materials where id = $1", [mp])).r)
  assert.equal(reserved, 10)
  const statuses = (await all("select status from public.production_orders where sales_order_id in ($1, $2) order by created_at", [s1, s2])).map((r) => r.status)
  assert.deepEqual(statuses, ["Pronta para producao", "Aguardando materiais"])
  const second = await one("select shortage from public.plan_materials((select id from public.production_orders where sales_order_id = $1))", [s2])
  assert.equal(Number(second.shortage), 6)
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Consumo em producao', 'quantity', 11))", [mp], /Saldo insuficiente/)
})

test("cancelamento sem consumo libera reservas e não gera movimentos; com consumo é recusado", async () => {
  const mp = await item("Materia-prima", "MP cancela", { cost: 1 }); await stockIn(mp, 50, 1)
  const { kit } = await kitWith("Kit cancela", [[mp, 5]])
  const { product } = await productWith("Produto cancela", [[kit, 1]])
  const sale = await saleOf(product, 2)
  await db.query("select public.confirm_sales_order($1)", [sale])
  const order = await one("select id from public.production_orders where sales_order_id = $1", [sale])
  const movementsBefore = (await one("select count(*)::int n from public.stock_movements")).n
  assert.equal(Number((await one("select reserved_stock r from public.materials where id = $1", [mp])).r), 10)
  await db.query("select public.cancel_production_order($1, 'teste')", [order.id])
  assert.equal(Number((await one("select reserved_stock r from public.materials where id = $1", [mp])).r), 0)
  assert.equal((await one("select count(*)::int n from public.stock_movements")).n, movementsBefore)
  assert.equal((await one("select status from public.production_orders where id = $1", [order.id])).status, "Cancelada")
  // com consumo, não cancela
  const sale2 = await saleOf(product, 1)
  await db.query("select public.confirm_sales_order($1)", [sale2])
  const order2 = await one("select id from public.production_orders where sales_order_id = $1", [sale2])
  await db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 2))", [order2.id, mp])
  await rejects("select public.cancel_production_order($1)", [order2.id], /consumo apontado/)
})

test("capacidade de fabricação: quantas unidades completas e qual material limita", async () => {
  const a = await item("Materia-prima", "Material A", { cost: 1 }); const b = await item("Materia-prima", "Material B", { cost: 1 })
  const { kit } = await kitWith("Kit cap", [[a, 4], [b, 10]])
  const { product } = await productWith("Produto cap", [[kit, 1]])
  await stockIn(a, 17, 1); await stockIn(b, 100, 1) // A permite 4 (17/4), B permite 10
  const rows = await all("select * from public.product_capacity($1)", [product])
  assert.equal(Number(rows[0].capacity), 4)
  assert.equal(rows[0].limiting_material, "Material A")
})

test("sem estrutura ativa o pedido não confirma produção; versão antiga não é alterada retroativamente", async () => {
  const mp = await item("Materia-prima", "MP hist", { cost: 10 }); await stockIn(mp, 500, 10)
  const { kit, version } = await kitWith("Kit hist", [[mp, 2]])
  const semBom = await item("Produto", "Produto sem estrutura", { price: 5 })
  const saleBad = await saleOf(semBom, 1)
  await rejects("select public.confirm_sales_order($1)", [saleBad], /estrutura de fabricação ativa/)
  const { product } = await productWith("Produto hist", [[kit, 1]])
  const sale = await saleOf(product, 1)
  await db.query("select public.confirm_sales_order($1)", [sale])
  const order = await one("select id from public.production_orders where sales_order_id = $1", [sale])
  // muda a composição do kit depois: a ordem criada continua usando a versão congelada
  const v2 = (await one("select public.kit_new_version($1) id", [kit])).id
  await db.query("update public.kit_components set quantity = 50 where kit_version_id = $1", [v2])
  await db.query("select public.kit_activate_version($1)", [v2])
  assert.equal(Number((await one("select sum(required_quantity) q from public.production_order_materials where production_order_id = $1", [order.id])).q), 2)
  assert.equal((await one("select kit_version_id v from public.production_order_kits where production_order_id = $1", [order.id])).v, version)
})

test("isolamento por empresa: ordens e pedidos de uma empresa não aparecem para outra (RLS) e a empresa vem do pedido", async () => {
  const mp = await item("Materia-prima", "MP tenant", { cost: 1 }); await stockIn(mp, 100, 1)
  const { kit } = await kitWith("Kit tenant", [[mp, 1]])
  const { product } = await productWith("Produto tenant", [[kit, 1]])
  const saleB = await saleOf(product, 1, { company: COMPANY_B })
  await db.query("select public.confirm_sales_order($1)", [saleB])
  const own = await one("select system_company_id c from public.production_orders where sales_order_id = $1", [saleB])
  assert.equal(own.c, COMPANY_B)
  assert.match((await one("select code c from public.production_orders where sales_order_id = $1", [saleB])).c, /^OP-\d{4}-\d{5}$/)
  // lê como usuário autenticado da empresa A: não vê a ordem da B
  await db.exec("set role authenticated")
  try {
    await asCompany(COMPANY_A)
    assert.equal((await one("select count(*)::int n from public.production_orders where system_company_id = $1", [COMPANY_B])).n, 0)
    assert.equal((await one("select count(*)::int n from public.sales_orders where id = $1", [saleB])).n, 0)
    await asCompany(COMPANY_B)
    assert.equal((await one("select count(*)::int n from public.sales_orders where id = $1", [saleB])).n, 1)
  } finally {
    await db.exec("reset role")
  }
})

test("migração da composição antiga cria kit legado + estrutura sem mexer na original", async () => {
  const comp = await item("Materia-prima", "Comp legado", { cost: 3 })
  const produto = await item("Produto", "Produto legado", { price: 100 })
  const { id } = await one("insert into public.product_compositions (product_id, version, labor_cost) values ($1, 1, 20) returning id", [produto])
  await db.query("insert into public.product_composition_items (composition_id, component_id, quantity, unit) values ($1, $2, 4, 'UN')", [id, comp])
  const migrated = (await one("select public.migrate_legacy_compositions() n")).n
  assert.ok(migrated >= 1)
  const cost = await one("select * from public.product_bom_cost((select id from public.product_bom_versions where product_id = $1 and status = 'Ativa'))", [produto])
  assert.deepEqual([Number(cost.materials_cost), Number(cost.labor_cost)], [12, 20])
  assert.equal((await one("select count(*)::int n from public.product_compositions where id = $1", [id])).n, 1)
  assert.equal((await one("select public.migrate_legacy_compositions() n")).n, 0) // idempotente
})

test("217 em banco com SKU repetido (como hoje em produção): não falha, avisa e não cria o índice; criado depois que a duplicidade some", async () => {
  const legacy = await createDatabase({})
  await legacy.exec("insert into public.materials (name, unit, item_type, internal_code) values ('FZ 1E','UN','Produto','REB-E1-0750-001'), ('FZ 1E','UN','Produto','REB-E1-0750-001'), ('Outro','UN','Produto','OUTRO-1')")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
  const sql217 = fs.readFileSync(path.join(here, "..", "217_itens_estrutura.sql"), "utf8")
  await legacy.exec(sql217) // não pode lançar erro
  const idx = async () => (await legacy.query("select count(*)::int n from pg_indexes where indexname = 'materials_sku_uidx'")).rows[0].n
  assert.equal(await idx(), 0)
  // dados existentes continuam intactos
  assert.equal((await legacy.query("select count(*)::int n from public.materials where internal_code = 'REB-E1-0750-001'")).rows[0].n, 2)
  await legacy.exec("delete from public.materials where id = (select id from public.materials where internal_code = 'REB-E1-0750-001' limit 1)")
  await legacy.exec(sql217)
  assert.equal(await idx(), 1)
})

test("estoque por empresa: uma empresa não consome nem reserva o estoque da outra; transferência formal move o saldo com rastro", async () => {
  const mp = await item("Materia-prima", "MP estoque empresa", { cost: 2 })
  await asCompany(COMPANY_A)
  await stockIn(mp, 10, 2)
  const whA = (await one("select public.company_default_warehouse($1) id", [COMPANY_A])).id
  const whB = (await one("select public.company_default_warehouse($1) id", [COMPANY_B])).id
  assert.notEqual(whA, whB)
  assert.equal(Number((await one("select available from public.material_availability($1, $2)", [mp, COMPANY_A])).available), 10)
  assert.equal(Number((await one("select available from public.material_availability($1, $2)", [mp, COMPANY_B])).available), 0)
  // empresa B tenta usar o depósito da A e o próprio (sem saldo): ambos recusados
  await asCompany(COMPANY_B)
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Consumo em producao', 'quantity', 1, 'from_warehouse_id', $2::text))", [mp, whA], /outra empresa/)
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Consumo em producao', 'quantity', 1))", [mp], /Saldo insuficiente/)
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Entrada por compra', 'quantity', 1, 'to_warehouse_id', $2::text))", [mp, whA], /outra empresa/)
  // a reserva de B também não enxerga o saldo de A
  await asCompany(COMPANY_A)
  await db.query("insert into public.stock_reservations (material_id, quantity, status) values ($1, 7, 'Ativa')", [mp])
  assert.equal(Number((await one("select available from public.material_availability($1, $2)", [mp, COMPANY_A])).available), 3)
  assert.equal(Number((await one("select reserved from public.material_availability($1, $2)", [mp, COMPANY_B])).reserved), 0)
  // transferência formal: só entre empresas diferentes; move saldo e deixa rastro
  await rejects("select public.transfer_stock_between_companies($1, 1, $2, $2)", [mp, whA], /mesma empresa/)
  const transfer = (await one("select public.transfer_stock_between_companies($1, 3, $2, $3, 'Teste', 'TR-1') id", [mp, whA, whB])).id
  assert.equal(Number((await one("select available from public.material_availability($1, $2)", [mp, COMPANY_A])).available), 0)
  assert.equal(Number((await one("select available from public.material_availability($1, $2)", [mp, COMPANY_B])).available), 3)
  const log = await one("select quantity, from_company_id, to_company_id, stock_movement_id from public.stock_company_transfers where id = $1", [transfer])
  assert.deepEqual([Number(log.quantity), log.from_company_id, log.to_company_id], [3, COMPANY_A, COMPANY_B])
  assert.ok(log.stock_movement_id)
  // depois da transferência B consome o que recebeu, e a barreira volta a valer
  await asCompany(COMPANY_B)
  await db.query("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Consumo em producao', 'quantity', 3))", [mp])
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Consumo em producao', 'quantity', 1, 'from_warehouse_id', $2::text))", [mp, whA], /outra empresa/)
  await asCompany(COMPANY_A)
})

test("custeio: cada lote leva o custo histórico do que foi consumido, com apropriação rastreável; histórico imutável; ajuste só com motivo", async () => {
  await asCompany(COMPANY_A)
  const mp = await item("Materia-prima", "MP custeio", { cost: 10 }); await stockIn(mp, 500, 10)
  const { kit } = await kitWith("Kit custeio", [[mp, 6]])
  const { product } = await productWith("Produto custeio", [[kit, 1]], { labor: 30, overhead: 6 })
  const sale = await saleOf(product, 3)
  await db.query("select public.confirm_sales_order($1)", [sale])
  const order = (await one("select id from public.production_orders where sales_order_id = $1", [sale])).id
  const consume = (q, key) => db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', $3::numeric, 'request_key', $4::text))", [order, mp, q, key])
  await consume(6, "k1") // só 1 unidade de material apontada
  const lot1 = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'request_key', 'l1')) r", [order])).r
  assert.equal(Number(lot1.materials_cost), 60) // 6 x R$ 10
  await db.query("update public.materials set average_cost = 99 where id = $1", [mp]) // o custo muda DEPOIS: o histórico não pode mudar
  await consume(12, "k2")
  const lot2 = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 2, 'request_key', 'l2')) r", [order])).r
  assert.equal(Number(lot2.materials_cost), 1188) // 12 x 99: o consumo feito depois usa o custo da época dele (histórico)
  // o 1º lote continua com o custo da época; o 2º usa o custo histórico do consumo dele
  const receipts = await all("select id, quantity, unit_cost, materials_cost, labor_cost from public.production_receipts where production_order_id = $1 order by created_at", [order])
  assert.deepEqual(receipts.map((r) => Number(r.materials_cost)), [60, 1188])
  assert.deepEqual(receipts.map((r) => Number(r.labor_cost)), [36, 72]) // padrão 30 + 6 indireto x unidades
  // cada lote tem 4 apropriações (materiais, mão de obra, indiretos, outros) com critério e base
  const alloc = await all("select cost_type, amount, criterion, basis_numerator, basis_denominator from public.production_cost_allocations where receipt_id = $1 order by cost_type", [receipts[1].id])
  assert.equal(alloc.length, 4)
  assert.ok(alloc.every((a) => a.criterion.length > 10))
  assert.equal(Number(alloc.find((a) => a.cost_type === "materiais").amount), 1188)
  assert.equal(alloc.reduce((sum, a) => sum + Number(a.amount), 0), Number(receipts[1].materials_cost) + Number(receipts[1].labor_cost))
  // histórico imutável
  await rejects("update public.production_receipts set unit_cost = 1 where id = $1", [receipts[0].id], /não pode ser alterado/)
  await rejects("delete from public.production_cost_allocations where receipt_id = $1", [receipts[0].id], /não pode ser alterado/)
  await rejects("update public.production_consumptions set quantity = 1 where production_order_id = $1", [order], /não pode ser alterado/)
  // ajuste rastreável: exige motivo, mantém o histórico e registra o custo médio antes/depois
  await rejects("select public.adjust_production_cost($1, 'materiais', 10, '')", [receipts[0].id], /motivo/)
  await rejects("select public.adjust_production_cost($1, 'materiais', 0, 'x')", [receipts[0].id], /zero/)
  const before = Number((await one("select average_cost a from public.materials where id = $1", [product])).a)
  const stock = Number((await one("select current_stock s from public.materials where id = $1", [product])).s)
  const adj = (await one("select public.adjust_production_cost($1, 'materiais', 30, 'Frete do aço não considerado', 'Teste') id", [receipts[0].id])).id
  const row = await one("select amount, reason, average_cost_before b, average_cost_after a from public.production_cost_adjustments where id = $1", [adj])
  assert.equal(Number(row.b), before)
  assert.ok(Math.abs(Number(row.a) - (before + 30 / stock)) < 0.001)
  assert.equal((await one("select unit_cost c from public.production_receipts where id = $1", [receipts[0].id])).c, receipts[0].unit_cost) // o lote original não mudou
})
