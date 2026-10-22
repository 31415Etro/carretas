// Etapa 4: kits e composições, no Postgres local descartável (PGlite). Usa as funções SQL reais dos scripts 217 a 221.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"ana@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const save = async (payload) => (await one("select public.kit_save($1::jsonb) r", [JSON.stringify(payload)])).r

async function material(name, { unit = "UN", cost = 0, sku } = {}) {
  const code = sku || (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, code, cost])).id
}
const comp = (component_id, quantity, unit, loss_percent = 0) => ({ component_id, quantity, unit, loss_percent })

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql"] })
  await db.exec(`select public.sales_settings_update('{"require_documentation_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)  // estas suítes testam outras regras; a liberação por documentação tem a suíte etapa7
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
})

test("1-3: cria kit com SKU KIT- automático, vincula matérias-primas por ID real e SKU manual repetido é recusado", async () => {
  const perfil = await material("Perfil K1", { unit: "M", cost: 10 })
  const parafuso = await material("Parafuso K1", { cost: 0.5 })
  const before = (await one("select count(*)::int n from public.materials")).n
  const result = await save({ name: "Kit Chassi FZ 1E", auto_sku: true, category: "Chassi", description: "Estrutura do chassi", status: "Ativo", components: [comp(perfil, 6, "M", 5), comp(parafuso, 16, "UN")], activate: true })
  assert.match(result.sku, /^KIT-\d{6}$/)
  assert.equal(result.created, true)
  assert.equal(result.version_status, "Ativa")
  assert.equal((await one("select count(*)::int n from public.materials")).n, before + 1) // só o kit: nenhuma matéria-prima nova foi criada pela vinculação
  const links = await all("select component_id from public.kit_components where kit_version_id = $1 order by position", [result.version_id])
  assert.deepEqual(links.map((l) => l.component_id), [perfil, parafuso])
  const kit = await one("select item_type, controls_stock, allows_sale, status from public.materials where id = $1", [result.kit_id])
  assert.deepEqual([kit.item_type, kit.controls_stock, kit.allows_sale, kit.status], ["Kit", false, false, "Ativo"])
  // SKU único no catálogo inteiro
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ name: "Kit Repetido", auto_sku: false, sku: result.sku.toLowerCase(), components: [comp(perfil, 1, "M")] })], /já existe no catálogo/)
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ name: "ab", components: [comp(perfil, 1, "M")] })], /nome do kit/)
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ name: "Kit sem componente", components: [] })], /ao menos uma matéria-prima/)
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ name: "Kit duplicado", components: [comp(perfil, 1, "M"), comp(perfil, 2, "M")] })], /mais de uma vez/)
})

test("4-6: editar quantidade e remover componente em rascunho; custo calculado com perda; versão ativa não muda", async () => {
  const aco = await material("Aço K2", { unit: "KG", cost: 8 })
  const tinta = await material("Tinta K2", { unit: "L", cost: 40 })
  const first = await save({ name: "Kit Pintura", components: [comp(aco, 10, "KG", 10), comp(tinta, 2, "L")], activate: true })
  const cost1 = Number((await one("select public.kit_version_cost($1) c", [first.version_id])).c)
  assert.equal(cost1, 10 * 1.1 * 8 + 2 * 40) // 88 + 80 = 168
  // alterar composição de kit com versão ativa cria NOVA versão em rascunho (a ativa continua igual)
  const second = await save({ kit_id: first.kit_id, name: "Kit Pintura", components: [comp(aco, 12, "KG", 10), comp(tinta, 2, "L")] })
  assert.notEqual(second.version_id, first.version_id)
  assert.equal(second.version_status, "Rascunho")
  assert.equal(Number((await one("select quantity q from public.kit_components where kit_version_id = $1 and component_id = $2", [first.version_id, aco])).q), 10)
  // editar o rascunho: mudar quantidade e remover a tinta
  const edited = await save({ kit_id: first.kit_id, name: "Kit Pintura", version_id: second.version_id, components: [comp(aco, 15, "KG", 10)] })
  assert.equal(edited.version_id, second.version_id)
  assert.deepEqual((await all("select component_id, quantity from public.kit_components where kit_version_id = $1", [second.version_id])).map((r) => [r.component_id, Number(r.quantity)]), [[aco, 15]])
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [second.version_id])).c), 15 * 1.1 * 8)
  // versão ativa e obsoleta não aceitam edição direta
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ kit_id: first.kit_id, name: "Kit Pintura", version_id: first.version_id, components: [comp(aco, 99, "KG")] })], /não pode ser alterada/)
  await db.query("select public.kit_activate_version($1)", [second.version_id])
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ kit_id: first.kit_id, name: "Kit Pintura", version_id: first.version_id, components: [comp(aco, 99, "KG")] })], /obsoleta/)
})

test("7: conversão de unidades (cm -> m, barra de 6 m do material, unidade impossível recusada) no custo e na explosão", async () => {
  const perfil = await material("Perfil K3", { unit: "M", cost: 10 })
  await db.query("insert into public.material_unit_conversions (material_id, unit, factor_to_base) values ($1, 'BARRA', 6)", [perfil])
  const r = await save({ name: "Kit Conversão", components: [comp(perfil, 150, "CM")], activate: true })
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [r.version_id])).c), 15) // 150 cm = 1,5 m x R$ 10
  const barra = await save({ name: "Kit Barra", components: [comp(perfil, 2, "BARRA")], activate: true })
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [barra.version_id])).c), 120) // 2 barras x 6 m x R$ 10
  assert.equal(Number((await one("select public.convert_quantity($1, 12, 'M', 'BARRA') q", [perfil])).q), 2)
  await rejects("select public.kit_save($1::jsonb)", [JSON.stringify({ name: "Kit Inválido", components: [comp(perfil, 1, "KG")] })], /Não há conversão/)
  // a necessidade que vai para a produção sai na unidade do ESTOQUE do material (m), já com a conversão
  const need = await one("select material_id, required_quantity, unit from public.explode_kit_version($1, 3)", [barra.version_id])
  assert.deepEqual([need.material_id, Number(need.required_quantity), need.unit], [perfil, 36, "M"])
})

test("8-9: nova versão preserva a anterior; comparação mostra adicionado, removido e alterado; histórico guarda quem e o quê", async () => {
  const a = await material("Mat A K4", { cost: 1 }); const b = await material("Mat B K4", { cost: 2 }); const c = await material("Mat C K4", { cost: 3 })
  await asCompany(COMPANY_A)
  const v1 = await save({ name: "Kit Versões", components: [comp(a, 4, "UN"), comp(b, 2, "UN")], activate: true })
  const v2 = await save({ kit_id: v1.kit_id, name: "Kit Versões", components: [comp(a, 6, "UN"), comp(c, 1, "UN")], activate: true })
  const states = (await all("select version, status from public.kit_versions where kit_id = $1 order by version", [v1.kit_id])).map((r) => `${r.version}:${r.status}`)
  assert.deepEqual(states, ["1:Obsoleta", "2:Ativa"])
  // a versão 1 continua íntegra e consultável
  const old = await all("select component_id, quantity from public.kit_components where kit_version_id = $1 order by position", [v1.version_id])
  assert.deepEqual(old.map((r) => [r.component_id, Number(r.quantity)]), [[a, 4], [b, 2]])
  const diff = Object.fromEntries((await all("select material_id, change from public.kit_compare_versions($1, $2)", [v1.version_id, v2.version_id])).map((r) => [r.material_id, r.change]))
  assert.deepEqual([diff[a], diff[b], diff[c]], ["alterado", "removido", "adicionado"])
  const detail = (await one("select public.kit_detail($1) d", [v1.kit_id])).d
  assert.equal(detail.versions.length, 2)
  assert.equal(detail.current_version_id, v2.version_id)
  assert.equal(detail.components.length, 2) // componentes da versão vigente (2)
  const asOld = (await one("select public.kit_detail($1, $2) d", [v1.kit_id, v1.version_id])).d
  assert.deepEqual(asOld.components.map((x) => x.component_id).sort(), [a, b].sort())
  const log = detail.change_log.map((l) => l.action)
  for (const action of ["versao_criada", "versao_ativada", "versao_obsoleta", "componente_adicionado"]) assert.ok(log.includes(action), `histórico sem ${action}`)
  assert.ok(detail.change_log.every((l) => l.changed_by === "ana@teste.com" || l.changed_by === "sistema"))
  assert.ok(detail.change_log.some((l) => l.changed_by === "ana@teste.com")) // o responsável vem do usuário da requisição
  // alteração do cadastro também fica registrada
  await save({ kit_id: v1.kit_id, name: "Kit Versões Renomeado", category: "Novo" })
  assert.ok((await one("select public.kit_detail($1) d", [v1.kit_id])).d.change_log.some((l) => l.action === "cadastro_alterado"))
})

test("custo acompanha o custo vigente da matéria-prima e o histórico de estimativas só registra quando muda", async () => {
  const m = await material("Mat K5", { cost: 10 })
  const kit = await save({ name: "Kit Custo K5", components: [comp(m, 3, "UN")], activate: true })
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [kit.version_id])).c), 30)
  assert.equal((await one("select public.kit_record_cost_snapshot($1) id", [kit.version_id])).id, null) // sem mudança: não grava de novo
  await db.query("update public.materials set average_cost = 12 where id = $1", [m])
  assert.equal(Number((await one("select public.kit_version_cost($1) c", [kit.version_id])).c), 36) // estimativa atual já reflete o novo custo
  assert.ok((await one("select public.kit_record_cost_snapshot($1) id", [kit.version_id])).id)
  const history = (await one("select public.kit_detail($1) d", [kit.kit_id])).d.cost_history
  assert.deepEqual(history.map((h) => Number(h.total_cost)), [36, 30])
})

test("10: um kit usado por vários produtos com quantidades diferentes; produtos vinculados vêm do banco; kit inativo não vincula", async () => {
  const m = await material("Mat K6", { cost: 5 })
  const kit = await save({ name: "Kit Compartilhado", components: [comp(m, 2, "UN")], activate: true })
  const product = async (name, quantity) => {
    const p = (await one("insert into public.materials (name, unit, item_type, internal_code, sale_price) values ($1, 'UN', 'Produto', $2, 1000) returning id", [name, (await one("select public.next_item_sku('Produto') s")).s])).id
    const bom = (await one("insert into public.product_bom_versions (product_id, version) values ($1, 1) returning id", [p])).id
    await db.query("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, $3)", [bom, kit.kit_id, quantity])
    await db.query("select public.product_bom_activate_version($1)", [bom])
    return p
  }
  const p1 = await product("Carreta Modelo 1", 1)
  const p2 = await product("Carreta Modelo 2", 2)
  const detail = (await one("select public.kit_detail($1) d", [kit.kit_id])).d
  assert.deepEqual(detail.products.map((p) => [p.name, Number(p.quantity)]).sort(), [["Carreta Modelo 1", 1], ["Carreta Modelo 2", 2]])
  assert.ok(detail.products.every((p) => p.follows_active === true)) // sem versão fixada: acompanha a vigente
  const row = (await all("select products_count from public.kit_list('Kit Compartilhado')"))[0]
  assert.equal(row.products_count, 2)
  // custo do produto usa a quantidade do kit: modelo 2 usa 2 kits
  const bom2 = (await one("select id from public.product_bom_versions where product_id = $1", [p2])).id
  assert.equal(Number((await one("select materials_cost c from public.product_bom_cost($1)", [bom2])).c), 2 * 2 * 5)
  // kit inativo não entra em estrutura nova
  await save({ kit_id: kit.kit_id, name: "Kit Compartilhado", status: "Inativo" })
  const p3 = (await one("insert into public.materials (name, unit, item_type, internal_code, sale_price) values ('Carreta 3', 'UN', 'Produto', 'PRD-X3', 10) returning id")).id
  const bom3 = (await one("insert into public.product_bom_versions (product_id, version) values ($1, 1) returning id", [p3])).id
  await rejects("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, 1)", [bom3, kit.kit_id], /inativo/)
  assert.ok(p1)
})

test("11: o catálogo do kit é o mesmo para as empresas, mas disponibilidade e custo de estoque vêm da empresa em uso", async () => {
  await asCompany(COMPANY_A)
  const m = await material("Mat K7", { cost: 4 })
  await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', 25, 'unit_cost', 4))`, [m])
  const kit = await save({ name: "Kit Empresas", components: [comp(m, 5, "UN")], activate: true })
  const asA = (await one("select public.kit_detail($1) d", [kit.kit_id])).d
  assert.equal(Number(asA.components[0].available), 25)
  await asCompany(COMPANY_B)
  const asB = (await one("select public.kit_detail($1) d", [kit.kit_id])).d
  assert.equal(asB.kit.name, "Kit Empresas")           // mesmo cadastro
  assert.equal(Number(asB.components[0].available), 0) // estoque da outra empresa não aparece
  assert.equal(Number(asB.cost), 20)                   // custo da estrutura é do catálogo
  const options = (await one("select public.kit_material_options('Mat K7') o", [])).o
  assert.equal(Number(options[0].available), 0)
  await asCompany(COMPANY_A)
  assert.equal(Number((await one("select public.kit_material_options('Mat K7') o")).o[0].available), 25)
})

test("12: ciclos de composição continuam bloqueados (multinível) e a explosão expande subkits", async () => {
  const m = await material("Mat K8", { cost: 1 })
  const inner = await save({ name: "Kit Interno", components: [comp(m, 2, "UN")], activate: true })
  const outer = (await one("insert into public.materials (name, unit, item_type, internal_code, controls_stock) values ('Kit Externo', 'UN', 'Kit', 'KIT-EXT', false) returning id")).id
  const outerVersion = (await one("insert into public.kit_versions (kit_id, version, composition_kind) values ($1, 1, 'multinivel') returning id", [outer])).id
  await db.query("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 3, 'UN')", [outerVersion, inner.kit_id])
  await db.query("select public.kit_activate_version($1)", [outerVersion])
  assert.equal(Number((await one("select required_quantity q from public.explode_kit_version($1, 1)", [outerVersion])).q), 6)
  const innerDraft = (await one("select public.kit_new_version($1) id", [inner.kit_id])).id
  await db.query("update public.kit_versions set composition_kind = 'multinivel' where id = $1", [innerDraft])
  await rejects("insert into public.kit_components (kit_version_id, component_id, quantity, unit) values ($1, $2, 1, 'UN')", [innerDraft, outer], /circular/)
})

test("13: cadastrar, editar e ativar kit não gera movimentação nem saldo; o kit lógico não aceita movimento", async () => {
  const m = await material("Mat K9", { cost: 2 })
  const before = { moves: (await one("select count(*)::int n from public.stock_movements")).n, balances: (await one("select count(*)::int n from public.stock_balances")).n, reservations: (await one("select count(*)::int n from public.stock_reservations")).n }
  const kit = await save({ name: "Kit Sem Estoque", components: [comp(m, 1, "UN")], activate: true })
  await save({ kit_id: kit.kit_id, name: "Kit Sem Estoque", components: [comp(m, 2, "UN")] })
  await save({ kit_id: kit.kit_id, name: "Kit Sem Estoque Renomeado" })
  const after = { moves: (await one("select count(*)::int n from public.stock_movements")).n, balances: (await one("select count(*)::int n from public.stock_balances")).n, reservations: (await one("select count(*)::int n from public.stock_reservations")).n }
  assert.deepEqual(after, before)
  await rejects("select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', 1))", [kit.kit_id], /não controla estoque/)
})

test("14: integração real com as funções existentes: lista paginada e ordenada, produto -> venda -> ordem usa a versão congelada e protege versão usada", async () => {
  const m = await material("Mat K10", { unit: "M", cost: 7 }); await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', 100, 'unit_cost', 7))`, [m])
  await db.query("insert into public.material_unit_conversions (material_id, unit, factor_to_base) values ($1, 'BARRA', 6)", [m])
  const kit = await save({ name: "Kit Produção Z", components: [comp(m, 1, "BARRA")], activate: true })
  const p = (await one("insert into public.materials (name, unit, item_type, internal_code, sale_price) values ('Produto Z', 'UN', 'Produto', 'PRD-Z1', 900) returning id")).id
  const bom = (await one("insert into public.product_bom_versions (product_id, version) values ($1, 1) returning id", [p])).id
  await db.query("insert into public.product_kits (bom_version_id, kit_id, quantity) values ($1, $2, 1)", [bom, kit.kit_id])
  await db.query("select public.product_bom_activate_version($1)", [bom])
  const client = (await one("select id from public.clients limit 1")).id
  const sale = (await one("insert into public.sales_orders (order_number, client_id) values ('PV-K', $1) returning id", [client])).id
  await db.query("insert into public.sales_order_items (sales_order_id, material_id, description, quantity, unit_price, total) values ($1, $2, 'x', 2, 900, 1800)", [sale, p])
  await db.query("select public.confirm_sales_order($1)", [sale])
  // 2 produtos x 1 barra (6 m) = 12 m reservados na unidade do estoque
  const need = await one("select sum(required_quantity) q, max(unit) u from public.production_order_materials where production_order_id = (select id from public.production_orders where sales_order_id = $1)", [sale])
  assert.deepEqual([Number(need.q), need.u], [12, "M"])
  // a versão do kit usada pela ordem não pode ser apagada nem alterada
  await rejects("delete from public.kit_versions where id = $1", [kit.version_id], /já foi usada/)
  await rejects("update public.kit_components set quantity = 9 where kit_version_id = $1", [kit.version_id], /não pode ser alterada/)
  assert.equal((await one("select public.kit_detail($1) d", [kit.kit_id])).d.used_in_production, true)
  assert.equal((await one("select public.kit_detail($1) d", [kit.kit_id])).d.versions[0].used_in_production, true)
  // lista: paginação, busca, ordenação e total
  for (const n of [1, 2, 3, 4]) await save({ name: `Kit Lista ${n}`, category: "Lista", components: [comp(m, n, "M")], activate: true })
  const page1 = await all("select name, total_count, cost from public.kit_list('Kit Lista', null, null, 'name', false, 2, 0)")
  const page2 = await all("select name from public.kit_list('Kit Lista', null, null, 'name', false, 2, 2)")
  assert.deepEqual([page1.map((r) => r.name), page2.map((r) => r.name), Number(page1[0].total_count)], [["Kit Lista 1", "Kit Lista 2"], ["Kit Lista 3", "Kit Lista 4"], 4])
  assert.deepEqual((await all("select name from public.kit_list('Kit Lista', null, null, 'cost', true, 10, 0)")).map((r) => r.name), ["Kit Lista 4", "Kit Lista 3", "Kit Lista 2", "Kit Lista 1"])
  assert.equal((await all("select 1 from public.kit_list(null, 'Inativo')")).length, 1) // o kit inativo do teste 10
  const skuSearch = await all("select name from public.kit_list($1)", [(await one("select internal_code c from public.materials where id = $1", [kit.kit_id])).c.toLowerCase()])
  assert.equal(skuSearch.length, 1)
})

test("kit legado sem versões (como o FZ1E de hoje) aparece na lista e aceita a primeira versão sem mudar o SKU", async () => {
  const legacy = (await one("insert into public.materials (name, unit, item_type, internal_code, controls_stock) values ('FZ1E', 'UN', 'Kit', 'CARFZ1CAR', false) returning id")).id
  const row = (await all("select * from public.kit_list('FZ1E')"))[0]
  assert.deepEqual([row.sku, row.version_id, row.components_count, Number(row.cost)], ["CARFZ1CAR", null, 0, 0])
  const m = await material("Mat Legado", { cost: 3 })
  const saved = await save({ kit_id: legacy, name: "FZ1E", sku: "CARFZ1CAR", components: [comp(m, 4, "UN")], activate: true })
  assert.equal(saved.created, false)
  assert.equal(saved.sku, "CARFZ1CAR")
  assert.equal(saved.version, 1)
})

test("o seletor e os componentes trazem as unidades aceitas de cada material (cadastro, específicas e padrão)", async () => {
  const perfil = await material("Perfil Unidades", { unit: "M", cost: 1 })
  await db.query("insert into public.material_unit_conversions (material_id, unit, factor_to_base) values ($1, 'BARRA', 6)", [perfil])
  const option = (await one("select public.kit_material_options('Perfil Unidades') o")).o[0]
  assert.deepEqual(option.units.map((u) => u.unit).sort(), ["BARRA", "CM", "M", "MM"])
  assert.equal(Number(option.units.find((u) => u.unit === "BARRA").factor), 6)
  const kit = await save({ name: "Kit Unidades", components: [comp(perfil, 2, "BARRA")], activate: true })
  const components = (await one("select public.kit_version_components($1) c", [kit.version_id])).c
  assert.deepEqual(components[0].units.map((u) => u.unit).sort(), ["BARRA", "CM", "M", "MM"])
  assert.equal(Number(components[0].required_with_loss), 12)
})
