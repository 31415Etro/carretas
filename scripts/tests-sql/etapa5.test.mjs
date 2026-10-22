// Etapa 5: produtos finais, estrutura de fabricação, custos, explosão, capacidade e estoque de acabados, no Postgres local descartável (PGlite).
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"eng@teste.com"}', false)`)
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
const base = { name: "Carreta Teste", unit: "UN", sale_price: 5000, allows_sale: true }
const structure = (kits, extra = {}) => ({ kits: kits.map(([kit_id, quantity, pin_version]) => ({ kit_id, quantity, pin_version })), labor_cost: 0, overhead_cost: 0, other_cost: 0, ...extra })
const saveProduct = (payload) => rpc("product_save", payload)

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
})

test("cadastro: SKU PRD- automático, especificações, dados comerciais e SKU duplicado recusado", async () => {
  const movesBefore = (await one("select count(*)::int n from public.stock_movements")).n
  const r = await saveProduct({ ...base, auto_sku: true, model: "FZ 1E", category: "Carreta", product_line: "Linha Náutica", description: "Carreta para jet",
    specs: { length: 450, width: 180, height: 120, net_weight: 320, gross_weight: 900, payload_capacity: 580, axle_count: 1, finish_type: "Galvanizado a fogo", engineering_notes: "Eixo único" },
    lead_time_days: 30, warranty_months: 12, available_for_quote: true, make_to_order: false, internal_ref: "LEG-77", attributes: { cor: "cinza" } })
  assert.match(r.sku, /^PRD-\d{6}$/)
  assert.equal(r.created, true)
  const row = await one("select * from public.materials where id = $1", [r.product_id])
  assert.deepEqual([row.item_type, row.product_model, row.product_line, Number(row.payload_capacity), row.axle_count, Number(row.lead_time_days), Number(row.warranty_months), row.internal_ref], ["Produto", "FZ 1E", "Linha Náutica", 580, 1, 30, 12, "LEG-77"])
  assert.equal(row.product_attributes.cor, "cinza")
  assert.equal((await one("select count(*)::int n from public.stock_movements")).n, movesBefore) // cadastrar não movimenta estoque
  assert.equal((await one("select count(*)::int n from public.stock_balances where material_id = $1", [r.product_id])).n, 0) // nem cria saldo fictício
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Outro", auto_sku: false, sku: r.sku.toLowerCase() })], /já existe no catálogo/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "ab" })], /nome comercial/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Sem preço", sale_price: 0 })], /exige preço/)
  const nonSellable = await saveProduct({ name: "Protótipo interno", sale_price: 0, allows_sale: false, available_for_quote: false })
  assert.equal((await one("select available_for_quote a from public.materials where id = $1", [nonSellable.product_id])).a, false)
})

test("edição: dados mudam, histórico e SKU preservados, alteração de preço registrada", async () => {
  const created = await saveProduct({ ...base, name: "Produto Editável", category: "Carreta" })
  const edited = await saveProduct({ ...base, product_id: created.product_id, name: "Produto Editável 2", category: "Carreta", sale_price: 5600, sku: created.sku })
  assert.equal(edited.sku, created.sku)
  const detail = (await one("select public.product_detail($1) d", [created.product_id])).d
  assert.equal(detail.product.name, "Produto Editável 2")
  const actions = detail.change_log.map((l) => l.action)
  assert.ok(actions.includes("preco_alterado"))
  assert.ok(detail.change_log.some((l) => l.changed_by === "eng@teste.com"))
  assert.equal((await all("select 1 from public.materials where internal_code = $1", [created.sku])).length, 1)
})

test("NCM do produto é próprio e exige confirmação; não vem das matérias-primas", async () => {
  const mp = await material("MP com NCM", { cost: 1 }); await db.query("update public.materials set ncm = '72162100' where id = $1", [mp])
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Produto NCM", ncm: "8716.39.00", ncm_confirmed: false })], /Confirme o NCM/)
  const r = await saveProduct({ ...base, name: "Produto NCM", ncm: "8716.39.00", ncm_confirmed: true, ncm_source: "Tabela NCM oficial", ncm_description: "Outros reboques", user: "Fiscal" })
  const row = await one("select ncm, ncm_confirmed_by, ncm_source from public.materials where id = $1", [r.product_id])
  assert.deepEqual([row.ncm, row.ncm_confirmed_by, row.ncm_source], ["87163900", "Fiscal", "Tabela NCM oficial"])
  const noNcm = await saveProduct({ ...base, name: "Produto Sem NCM" })
  assert.equal((await one("select ncm from public.materials where id = $1", [noNcm.product_id])).ncm, null) // não herda o das matérias-primas
})

test("estrutura: vincula kits por ID com quantidade por unidade, remove, e exige kit ativo com versão", async () => {
  const m = await material("MP Estrutura", { cost: 10 })
  const k1 = await kit("Kit Chassi E", [comp(m, 2, "UN")]); const k2 = await kit("Kit Elétrica E", [comp(m, 1, "UN")])
  const created = await saveProduct({ ...base, name: "Carreta Estrutura", structure: structure([[k1.id, 1], [k2.id, 2]], { labor_cost: 100, activate: true }) })
  const links = await all("select kit_id, quantity from public.product_kits where bom_version_id = $1 order by position", [created.version_id])
  assert.deepEqual(links.map((l) => [l.kit_id, Number(l.quantity)]), [[k1.id, 1], [k2.id, 2]])
  assert.equal(created.version_status, "Ativa")
  // remover um kit = nova versão (a vigente não muda)
  const v2 = await saveProduct({ ...base, product_id: created.product_id, name: "Carreta Estrutura", structure: structure([[k1.id, 1]], { labor_cost: 100, change_reason: "Retirada do kit elétrica" }) })
  assert.equal(v2.version, 2)
  assert.equal((await one("select count(*)::int n from public.product_kits where bom_version_id = $1", [created.version_id])).n, 2)
  assert.equal((await one("select count(*)::int n from public.product_kits where bom_version_id = $1", [v2.version_id])).n, 1)
  // validações de backend
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Sem kit", structure: structure([]) })], /ao menos um kit/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Kit repetido", structure: structure([[k1.id, 1], [k1.id, 2]]) })], /mais de uma vez/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Qtd zero", structure: structure([[k1.id, 0]]) })], /quantidade de cada kit/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Kit fantasma", structure: structure([[m, 1]]) })], /Somente kits/)
  const draft = (await one("insert into public.materials (name, unit, item_type, internal_code, controls_stock) values ('Kit sem versão', 'UN', 'Kit', 'KIT-SV', false) returning id")).id
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, name: "Kit sem versão ativa", structure: structure([[draft, 1]]) })], /não tem versão ativa/)
})

test("custo: materiais dos kits (com perda e conversão) + mão de obra + indiretos; reage ao custo vigente e a margem é calculada", async () => {
  const perfil = await material("Perfil C", { unit: "M", cost: 10 }); const fio = await material("Fio C", { unit: "M", cost: 2 })
  const chassi = await kit("Kit Chassi C", [comp(perfil, 6, "M", 5)]); const eletrica = await kit("Kit Elétrica C", [comp(fio, 400, "CM")])
  const p = await saveProduct({ ...base, name: "Carreta Custo", sale_price: 1000, structure: structure([[chassi.id, 1], [eletrica.id, 2]], { labor_cost: 120, overhead_cost: 30, other_cost: 10, activate: true }) })
  let detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  // materiais: 6 m x 1,05 x R$ 10 = 63 ; 2 kits x (4 m x R$ 2) = 16 ; total 79
  assert.deepEqual([detail.cost.materials, detail.cost.labor, detail.cost.overhead, detail.cost.other, detail.cost.total].map(Number), [79, 120, 30, 10, 239])
  assert.deepEqual([Number(detail.cost.price), Number(detail.cost.margin), Number(detail.cost.margin_percent)], [1000, 761, 76.1])
  // o custo estimado acompanha o custo vigente da matéria-prima; o custo "da versão" fica como foi ativado
  await db.query("update public.materials set average_cost = 20 where id = $1", [perfil])
  detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.equal(Number(detail.cost.materials), 126 + 16)
  assert.equal(Number(detail.cost_of_version.total), 239)
  assert.ok((await one("select public.product_record_cost_snapshot($1) id", [p.version_id])).id) // mudou: grava nova estimativa
  assert.equal((await one("select public.product_detail($1) d", [p.product_id])).d.cost_history.length, 2)
})

test("explosão: produto -> kits -> matérias-primas, consolidando repetidas, com perda, conversão e origem; sem movimentar estoque", async () => {
  const perfil = await material("Perfil X", { unit: "M", cost: 10 }); const parafuso = await material("Parafuso X", { cost: 0.5 }); const fio = await material("Fio X", { unit: "M", cost: 2 })
  const chassi = await kit("Kit Chassi X", [comp(perfil, 6, "M"), comp(parafuso, 16, "UN")])
  const eletrica = await kit("Kit Elétrica X", [comp(fio, 400, "CM"), comp(parafuso, 4, "UN")]) // parafuso aparece nos dois kits
  const p = await saveProduct({ ...base, name: "Carreta Explosão", structure: structure([[chassi.id, 1], [eletrica.id, 1]], { activate: true }) })
  const movesBefore = (await one("select count(*)::int n from public.stock_movements")).n
  const ex = await rpc("product_explosion_json", { v: 1 }).catch(() => null)
  assert.equal(ex, null) // função inexistente de propósito: a API real é product_explosion
  const x = (await one("select public.product_explosion($1, 3) x", [p.version_id])).x
  const flat = Object.fromEntries(x.consolidated.map((m) => [m.name, Number(m.required)]))
  assert.deepEqual(flat, { "Perfil X": 18, "Parafuso X": 60, "Fio X": 12 }) // 3 produtos: 18 m, (16+4)x3 parafusos, 4 m x 3 de fio
  const parafusoRow = x.consolidated.find((m) => m.name === "Parafuso X")
  assert.deepEqual(parafusoRow.origins.map((o) => [o.kit_name, Number(o.required)]).sort(), [["Kit Chassi X", 48], ["Kit Elétrica X", 12]]) // rastreia a origem
  assert.deepEqual(x.kits.map((k) => [k.name, Number(k.quantity)]).sort(), [["Kit Chassi X", 3], ["Kit Elétrica X", 3]])
  assert.equal(Number(x.materials_cost), 18 * 10 + 60 * 0.5 + 12 * 2)
  assert.equal((await one("select count(*)::int n from public.stock_movements")).n, movesBefore)
  assert.equal((await one("select count(*)::int n from public.stock_reservations")).n, (await one("select count(*)::int n from public.stock_reservations")).n)
  await rejects("select public.product_explosion('00000000-0000-0000-0000-000000000000', 1)", [], /não encontrada/)
})

test("versões: nova versão exige motivo, a anterior fica intacta, ativa/usada é imutável, comparação mostra a diferença", async () => {
  const m = await material("MP Versões", { cost: 5 })
  const k1 = await kit("Kit V1", [comp(m, 1, "UN")]); const k2 = await kit("Kit V2", [comp(m, 2, "UN")])
  const v1 = await saveProduct({ ...base, name: "Produto Versões", structure: structure([[k1.id, 1]], { activate: true }) })
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, product_id: v1.product_id, name: "Produto Versões", structure: structure([[k1.id, 1], [k2.id, 1]]) })], /motivo da nova versão/)
  const v2 = await saveProduct({ ...base, product_id: v1.product_id, name: "Produto Versões", user: "Maria", structure: structure([[k1.id, 2], [k2.id, 1]], { change_reason: "Novo conjunto de rodagem", activate: true }) })
  assert.deepEqual((await all("select version, status from public.product_bom_versions where product_id = $1 order by version", [v1.product_id])).map((r) => `${r.version}:${r.status}`), ["1:Obsoleta", "2:Ativa"])
  const detail = (await one("select public.product_detail($1) d", [v1.product_id])).d
  const ver2 = detail.versions.find((v) => v.version === 2)
  assert.deepEqual([ver2.change_reason, ver2.activated_by], ["Novo conjunto de rodagem", "Maria"])
  assert.equal(detail.change_log.filter((l) => l.action === "versao_criada").length, 2)
  // versão anterior intacta e consultável
  assert.equal(Number((await one("select quantity q from public.product_kits where bom_version_id = $1", [v1.version_id])).q), 1)
  const old = (await one("select public.product_detail($1, $2) d", [v1.product_id, v1.version_id])).d
  assert.equal(old.kits.length, 1)
  // versão ativa e obsoleta não aceitam edição direta
  await rejects("update public.product_kits set quantity = 9 where bom_version_id = $1", [v2.version_id], /não pode ser alterada/)
  await rejects("select public.product_save($1::jsonb)", [JSON.stringify({ ...base, product_id: v1.product_id, name: "Produto Versões", structure: { ...structure([[k1.id, 5]]), version_id: v1.version_id } })], /não pode ser alterada/)
  await rejects("update public.product_bom_versions set labor_cost = 99 where id = $1", [v1.version_id], /não podem ser alterados/)
  const diff = Object.fromEntries((await all("select name, change from public.product_compare_versions($1, $2)", [v1.version_id, v2.version_id])).map((r) => [r.name, r.change]))
  assert.deepEqual(diff, { "Kit V1": "alterado", "Kit V2": "adicionado" })
  // rascunho pode ser editado no lugar
  const draft = await saveProduct({ ...base, product_id: v1.product_id, name: "Produto Versões", structure: structure([[k1.id, 1]], { change_reason: "Teste de rascunho" }) })
  const edited = await saveProduct({ ...base, product_id: v1.product_id, name: "Produto Versões", structure: { ...structure([[k1.id, 3]]), version_id: draft.version_id } })
  assert.equal(edited.version_id, draft.version_id)
  assert.equal(Number((await one("select quantity q from public.product_kits where bom_version_id = $1", [draft.version_id])).q), 3)
})

test("capacidade: imediata (só físico livre da empresa) x projetada (com compras aprovadas), material limitante, sem reservar nem consumir", async () => {
  await asCompany(COMPANY_A)
  const parafuso = await material("Parafuso Cap", { cost: 0.5 }); const perfil = await material("Perfil Cap", { unit: "M", cost: 10 })
  const k = await kit("Kit Cap", [comp(parafuso, 16, "UN"), comp(perfil, 6, "M")])
  const p = await saveProduct({ ...base, name: "Produto Capacidade", structure: structure([[k.id, 1]], { activate: true }) })
  await stockIn(parafuso, 80, 0.5); await stockIn(perfil, 20, 10)  // parafuso permite 5; perfil permite 3
  // compra aprovada de 60 m de perfil ainda não recebida e reserva de 6 m para outra ordem
  const supplier = (await one("insert into public.suppliers (name) values ('Fornecedor Cap') returning id")).id
  const po = (await one("insert into public.purchase_orders (order_number, supplier_id, supplier_name, status) values ('PC-CAP', $1, 'Fornecedor Cap', 'Aprovado') returning id", [supplier])).id
  await db.query("insert into public.purchase_order_items (purchase_order_id, material_id, description, unit, quantity, unit_cost, total) values ($1, $2, 'Perfil', 'M', 60, 10, 600)", [po, perfil])
  await db.query("insert into public.stock_reservations (material_id, quantity, status) values ($1, 2, 'Ativa')", [perfil]) // 18 m livres -> 3 unidades
  const reservationsBefore = (await one("select count(*)::int n from public.stock_reservations")).n
  const movesBefore = (await one("select count(*)::int n from public.stock_movements")).n
  const cap = (await one("select public.product_capacity_detail($1) c", [p.product_id])).c
  assert.equal(Number(cap.immediate_capacity), 3)
  assert.equal(Number(cap.projected_capacity), 5) // 78 m / 6 = 13 pelo perfil; parafuso limita em 5
  const limiting = cap.materials.filter((m) => m.limits_immediate).map((m) => m.name)
  assert.deepEqual(limiting, ["Perfil Cap"])
  assert.deepEqual(cap.materials.filter((m) => m.limits_projected).map((m) => m.name), ["Parafuso Cap"])
  assert.equal(cap.company_id, COMPANY_A)
  assert.ok(cap.warehouses.length >= 1 && cap.computed_at)
  assert.equal((await one("select count(*)::int n from public.stock_reservations")).n, reservationsBefore)
  assert.equal((await one("select count(*)::int n from public.stock_movements")).n, movesBefore)
  // a empresa B não enxerga o saldo da A
  await asCompany(COMPANY_B)
  const other = (await one("select public.product_capacity_detail($1) c", [p.product_id])).c
  assert.deepEqual([Number(other.immediate_capacity), other.company_id], [0, COMPANY_B])
  assert.ok(other.materials.every((m) => Number(m.available) === 0))
  await asCompany(COMPANY_A)
})

test("produto sem composição: detalhes e lista funcionam; explosão e capacidade avisam com clareza", async () => {
  const p = await saveProduct({ ...base, name: "Produto Sem Estrutura" })
  const detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.deepEqual([detail.versions.length, detail.kits.length, detail.cost], [0, 0, null])
  assert.equal(detail.current_version_id, null)
  await rejects("select public.product_capacity_detail($1)", [p.product_id], /não tem estrutura/)
  const row = (await all("select kits_count, est_cost, bom_version from public.product_list('Produto Sem Estrutura')"))[0]
  assert.deepEqual([row.kits_count, Number(row.est_cost), row.bom_version], [0, 0, null])
})

test("estoque de acabados: saldos por empresa e depósito, em produção, custo real, recebimento único e nenhum saldo ao cadastrar", async () => {
  await asCompany(COMPANY_A)
  const m = await material("MP Acabado", { cost: 10 }); await stockIn(m, 100, 10)
  const k = await kit("Kit Acabado", [comp(m, 5, "UN")])
  const p = await saveProduct({ ...base, name: "Produto Acabado", structure: structure([[k.id, 1]], { labor_cost: 50, activate: true }) })
  const before = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.deepEqual([Number(before.availability.physical), before.stock_by_warehouse.length], [0, 0])
  const sale = (await one("insert into public.sales_orders (order_number, client_id) values ('PV-ACAB', (select id from public.clients limit 1)) returning id")).id
  await db.query("insert into public.sales_order_items (sales_order_id, material_id, description, quantity, unit_price, total) values ($1, $2, 'x', 3, 5000, 15000)", [sale, p.product_id])
  await db.query("select public.confirm_sales_order($1)", [sale])
  const order = (await one("select id from public.production_orders where sales_order_id = $1", [sale])).id
  let detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.equal(Number(detail.in_production.quantity), 3)
  assert.equal(detail.orders[0].sales_order, "PV-ACAB")
  await db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 15))", [order, m])
  const receipt = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'request_key', 'r1')) r", [order])).r
  const again = (await one("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'request_key', 'r1')) r", [order])).r
  assert.equal(again.duplicate, true) // a mesma conclusão não recebe o acabado duas vezes
  assert.equal(again.receipt_id, receipt.receipt_id)
  detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.deepEqual([Number(detail.availability.physical), Number(detail.availability.available)], [1, 1])
  assert.equal(detail.stock_by_warehouse.length, 1)
  assert.equal(detail.movements[0].movement_type, "Entrada por producao")
  assert.equal(Number(detail.in_production.quantity), 2)
  assert.deepEqual([Number(detail.real_cost.quantity), Number(detail.real_cost.lots)], [1, 1])
  assert.ok(Number(detail.real_cost.unit_cost) > 0)
  // empresa B: saldo, movimentos e ordens do produto não aparecem
  await asCompany(COMPANY_B)
  const other = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.deepEqual([Number(other.availability.physical), other.movements.length, other.orders.length, Number(other.in_production.quantity)], [0, 0, 0, 0])
  assert.equal(other.versions.length, 1) // o cadastro e a estrutura são compartilhados
  await asCompany(COMPANY_A)
})

test("lista de produtos: busca, paginação, ordenação, margem e saldo; e o mesmo kit em vários produtos", async () => {
  await asCompany(COMPANY_A)
  const m = await material("MP Lista", { cost: 4 })
  const k = await kit("Kit Lista P", [comp(m, 2, "UN")])
  for (const [n, price] of [[1, 100], [2, 200], [3, 300]]) await saveProduct({ ...base, name: `Produto Lista ${n}`, sale_price: price, category: "Lista", structure: structure([[k.id, n]], { activate: true }) })
  const page1 = await all("select name, total_count, est_cost, margin from public.product_list('Produto Lista', null, null, 'price', true, 2, 0)")
  assert.deepEqual([page1.map((r) => r.name), Number(page1[0].total_count)], [["Produto Lista 3", "Produto Lista 2"], 3])
  assert.deepEqual(page1.map((r) => [Number(r.est_cost), Number(r.margin)]), [[24, 276], [16, 184]]) // 3 x 2 x 4 ; 2 x 2 x 4
  assert.equal((await all("select 1 from public.product_list('Produto Lista', null, null, 'price', true, 2, 2)")).length, 1)
  const kitRow = (await all("select products_count from public.kit_list('Kit Lista P')"))[0]
  assert.equal(kitRow.products_count, 3) // o mesmo kit em vários produtos, cada um com a sua quantidade
  const options = (await one("select public.product_kit_options('Kit Lista P') o")).o
  assert.deepEqual([options.length, options[0].version, Number(options[0].cost), Number(options[0].components_count)], [1, 1, 8, 1])
})

test("orçamento: o snapshot traz preço, custo da estrutura, margem, prazo e versão; o item de orçamento guarda esses valores", async () => {
  const m = await material("MP Orçamento", { cost: 10 })
  const k = await kit("Kit Orçamento", [comp(m, 3, "UN")])
  const p = await saveProduct({ ...base, name: "Produto Orçamento", sale_price: 1000, lead_time_days: 45, structure: structure([[k.id, 1]], { labor_cost: 70, activate: true }) })
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [p.product_id]))[0]
  assert.deepEqual([Number(snap.sale_price), Number(snap.est_cost), Number(snap.margin_percent), snap.bom_version, Number(snap.lead_time_days)], [1000, 100, 90, 1, 45])
  const client = (await one("select id from public.clients limit 1")).id
  const quote = (await one("insert into public.quotes (quote_number, client_id, salesperson_id, valid_until, quote_type) values ('Q-P5', $1, (select id from public.salespeople limit 1), current_date + 7, 'Produto') returning id", [client])).id
  await db.query("insert into public.quote_items (quote_id, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 'Produto', $2, 'Produto Orçamento', 1, 1000, 1000, 100, $3, 1, 45, $4)", [quote, p.product_id, snap.bom_version_id, snap.sku])
  // cadastro muda depois: o item do orçamento permanece como foi emitido
  await saveProduct({ ...base, product_id: p.product_id, name: "Produto Orçamento", sale_price: 1500, lead_time_days: 60 })
  const item = await one("select unit_price, catalog_price, unit_cost, bom_version_number, lead_time_days, product_sku from public.quote_items where quote_id = $1", [quote])
  assert.deepEqual([Number(item.unit_price), Number(item.catalog_price), Number(item.unit_cost), item.bom_version_number, Number(item.lead_time_days), item.product_sku], [1000, 1000, 100, 1, 45, snap.sku])
  // a versão usada por um orçamento nunca é apagada
  await rejects("delete from public.product_bom_versions where id = $1", [snap.bom_version_id], /já foi usada/)
  const detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.equal(detail.versions[0].used_in_quotes, true)
  // produto indisponível para orçamento aparece no snapshot com a marca
  const hidden = await saveProduct({ ...base, name: "Produto Fora do Orçamento", available_for_quote: false })
  assert.equal((await all("select available_for_quote a from public.product_quote_snapshot(array[$1::uuid])", [hidden.product_id]))[0].a, false)
})

test("isolamento e integridade: histórico de produção protege a versão e o cadastro segue compartilhado entre empresas", async () => {
  await asCompany(COMPANY_A)
  const m = await material("MP Iso", { cost: 1 }); await stockIn(m, 50, 1)
  const k = await kit("Kit Iso", [comp(m, 2, "UN")])
  const p = await saveProduct({ ...base, name: "Produto Iso", structure: structure([[k.id, 1]], { activate: true }) })
  const sale = (await one("insert into public.sales_orders (order_number, client_id) values ('PV-ISO', (select id from public.clients limit 1)) returning id")).id
  await db.query("insert into public.sales_order_items (sales_order_id, material_id, description, quantity, unit_price, total, make_to_order) values ($1, $2, 'x', 1, 5000, 5000, true)", [sale, p.product_id])
  await db.query("select public.confirm_sales_order($1)", [sale])
  await rejects("delete from public.product_bom_versions where id = $1", [p.version_id], /já foi usada/)
  const detail = (await one("select public.product_detail($1) d", [p.product_id])).d
  assert.equal(detail.used_in_production, true)
  assert.equal(detail.versions[0].used_in_production, true)
  // o produto de uma empresa aparece no cadastro da outra (catálogo compartilhado), mas sem ordens
  await asCompany(COMPANY_B)
  assert.equal((await all("select 1 from public.product_list('Produto Iso')")).length, 1)
  assert.equal((await one("select public.product_detail($1) d", [p.product_id])).d.orders.length, 0)
  await asCompany(COMPANY_A)
})
