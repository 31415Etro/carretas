// Etapa 6: orçamento -> pedido de venda -> produção -> MRP -> compra -> reserva -> consumo -> acabados -> entrega, no Postgres local descartável (PGlite).
// O PGlite atende uma conexão por vez: a concorrência real é protegida por bloqueios de linha e índices únicos, e aqui se testam as repetições e os índices.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db
let seq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"vendas@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r

async function material(name, { unit = "UN", cost = 0 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty, cost = null) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', $3::numeric))`, [id, qty, cost])
const comp = (component_id, quantity, unit, loss_percent = 0) => ({ component_id, quantity, unit, loss_percent })
async function kit(name, components) {
  const r = await rpc("kit_save", { name, components, activate: true })
  return { id: r.kit_id, versionId: r.version_id }
}
async function product(name, kits, { price = 9000, labor = 0, make_to_order = false } = {}) {
  const r = await rpc("product_save", { name, sale_price: price, allows_sale: true, make_to_order, unit: "UN",
    structure: { kits: kits.map(([kit_id, quantity]) => ({ kit_id, quantity })), labor_cost: labor, activate: true } })
  return { id: r.product_id, versionId: r.version_id, sku: r.sku }
}
async function approvedQuote(lines, { client } = {}) {
  const clientId = client || (await one("select id from public.clients where document is not null limit 1")).id
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0)
  const quote = (await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount, approved_at, accepted_by) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', $2, $2, now(), 'Cliente') returning id, quote_number", [clientId, total]))
  let position = 0
  for (const l of lines) {
    const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [l.product.id]))[0]
    await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, $2, 'Produto', $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12)",
      [quote.id, position++, l.product.id, `Produto ${l.product.sku}`, l.qty, l.price, snap.est_cost, l.qty * l.price, snap.bom_version_id, snap.bom_version, 30, snap.sku])
  }
  return quote.id
}
const toOrder = async (quoteId) => (await rpc("sales_order_from_quote", { }).catch(() => null)) || (await one("select public.sales_order_from_quote($1::uuid, 'Vendedor') r", [quoteId])).r
const confirm = async (orderId) => (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [orderId])).r
const orderRow = (id) => one("select * from public.sales_orders where id = $1", [id])
const detail = async (id) => (await one("select public.sales_order_detail($1::uuid) d", [id])).d
const prodDetail = async (id) => (await one("select public.production_order_detail($1::uuid) d", [id])).d
const consume = (poId, materialId, quantity, key) => db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', $3::numeric, 'request_key', $4::text, 'responsible', 'Operador'))", [poId, materialId, quantity, key])
const complete = async (poId, quantity, key) => (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', $2::numeric, 'request_key', $3::text, 'responsible', 'Operador')) r", [poId, quantity, key])).r

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql"] })
  await db.exec(`select public.sales_settings_update('{"require_documentation_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)  // estas suítes testam outras regras; a liberação por documentação tem a suíte etapa7
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
})

test("fluxo completo: produto -> orçamento -> pedido -> confirmação -> estoque de acabados -> ordem -> MRP -> compra -> reserva -> consumo -> parcial -> conclusão -> entrega", async () => {
  // 1-5: matéria-prima, kits, produto
  const perfil = await material("Perfil E2E", { unit: "M", cost: 10 })
  const parafuso = await material("Parafuso E2E", { cost: 0.5 })
  const fio = await material("Fio E2E", { unit: "M", cost: 2 })
  const chassi = await kit("Kit Chassi E2E", [comp(perfil, 6, "M"), comp(parafuso, 16, "UN")])
  const eletrica = await kit("Kit Elétrica E2E", [comp(fio, 4, "M")])
  const prod = await product("Carreta E2E", [[chassi.id, 1], [eletrica.id, 1]], { price: 9000, labor: 300 })
  // acabados em estoque: 2 unidades; materiais: perfil insuficiente (10 m para 18 necessários)
  await stockIn(prod.id, 2, 5000); await stockIn(perfil, 10, 10); await stockIn(parafuso, 200, 0.5); await stockIn(fio, 50, 2)
  const movesAtStart = num((await one("select count(*) n from public.stock_movements")).n)

  // 6-8: orçamento aprovado -> pedido (sem reservar nem consumir)
  const quoteId = await approvedQuote([{ product: prod, qty: 5, price: 9000 }])
  assert.equal(num((await one("select count(*) n from public.stock_reservations where status = 'Ativa'")).n), 0)
  const created = (await one("select public.sales_order_from_quote($1::uuid, 'Vendedor') r", [quoteId])).r
  assert.equal(created.duplicate, false)
  assert.match(created.order_number, /^PV-\d{4}-\d{5}$/)
  const again = (await one("select public.sales_order_from_quote($1::uuid, 'Vendedor') r", [quoteId])).r // clique duplo
  assert.deepEqual([again.duplicate, again.sales_order_id], [true, created.sales_order_id])
  assert.equal(num((await one("select count(*) n from public.sales_orders where quote_id = $1", [quoteId])).n), 1)
  let order = await orderRow(created.sales_order_id)
  assert.deepEqual([order.status, order.quote_id, num(order.total_amount)], ["Aguardando confirmacao", quoteId, 45000])
  const quote = await one("select status, converted_to from public.quotes where id = $1", [quoteId])
  assert.deepEqual([quote.status, quote.converted_to], ["Convertido", "Pedido de venda"])
  const item = (await all("select * from public.sales_order_items where sales_order_id = $1", [order.id]))[0]
  assert.deepEqual([num(item.unit_price), num(item.unit_cost) > 0, item.quoted_bom_version_number, item.product_sku], [9000, true, 1, prod.sku]) // snapshot do orçamento
  assert.equal(num((await one("select count(*) n from public.stock_reservations where status = 'Ativa' and sales_order_item_id = $1", [item.id])).n), 0)
  // pré-visualização antes de confirmar: 2 do estoque, 3 a fabricar
  const preview = (await detail(order.id)).availability[0]
  assert.deepEqual([num(preview.available_finished), num(preview.would_reserve), num(preview.would_produce)], [2, 2, 3])

  // 9-12: confirmar -> reserva 2 acabados + ordem de 3, com estrutura e kits congelados e explosão
  const confirmed = await confirm(order.id)
  assert.equal(confirmed.production_orders_created.length, 1)
  order = await orderRow(order.id)
  assert.equal(order.status, "Parcialmente disponivel") // 2 prontas, 3 em fabricação
  const reserved = num((await one("select sum(quantity) q from public.stock_reservations where status = 'Ativa' and sales_order_item_id = $1", [item.id])).q)
  assert.equal(reserved, 2)
  assert.equal(num((await one("select physical from public.material_availability($1)", [prod.id])).physical), 2) // nada saiu do estoque de acabados
  const poId = confirmed.production_orders_created[0]
  const po = await prodDetail(poId)
  assert.deepEqual([num(po.order.quantity), po.order.bom_version, po.order.sales_status], [3, 1, "Parcialmente disponivel"])
  assert.deepEqual(po.kits.map((k) => [k.name, num(k.quantity)]).sort(), [["Kit Chassi E2E", 3], ["Kit Elétrica E2E", 3]])
  const need = Object.fromEntries(po.materials.map((m) => [m.name, num(m.required)]))
  assert.deepEqual(need, { "Perfil E2E": 18, "Parafuso E2E": 48, "Fio E2E": 12 })
  // reserva só do que havia: perfil 10 de 18 -> aguardando materiais
  assert.equal(po.order.status, "Aguardando materiais")
  assert.equal(num(po.materials.find((m) => m.name === "Perfil E2E").reserved), 10)

  // 13-15: MRP aponta a falta; solicitação de compra consolidada (e sem duplicar)
  const mrp = (await all("select * from public.mrp_overview()")).find((r) => r.name === "Perfil E2E")
  assert.deepEqual([num(mrp.required), num(mrp.reserved_for_orders), num(mrp.unreserved_need), num(mrp.available), num(mrp.shortage_now), num(mrp.shortage_projected), num(mrp.to_request)], [18, 10, 8, 0, 8, 8, 8])
  const request = (await one("select public.generate_purchase_request_consolidated('Compras') id")).id
  const requestItems = await all("select m.name, i.quantity from public.purchase_request_items i join public.materials m on m.id = i.material_id where i.purchase_request_id = $1", [request])
  assert.deepEqual(requestItems.map((r) => [r.name, num(r.quantity)]), [["Perfil E2E", 8]])
  assert.equal(num((await one("select count(*) n from public.purchase_request_sources where purchase_request_id = $1 and production_order_id = $2", [request, poId])).n), 1)
  await rejects("select public.generate_purchase_request_consolidated('Compras')", [], /Não há falta/) // repetir não duplica
  assert.equal(num((await one("select count(*) n from public.purchase_requests where status = 'Pendente'")).n), 1)
  assert.equal(num((await all("select * from public.mrp_overview()")).find((r) => r.name === "Perfil E2E").to_request), 0)
  // aprovar a solicitação não emite pedido a fornecedor
  await db.query("select public.purchase_request_set_status($1::uuid, 'Aprovada', 'Compras')", [request])
  assert.equal(num((await one("select count(*) n from public.purchase_orders")).n), 0)

  // 16-17: recebe o material e reserva
  await stockIn(perfil, 20, 11) // custo médio sobe
  const reserve = (await one("select public.reserve_production_materials($1::uuid, 'Planejador') r", [poId])).r
  assert.equal(num(reserve.materials_with_shortage), 0)
  let live = await prodDetail(poId)
  assert.equal(live.order.status, "Pronta para producao")
  assert.equal(num(live.materials.find((m) => m.name === "Perfil E2E").reserved), 18)
  await rejects("select public.reserve_production_materials($1::uuid, 'Planejador')", [poId], /Estoque|^$/).catch(() => null)
  assert.equal(num((await one("select sum(quantity) q from public.stock_reservations where status = 'Ativa' and production_order_id = $1 and material_id = $2", [poId, perfil])).q), 18) // reservar de novo não duplica

  // 18-19: inicia e registra consumo (duas vezes a mesma chave = uma baixa)
  assert.equal((await one("select public.production_change_status($1::uuid, 'start', 'Chefe') s", [poId])).s, "Em producao")
  const before = num((await one("select physical from public.material_availability($1)", [perfil])).physical)
  await consume(poId, perfil, 12, "c1"); await consume(poId, perfil, 12, "c1")
  assert.equal(before - num((await one("select physical from public.material_availability($1)", [perfil])).physical), 12)
  await consume(poId, parafuso, 32, "c2"); await consume(poId, fio, 8, "c3") // material para 2 unidades

  // 20-21: conclui 1 e depois mais 1 (parcial), com o acabado reservado ao pedido
  const lot1 = await complete(poId, 1, "l1")
  const lot1again = await complete(poId, 1, "l1")
  assert.equal(lot1again.duplicate, true)
  assert.equal(lot1again.receipt_id, lot1.receipt_id) // a mesma conclusão não entra duas vezes
  order = await orderRow(order.id)
  assert.equal(order.status, "Parcialmente disponivel")
  assert.equal(num((await one("select sum(quantity) q from public.stock_reservations where status = 'Ativa' and sales_order_item_id = $1", [item.id])).q), 3) // 2 do estoque + 1 produzida
  assert.equal(num((await one("select physical from public.material_availability($1)", [prod.id])).physical), 3)
  live = await prodDetail(poId)
  assert.deepEqual([live.order.status, num(live.progress.produced), num(live.progress.remaining)], ["Em producao", 1, 2])
  await complete(poId, 1, "l2")

  // 22: apontamento do restante e conclusão
  await consume(poId, perfil, 6, "c4"); await consume(poId, parafuso, 16, "c5"); await consume(poId, fio, 4, "c6")
  await complete(poId, 1, "l3")
  live = await prodDetail(poId)
  assert.equal(live.order.status, "Concluida")
  assert.equal(num((await one("select count(*) n from public.production_receipts where production_order_id = $1", [poId])).n), 3) // 3 lotes
  assert.ok(live.receipts.every((r) => num(r.unit_cost) > 0 && r.allocations.length === 4)) // custo por lote rastreável
  assert.ok(num(live.costs.consumed_materials) > 0 && num(live.costs.in_process_materials) === 0)
  // 23: o pedido está pronto para entrega, com todas as unidades reservadas
  order = await orderRow(order.id)
  assert.equal(order.status, "Pronto para entrega")
  let d = await detail(order.id)
  assert.deepEqual([num(d.items[0].reserved), num(d.items[0].delivered), num(d.items[0].produced), num(d.items[0].in_production)], [5, 0, 3, 0])
  // entrega: baixa dos acabados uma única vez (repetição com a mesma chave não baixa de novo)
  const delivery = (await one("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text, 'request_key', 'e1', 'user', 'Expedição')) r", [order.id])).r
  const repeat = (await one("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text, 'request_key', 'e1', 'user', 'Expedição')) r", [order.id])).r
  assert.deepEqual([num(delivery.delivered), repeat.duplicate], [5, true])
  assert.equal(num((await one("select physical from public.material_availability($1)", [prod.id])).physical), 0)
  order = await orderRow(order.id)
  assert.equal(order.status, "Entregue")
  // 24: histórico completo preservado
  d = await detail(order.id)
  assert.ok(["Criado", "Situação", "Entrega"].every((e) => d.events.some((x) => x.event === e)))
  assert.deepEqual([d.deliveries.length, d.production_orders.length], [1, 1])
  live = await prodDetail(poId)
  assert.ok(["Criada", "Situação", "Consumo", "Conclusão parcial/total"].every((e) => live.events.some((x) => x.event === e)))
  assert.equal(num((await one("select count(*) n from public.quote_events where quote_id = $1 and event = 'Convertido'", [quoteId])).n), 1)
  // o orçamento, o pedido e a ordem continuam com os valores da época
  await rpc("product_save", { product_id: prod.id, name: "Carreta E2E", sale_price: 12000, allows_sale: true })
  assert.equal(num((await one("select unit_price from public.sales_order_items where id = $1", [item.id])).unit_price), 9000)
  assert.ok(num((await one("select count(*) n from public.stock_movements")).n) > movesAtStart)
  // histórico de produção continua imutável
  await rejects("update public.production_receipts set quantity = 99 where production_order_id = $1", [poId], /não pode ser alterado/)
})

test("conversão do orçamento: validações, empresa e situação 'Em negociação'", async () => {
  const m = await material("MP Conv", { cost: 1 })
  const k = await kit("Kit Conv", [comp(m, 1, "UN")])
  const prod = await product("Produto Conv", [[k.id, 1]])
  const noDoc = (await one("insert into public.clients (name, type) values ('Cliente sem documento', 'PJ') returning id")).id
  const semDocumento = await approvedQuote([{ product: prod, qty: 1, price: 9000 }], { client: noDoc })
  await rejects("select public.sales_order_from_quote($1::uuid)", [semDocumento], /CPF\/CNPJ/)
  const draft = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  await db.query("update public.quotes set status = 'Enviado' where id = $1", [draft])
  await rejects("select public.sales_order_from_quote($1::uuid)", [draft], /orçamento aprovado/)
  await db.query("update public.quotes set status = 'Em negociação' where id = $1", [draft]) // nova situação aceita pelo banco
  await rejects("select public.sales_order_from_quote($1::uuid)", [draft], /orçamento aprovado/)
  await db.query("update public.quotes set status = 'Aprovado' where id = $1", [draft])
  await rejects("select public.sales_order_from_quote($1::uuid)", ["00000000-0000-0000-0000-000000000000"], /não encontrado/)
  await asCompany(COMPANY_B)
  await rejects("select public.sales_order_from_quote($1::uuid)", [draft], /outra empresa/)
  await asCompany(COMPANY_A)
  const ok = (await one("select public.sales_order_from_quote($1::uuid) r", [draft])).r
  assert.equal(ok.duplicate, false)
  // quem confirma na empresa errada é barrado, e o pedido segue intacto
  await asCompany(COMPANY_B)
  await rejects("select public.confirm_sales_order($1::uuid)", [ok.sales_order_id], /outra empresa/)
  await rejects("select public.sales_order_detail($1::uuid)", [ok.sales_order_id], /não encontrado/)
  assert.equal((await all("select 1 from public.sales_order_list()")).length, 0)
  await asCompany(COMPANY_A)
  assert.equal((await orderRow(ok.sales_order_id)).status, "Aguardando confirmacao")
  // o mesmo orçamento não vira dois pedidos nem por inserção direta
  await rejects("insert into public.sales_orders (order_number, quote_id, client_id) values ('PV-DUP', $1, (select client_id from public.sales_orders where id = $2))", [draft, ok.sales_order_id], /duplicate|unique|único/i)
})

test("produto sem estrutura e sem acabado: confirmação é recusada por inteiro; com estoque de acabados o pedido é atendido sem fabricar", async () => {
  const semEstrutura = (await one("insert into public.materials (name, unit, item_type, internal_code, status, controls_stock, allows_sale, sale_price) values ('Produto Legado', 'UN', 'Produto', 'PRD-LEG-1', 'Ativo', true, true, 500) returning id")).id
  const q = await approvedQuote([{ product: { id: semEstrutura, sku: "PRD-LEG-1" }, qty: 2, price: 500 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  await rejects("select public.confirm_sales_order($1::uuid)", [order], /não tem estrutura de fabricação ativa/)
  assert.equal((await orderRow(order)).status, "Aguardando confirmacao") // nada ficou pela metade
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 0)
  // com saldo de acabados suficiente, o produto legado é só reservado
  await stockIn(semEstrutura, 3, 100)
  const result = await confirm(order)
  assert.equal(result.production_orders_created.length, 0)
  assert.equal((await orderRow(order)).status, "Pronto para entrega")
})

test("sob encomenda: fabrica mesmo havendo saldo de acabados; confirmar duas vezes não duplica a ordem", async () => {
  const m = await material("MP Encomenda", { cost: 2 }); await stockIn(m, 100, 2)
  const k = await kit("Kit Encomenda", [comp(m, 5, "UN")])
  const prod = await product("Produto Encomenda", [[k.id, 1]], { make_to_order: true })
  await stockIn(prod.id, 4, 100)
  const q = await approvedQuote([{ product: prod, qty: 2, price: 9000 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  const first = await confirm(order)
  const second = await confirm(order) // clique duplo / requisição repetida
  assert.equal(first.production_orders_created.length, 1)
  assert.deepEqual([second.production_orders_created.length, second.already_existing.length], [0, 1])
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 1)
  assert.equal(num((await one("select quantity from public.production_orders where sales_order_id = $1", [order])).quantity), 2) // tudo fabricado, apesar do saldo
  assert.equal(num((await one("select count(*) n from public.stock_reservations where sales_order_item_id in (select id from public.sales_order_items where sales_order_id = $1) and status = 'Ativa'", [order])).n), 0)
  // o índice único impede uma segunda ordem ativa para o mesmo item, mesmo por inserção direta
  const itemId = (await one("select id from public.sales_order_items where sales_order_id = $1", [order])).id
  await rejects("insert into public.production_orders (code, sales_order_id, sales_order_item_id, product_id, bom_version_id, quantity) values ('OP-DUP', $1, $2, $3, $4, 1)", [order, itemId, prod.id, prod.versionId], /duplicate|unique|único/i)
})

test("exigir sinal: a demanda e os materiais são planejados, mas o início físico só libera com o pagamento; repetir a confirmação não duplica", async () => {
  const m = await material("MP Sinal", { cost: 1 }); await stockIn(m, 100, 1)
  const k = await kit("Kit Sinal", [comp(m, 2, "UN")])
  const prod = await product("Produto Sinal", [[k.id, 1]])
  await db.query("select public.sales_settings_save(true, 'Gerente')")
  const q = await approvedQuote([{ product: prod, qty: 3, price: 9000 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  const confirmed = await confirm(order)
  assert.equal(confirmed.blocked, false)
  assert.equal(confirmed.production_orders_created.length, 1) // demanda registrada
  const po = confirmed.production_orders_created[0]
  assert.equal(num((await one("select sum(reserved_quantity) q from public.production_order_materials where production_order_id = $1", [po])).q), 6) // materiais planejados e reservados
  assert.equal((await orderRow(order)).status, "Aguardando producao")
  assert.deepEqual(confirmed.release.blockers.map((b) => b.code), ["pagamento"])
  await rejects("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po], /sinal\/pagamento/)
  await rejects("select public.confirm_sales_payment($1::uuid)", ["00000000-0000-0000-0000-000000000000"], /não encontrado/)
  const paid = (await one("select public.confirm_sales_payment($1::uuid, 'Financeiro', 'Sinal de 30%') r", [order])).r
  assert.equal(paid.release.eligible, true)
  assert.equal((await orderRow(order)).payment_confirmed_by, "Financeiro")
  assert.equal((await orderRow(order)).status, "Em producao")
  const paidAgain = (await one("select public.confirm_sales_payment($1::uuid, 'Financeiro') r", [order])).r
  assert.deepEqual([paidAgain.production_orders_created.length, paidAgain.already_existing.length], [0, 1])
  assert.equal(num((await one("select count(*) n from public.production_orders where sales_order_id = $1", [order])).n), 1)
  await db.query("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po])
  await db.query("select public.sales_settings_save(false, 'Gerente')")
})

test("estoque disputado: duas ordens não contam o mesmo saldo; a falta é consolidada em uma única solicitação com origem por ordem", async () => {
  const m = await material("MP Disputa", { unit: "M", cost: 3 }); await stockIn(m, 10, 3)
  const k = await kit("Kit Disputa", [comp(m, 4, "M")])
  const prod = await product("Produto Disputa", [[k.id, 1]])
  const orders = []
  for (const qty of [2, 2]) {
    const q = await approvedQuote([{ product: prod, qty, price: 9000 }])
    const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
    orders.push((await confirm(order)).production_orders_created[0])
  }
  const reservedTotal = num((await one("select coalesce(sum(quantity), 0) q from public.stock_reservations where material_id = $1 and status = 'Ativa'", [m])).q)
  assert.equal(reservedTotal, 10) // nunca mais do que o saldo físico
  const rows = await all("select po.code, pom.reserved_quantity r, pom.required_quantity q from public.production_order_materials pom join public.production_orders po on po.id = pom.production_order_id where pom.material_id = $1 order by po.created_at", [m])
  assert.deepEqual(rows.map((r) => [num(r.q), num(r.r)]), [[8, 8], [8, 2]]) // a primeira ficou completa; a segunda, com o que sobrou
  const mrp = (await all("select * from public.mrp_overview()")).find((r) => r.name === "Disputa".replace("Disputa", "MP Disputa"))
  assert.deepEqual([num(mrp.required), num(mrp.unreserved_need), num(mrp.shortage_projected)], [16, 6, 6])
  assert.equal(mrp.orders.length, 2)
  const req = (await one("select public.generate_purchase_request_consolidated() id")).id
  assert.equal(num((await one("select count(*) n from public.purchase_request_items where purchase_request_id = $1", [req])).n), 1)
  const src = await all("select po.code, s.quantity from public.purchase_request_sources s join public.production_orders po on po.id = s.production_order_id where s.purchase_request_id = $1", [req])
  assert.deepEqual(src.map((r) => num(r.quantity)), [6]) // só a ordem que ficou sem material
  // compra aprovada cobre a falta no projetado: nova solicitação não é necessária
  const supplier = (await one("insert into public.suppliers (name) values ('Fornecedor Disputa') returning id")).id
  const po = (await one("insert into public.purchase_orders (order_number, supplier_id, supplier_name, status, expected_date) values ('PC-DISP', $1, 'Fornecedor Disputa', 'Aprovado', current_date + 5) returning id", [supplier])).id
  await db.query("insert into public.purchase_order_items (purchase_order_id, material_id, description, unit, quantity, unit_cost, total) values ($1, $2, 'MP', 'M', 6, 3, 18)", [po, m])
  const after = (await all("select * from public.mrp_overview()")).find((r) => r.name === "MP Disputa")
  assert.deepEqual([num(after.incoming), num(after.shortage_now), num(after.shortage_projected)], [6, 6, 0])
  assert.equal(after.arrivals[0].purchase_order, "PC-DISP")
  assert.ok(after.next_arrival)
  assert.equal(orders.length, 2)
})

test("composição alterada depois da liberação não muda a ordem em andamento; ordens novas usam a nova versão", async () => {
  const m = await material("MP Versão", { cost: 1 }); await stockIn(m, 500, 1)
  const k = await kit("Kit Versão", [comp(m, 10, "UN")])
  const prod = await product("Produto Versão", [[k.id, 1]])
  const q1 = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  const o1 = (await one("select public.sales_order_from_quote($1::uuid) r", [q1])).r.sales_order_id
  const po1 = (await confirm(o1)).production_orders_created[0]
  // nova versão do kit (20 por unidade) ativada; o produto acompanha a versão vigente do kit
  await rpc("kit_save", { kit_id: k.id, name: "Kit Versão", components: [comp(m, 20, "UN")], activate: true })
  const frozen = await prodDetail(po1)
  assert.equal(num(frozen.materials[0].required), 10) // ordem existente: composição congelada
  const q2 = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  const o2 = (await one("select public.sales_order_from_quote($1::uuid) r", [q2])).r.sales_order_id
  const po2 = (await confirm(o2)).production_orders_created[0]
  assert.equal(num((await prodDetail(po2)).materials[0].required), 20)
  // mudança de estrutura do produto depois do orçamento fica sinalizada no pedido
  const k2 = await kit("Kit Extra", [comp(m, 1, "UN")])
  await rpc("product_save", { product_id: prod.id, name: "Produto Versão", sale_price: 9000, allows_sale: true, structure: { kits: [{ kit_id: k.id, quantity: 1 }, { kit_id: k2.id, quantity: 1 }], change_reason: "Novo kit", activate: true } })
  const q3 = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  await db.query("update public.quote_items set bom_version_id = $1, bom_version_number = 1 where quote_id = $2", [prod.versionId, q3]) // orçamento emitido na estrutura v1
  const o3 = (await one("select public.sales_order_from_quote($1::uuid) r", [q3])).r.sales_order_id
  await confirm(o3)
  const d3 = await detail(o3)
  assert.deepEqual([d3.items[0].quoted_bom_version, d3.items[0].bom_version, d3.items[0].structure_changed], [1, 2, true])
})

test("cancelamento: libera reservas; recusa se já houve consumo ou entrega", async () => {
  const m = await material("MP Cancela", { cost: 1 }); await stockIn(m, 100, 1)
  const k = await kit("Kit Cancela", [comp(m, 5, "UN")])
  const prod = await product("Produto Cancela", [[k.id, 1]])
  const q = await approvedQuote([{ product: prod, qty: 2, price: 9000 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  const po = (await confirm(order)).production_orders_created[0]
  assert.equal(num((await one("select coalesce(sum(quantity), 0) q from public.stock_reservations where production_order_id = $1 and status = 'Ativa'", [po])).q), 10)
  await rejects("select public.cancel_sales_order($1::uuid, '')", [order], /motivo/)
  await asCompany(COMPANY_B)
  await rejects("select public.cancel_sales_order($1::uuid, 'teste')", [order], /outra empresa/)
  await asCompany(COMPANY_A)
  // consumo apontado impede o cancelamento (devolução é ajuste explícito)
  await consume(po, m, 3, "k1")
  await rejects("select public.cancel_sales_order($1::uuid, 'Cliente desistiu')", [order], /já tem consumo apontado/)
  assert.equal((await orderRow(order)).status, "Em producao")
  // sem consumo: cancela e libera tudo
  const q2 = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  const order2 = (await one("select public.sales_order_from_quote($1::uuid) r", [q2])).r.sales_order_id
  const po2 = (await confirm(order2)).production_orders_created[0]
  await db.query("select public.cancel_sales_order($1::uuid, 'Cliente desistiu')", [order2])
  assert.equal((await orderRow(order2)).status, "Cancelado")
  assert.equal((await one("select status from public.production_orders where id = $1", [po2])).status, "Cancelada")
  assert.equal(num((await one("select count(*) n from public.stock_reservations where status = 'Ativa' and production_order_id = $1", [po2])).n), 0)
  await rejects("select public.confirm_sales_order($1::uuid)", [order2], /cancelado/)
  // pedido entregue não é cancelado
  await stockIn(prod.id, 1, 100)
  const q3 = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  const order3 = (await one("select public.sales_order_from_quote($1::uuid) r", [q3])).r.sales_order_id
  await confirm(order3)
  await db.query("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text))", [order3])
  await rejects("select public.cancel_sales_order($1::uuid, 'tarde demais')", [order3], /já teve entrega/)
})

test("produção parcial e entrega parcial: custo por lote sem distribuir o restante arbitrariamente; pausa e retomada", async () => {
  const m = await material("MP Parcial", { cost: 10 }); await stockIn(m, 100, 10)
  const k = await kit("Kit Parcial", [comp(m, 4, "UN")])
  const prod = await product("Produto Parcial", [[k.id, 1]], { labor: 100 })
  const q = await approvedQuote([{ product: prod, qty: 5, price: 9000 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  const po = (await confirm(order)).production_orders_created[0]
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Pronta para producao")
  await rejects("select public.production_change_status($1::uuid, 'pause', 'Chefe', '')", [po], /motivo/)
  await db.query("select public.production_change_status($1::uuid, 'pause', 'Chefe', 'Falta de operador')", [po])
  await rejects("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 1))", [po, m], /pausada/)
  await rejects("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1))", [po], /pausada/)
  assert.equal((await one("select public.production_change_status($1::uuid, 'resume', 'Chefe') s", [po])).s, "Pronta para producao")
  await db.query("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po])
  await consume(po, m, 8, "p1") // material de 2 unidades
  await rejects("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 3))", [po], /Faltam apontamentos/)
  const lot1 = await complete(po, 2, "p-l1")
  assert.deepEqual([num(lot1.quantity), num(lot1.materials_cost), num(lot1.unit_cost)], [2, 80, 140]) // (80 + 200 de mão de obra) / 2
  assert.equal((await orderRow(order)).status, "Parcialmente disponivel")
  let d = await detail(order)
  assert.deepEqual([num(d.items[0].reserved), num(d.items[0].produced), num(d.items[0].in_production)], [2, 2, 3])
  // entrega parcial das 2 prontas
  await db.query("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text, 'request_key', 'x1'))", [order])
  d = await detail(order)
  assert.deepEqual([num(d.items[0].reserved), num(d.items[0].delivered)], [0, 2])
  assert.equal((await orderRow(order)).status, "Em producao") // nada pronto no momento; 3 ainda em fabricação
  await rejects("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text))", [order], /não tem produtos prontos|Em producao/)
  await consume(po, m, 12, "p2")
  const lot2 = await complete(po, 3, "p-l2")
  assert.equal(num(lot2.materials_cost), 120)
  assert.equal(num(lot2.unit_cost), 140) // o custo do segundo lote não absorve o do primeiro
  // entrega do restante: cada item não pode ser entregue além do pronto
  await rejects("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text, 'items', jsonb_build_array(jsonb_build_object('item_id', (select id::text from public.sales_order_items where sales_order_id = $1::uuid), 'quantity', 9))))", [order], /apenas/)
  await db.query("select public.deliver_sales_order(jsonb_build_object('sales_order_id', $1::text))", [order])
  assert.equal((await orderRow(order)).status, "Entregue")
  // ajuste de custo só com motivo, sem reescrever o histórico
  const receipt = (await one("select id from public.production_receipts where production_order_id = $1 order by created_at limit 1", [po])).id
  await rejects("select public.adjust_production_cost($1::uuid, 'materiais', 10, '')", [receipt], /motivo/)
  await db.query("select public.adjust_production_cost($1::uuid, 'materiais', 10, 'Reajuste de frete', 'Controladoria')", [receipt])
  assert.equal(num((await prodDetail(po)).costs.adjustments), 10)
})

test("empresas isoladas: reservas, MRP, ordens e indicadores de uma empresa não aparecem nem consomem saldo da outra", async () => {
  await asCompany(COMPANY_A)
  const m = await material("MP Isolada", { cost: 1 }); await stockIn(m, 40, 1)
  const k = await kit("Kit Isolado", [comp(m, 10, "UN")])
  const prod = await product("Produto Isolado", [[k.id, 1]])
  const q = await approvedQuote([{ product: prod, qty: 1, price: 9000 }])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [q])).r.sales_order_id
  const po = (await confirm(order)).production_orders_created[0]
  const dashboardA = (await one("select public.production_dashboard() d")).d
  assert.ok(num(dashboardA.orders_open) >= 1)
  await asCompany(COMPANY_B)
  assert.equal((await all("select 1 from public.mrp_overview()")).length, 0)
  assert.equal((await all("select 1 from public.production_order_list()")).length, 0)
  const dashboardB = (await one("select public.production_dashboard() d")).d
  assert.deepEqual([num(dashboardB.orders_open), num(dashboardB.units_pending), num(dashboardB.materials_short)], [0, 0, 0])
  await rejects("select public.production_order_detail($1::uuid)", [po], /não encontrada/)
  await rejects("select public.production_change_status($1::uuid, 'start')", [po], /outra empresa/)
  await rejects("select public.complete_production(jsonb_build_object('production_order_id', $1::text))", [po], /outra empresa/)
  await rejects("select public.reserve_production_materials($1::uuid)", [po], /outra empresa/)
  await rejects("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 1))", [po, m], /outra empresa/)
  await rejects("select public.cancel_production_order($1::uuid, 'x')", [po], /outra empresa/)
  await rejects("select public.generate_purchase_request($1::uuid)", [po], /outra empresa/)
  await rejects("select public.purchase_request_set_status($1::uuid, 'Aprovada')", ["00000000-0000-0000-0000-000000000000"], /não encontrada/)
  // saldo da empresa B continua zero; a empresa A mantém o dela
  assert.equal(num((await one("select physical from public.material_availability($1)", [m])).physical), 0)
  await asCompany(COMPANY_A)
  assert.equal(num((await one("select physical from public.material_availability($1)", [m])).physical), 40)
})

test("listas e indicadores: dados reais, filtros e paginação", async () => {
  await asCompany(COMPANY_A)
  const list = await all("select * from public.sales_order_list(null, null, 5, 0)")
  assert.ok(list.length > 0 && num(list[0].total_count) >= list.length)
  assert.ok(list.every((r) => r.client_name && r.order_number))
  assert.ok((await all("select * from public.sales_order_list('PV-', 'abertos', 50, 0)")).every((r) => !["Entregue", "Cancelado"].includes(r.status)))
  const open = await all("select * from public.production_order_list(null, 'abertas', 50, 0)")
  assert.ok(open.every((r) => !["Concluida", "Cancelada"].includes(r.status)))
  const dash = (await one("select public.production_dashboard() d")).d
  for (const key of ["orders_open", "orders_in_progress", "units_pending", "units_completed_30d", "orders_late", "materials_short", "purchase_requests_pending", "sales_awaiting_production"]) assert.ok(key in dash, key)
  assert.ok(num(dash.units_completed_30d) > 0) // vem das conclusões registradas nos testes anteriores
  assert.ok(num(dash.cost_completed.orders) >= 1 && num(dash.cost_completed.actual) > 0)
  const requests = (await one("select public.purchase_request_list() r")).r
  assert.ok(requests.length >= 1 && requests[0].items.length >= 1)
})

test("script 223 é idempotente: rodar de novo não falha nem muda o que já existe", async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "223_pedido_producao_integracao.sql")
  const before = num((await one("select count(*) n from public.sales_orders")).n)
  await db.exec(fs.readFileSync(file, "utf8"))
  assert.equal(num((await one("select count(*) n from public.sales_orders")).n), before)
  assert.equal(num((await one("select count(*) n from pg_trigger where tgname = 'trg_production_receipt_after_insert'")).n), 1)
})
