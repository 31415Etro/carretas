// Etapa 8: engenharia paramétrica e configurador (modelo piloto: carreta FZ 1E, com os limites do CCT e do desenho técnico).
// Os números dos documentos entram como DADOS DE TESTE; o banco não traz nenhum parâmetro de modelo pronto.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db
let vinSeq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"eng@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const rpc = async (name, payload, ...rest) => (await one(`select public.${name}($1::jsonb${rest.map((_, i) => `, $${i + 2}`).join("")}) r`, [JSON.stringify(payload), ...rest])).r
// árvore de expressão (mesmo formato que o analisador do sistema gera)
const N = (value) => ({ n: value })
const P = (key) => ({ p: key })
const S = (value) => ({ s: value })
const OP = (op, a, b) => ({ op, a, b })
const FN = (fn, ...args) => ({ fn, args })

async function material(name, { unit = "UN", cost = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty, cost = null) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', $3::numeric))`, [id, qty, cost])

/** Produto com estrutura (kits e matérias-primas) e uma revisão de engenharia com os dados do CCT e do desenho técnico do FZ 1E. */
async function pilot(name = "FZ 1E Piloto", { price = 9000 } = {}) {
  const perfil = await material(`Perfil ${name}`, { unit: "M", cost: 10 }); const chapa = await material(`Chapa ${name}`, { cost: 100 }); const fio = await material(`Fio ${name}`, { unit: "M", cost: 2 })
  const kitChassi = (await rpc("kit_save", { name: `Kit Chassi ${name}`, components: [{ component_id: perfil, quantity: 12, unit: "M", loss_percent: 0 }, { component_id: chapa, quantity: 3, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const kitEletrica = (await rpc("kit_save", { name: `Kit Elétrica ${name}`, components: [{ component_id: fio, quantity: 4, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const product = await rpc("product_save", { name, model: "FZ 1E", sale_price: price, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: kitChassi, quantity: 1 }, { kit_id: kitEletrica, quantity: 1 }], labor_cost: 300, activate: true } })
  for (const m of [perfil, chapa, fio]) await stockIn(m, 5000, 1)
  const revision = await rpc("eng_revision_save", { product_id: product.product_id, revision: "R1", brand_model_version_code: "R/ND CARRETAS FZ 1E", cat_number: "1143/2019", cct_number: "A0.051.856", technical_responsible: "Bruno Lima Alves (CREA 2616460718)", revised_at: "2025-05-19" })
  const doc = async (kind, name, number) => (await one("select public.eng_document_add($1::jsonb, 'Eng') id", [JSON.stringify({ revision_id: revision.id, kind, name, document_number: number })])).id
  const cct = await doc("CCT", "CCT FZ 1E", "A0.051.856")
  const drawing = await doc("Desenho tecnico", "Desenho 8102.12.170-1", "8102.12.170-1")
  const cat = await doc("CAT", "CAT FZ 1E", "1143/2019")
  const param = (key, label, extra, sources) => rpc("eng_parameter_save", { revision_id: revision.id, key, label, unit: "mm", ...extra, sources }).then(() => null).catch((e) => { throw e })
  const save = async (key, label, extra, sources) => (await one("select public.eng_parameter_save($1::jsonb) id", [JSON.stringify({ revision_id: revision.id, key, label, unit: "mm", ...extra, sources })])).id
  await save("comprimento", "Comprimento", { configurable: true, step: 50, default_value: 3000, integer_only: true }, [{ document_id: cct, min: 2000, max: 6000 }, { document_id: drawing, max: 6000 }])
  await save("largura", "Largura", { configurable: true, step: 50, default_value: 1500 }, [{ document_id: cct, min: 1000, max: 2000 }, { document_id: drawing, max: 2300 }])
  await save("altura", "Altura", { configurable: true, step: 50, default_value: 1000 }, [{ document_id: cct, min: 500, max: 2500 }, { document_id: drawing, max: 2200 }])
  await save("pbt", "PBT", { unit: "kg", scope: "referencia" }, [{ document_id: cct, fixed: 750 }])
  await save("tara", "Tara de referência", { unit: "kg", scope: "referencia" }, [{ document_id: cct, fixed: 200 }])
  await save("lotacao", "Lotação de referência", { unit: "kg", scope: "referencia" }, [{ document_id: cct, fixed: 550 }])
  await save("eixos", "Eixos", { unit: "un", scope: "referencia" }, [{ document_id: cct, fixed: 1 }])
  await save("balanco_traseiro", "Balanço traseiro", {}, [{ document_id: cct, min: 500, max: 2500 }])
  await save("balanco_dianteiro", "Balanço dianteiro", {}, [{ document_id: cct, min: 1500, max: 3500 }])
  await one("select public.eng_template_save($1::jsonb) id", [JSON.stringify({ revision_id: revision.id, template_key: "reboque_aberto_1_eixo", grade: "ilustrativo", source_document_id: drawing })])
  return { id: product.product_id, sku: product.sku, versionId: product.version_id, revisionId: revision.id, docs: { cct, drawing, cat }, perfil, chapa, fio, kitChassi, kitEletrica }
}
const configure = async (product, params = {}, options = {}, extra = {}) => rpc("product_configure", { product_id: product.id, params, options, ...extra })
async function validateRevision(pilotData, user = "Engenharia") {
  if ((await one("select status from public.product_engineering_revisions where id = $1", [pilotData.revisionId])).status === "Rascunho") await db.query("select public.eng_revision_submit($1::uuid)", [pilotData.revisionId])
  for (const issue of await all("select id, parameter_key from public.product_engineering_issues where revision_id = $1 and status = 'Aberta'", [pilotData.revisionId])) {
    const adopt = { largura: { adopted_min: 1000, adopted_max: 2000 }, altura: { adopted_min: 500, adopted_max: 2500 } }[issue.parameter_key]
    await db.query("select public.eng_issue_resolve($1::jsonb, $2)", [JSON.stringify({ issue_id: issue.id, resolution: "Decisão da engenharia: vale o CCT.", ...adopt }), user])
  }
  return (await one("select public.eng_revision_validate($1::uuid, $2) r", [pilotData.revisionId, user])).r
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await db.exec(`select public.sales_settings_update('{"require_documentation_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)
})

test("cadastro técnico: revisão com CCT, CAT, desenho e responsável; documentos e histórico preservados em nova revisão", async () => {
  const pr = await pilot("FZ Cadastro")
  const overview = (await one("select public.eng_product_overview($1::uuid) o", [pr.id])).o
  assert.equal(overview.revisions.length, 1)
  assert.deepEqual([overview.revisions[0].cat_number, overview.revisions[0].cct_number, overview.revisions[0].brand_model_version_code], ["1143/2019", "A0.051.856", "R/ND CARRETAS FZ 1E"])
  assert.deepEqual(overview.documents.map((d) => d.kind).sort(), ["CAT", "CCT", "Desenho tecnico"])
  assert.equal(overview.documents.find((d) => d.kind === "CCT").file_path, null) // o original ainda não foi anexado: o cadastro diz isso, não finge
  await db.query("select public.eng_document_attach($1::uuid, 'engenharia/cct.pdf')", [pr.docs.cct])
  await rejects("select public.eng_revision_save($1::jsonb)", [JSON.stringify({ product_id: pr.id, revision: "R1" })], /Já existe a revisão R1/)
  await rejects("select public.eng_document_add($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, kind: "Outro", name: " " })], /nome do documento/)
  // validada = imutável; mudança = revisão nova, com tudo copiado como rascunho e a antiga guardada
  await validateRevision(pr)
  await rejects("select public.eng_document_add($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, kind: "Outro", name: "Tarde demais" })], /não pode ser alterada/)
  await rejects("update public.product_parameters set default_value = 1 where revision_id = $1", [pr.revisionId], /não pode ser alterada/)
  await rejects("update public.product_engineering_revisions set cat_number = 'X' where id = $1", [pr.revisionId], /não pode ser alterada/)
  await rejects("delete from public.product_engineering_revisions where id = $1", [pr.revisionId], /não são apagadas/)
  const copy = (await one("select public.eng_revision_copy($1::uuid, 'R2', 'Eng') id", [pr.revisionId])).id
  const after = (await one("select public.eng_product_overview($1::uuid) o", [pr.id])).o
  assert.deepEqual(after.revisions.map((r) => [r.revision, r.status]).sort(), [["R1", "Validada"], ["R2", "Rascunho"]])
  assert.equal(after.documents.filter((d) => d.revision_id === copy).length, 3)
  assert.equal(after.parameters.filter((x) => x.revision_id === copy).length, 9)
  // publicar a R2 deixa a R1 obsoleta (guardada, nunca apagada)
  await db.query("update public.product_engineering_revisions set technical_responsible = 'Responsável R2' where id = $1", [copy])
  await db.query("select public.eng_revision_validate($1::uuid, 'Engenharia')", [copy])
  assert.deepEqual((await all("select revision, status from public.product_engineering_revisions where product_id = $1 order by revision", [pr.id])).map((r) => `${r.revision}:${r.status}`), ["R1:Obsoleta", "R2:Validada"])
  assert.equal((await one("select public.eng_current_revision($1::uuid) id", [pr.id])).id, copy)
})

test("conflito entre o desenho e o CCT: vira pendência de engenharia, não é resolvido sozinho e impede a validação", async () => {
  const pr = await pilot("FZ Conflito")
  const conflicts = await all("select parameter_key, field, values_found from public.eng_revision_conflicts($1::uuid) order by 1", [pr.revisionId])
  assert.deepEqual(conflicts.map((c) => [c.parameter_key, c.field, c.values_found.map(num)]), [["altura", "máximo", [2200, 2500]], ["largura", "máximo", [2000, 2300]]]) // comprimento concorda (6000)
  const submitted = (await one("select public.eng_revision_submit($1::uuid) r", [pr.revisionId])).r
  assert.deepEqual([submitted.status, num(submitted.issues_opened), num(submitted.open_issues)], ["Em validacao", 2, 2])
  const issues = await all("select parameter_key, kind, status, description from public.product_engineering_issues where revision_id = $1 order by parameter_key", [pr.revisionId])
  assert.deepEqual(issues.map((i) => [i.parameter_key, i.kind, i.status]), [["altura", "conflito_documental", "Aberta"], ["largura", "conflito_documental", "Aberta"]])
  assert.match(issues[1].description, /2000 x 2300/)
  // detectar de novo não duplica a pendência
  assert.equal(num((await one("select public.eng_revision_detect_issues($1::uuid) n", [pr.revisionId])).n), 0)
  // os limites que o vendedor vê (revisão não validada) são os MAIS RESTRITIVOS, e a configuração nunca é "homologada"
  const limits = Object.fromEntries((await all("select key, min_value, max_value, in_conflict, source from public.eng_effective_limits($1::uuid)", [pr.revisionId])).map((l) => [l.key, l]))
  assert.deepEqual([num(limits.largura.max_value), num(limits.altura.max_value), limits.largura.in_conflict], [2000, 2200, true])
  assert.deepEqual([num(limits.comprimento.min_value), num(limits.comprimento.max_value), limits.comprimento.in_conflict], [2000, 6000, false])
  const draft = await configure(pr, { comprimento: 3000, largura: 1500, altura: 1000 })
  assert.deepEqual([draft.status, draft.homologated], ["Requer analise tecnica", false])
  assert.ok(draft.review_reasons.some((r) => /não foi validada/.test(r)) && draft.review_reasons.some((r) => /Conflito documental em largura/.test(r)))
  // não valida enquanto houver pendência ou limite sem decisão
  await rejects("select public.eng_revision_validate($1::uuid, 'Engenharia')", [pr.revisionId], /pendência\(s\) de engenharia em aberto/)
  const [issue] = issues
  await rejects("select public.eng_issue_resolve($1::jsonb, '')", [JSON.stringify({ issue_id: (await one("select id from public.product_engineering_issues where parameter_key = 'altura'")).id, resolution: "x" })], /quem decide/)
  // a engenharia decide e registra; só então a revisão pode ser publicada
  const result = await validateRevision(pr, "Engenheiro Igor")
  assert.equal(result.status, "Validada")
  const limitsAfter = Object.fromEntries((await all("select key, min_value, max_value, source from public.eng_effective_limits($1::uuid)", [pr.revisionId])).map((l) => [l.key, l]))
  assert.deepEqual([num(limitsAfter.largura.max_value), num(limitsAfter.altura.max_value), limitsAfter.largura.source], [2000, 2500, "adotado pela engenharia"])
  assert.equal((await one("select adoption_note n from public.product_parameters where revision_id = $1 and key = 'largura'", [pr.revisionId])).n, "Decisão da engenharia: vale o CCT.")
  assert.ok(issue)
})

test("não valida sem responsável técnico, sem parâmetro configurável ou com limite configurável sem mínimo/máximo documentados", async () => {
  const pr = await pilot("FZ Validacao")
  await db.query("update public.product_engineering_revisions set technical_responsible = null where id = $1", [pr.revisionId])
  await rejects("select public.eng_revision_validate($1::uuid, 'Eng')", [pr.revisionId], /responsável técnico/)
  await db.query("update public.product_engineering_revisions set technical_responsible = 'Fulano' where id = $1", [pr.revisionId])
  await rejects("select public.eng_parameter_save($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, key: "Comprimento Livre", label: "x", sources: [] })], /check|violates/i)
  await rejects("select public.eng_parameter_save($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, key: "largura_util", label: "Largura útil", configurable: true, scope: "util", sources: [{ document_id: "00000000-0000-0000-0000-000000000000", min: 1 }] })], /documento desta revisão/)
  const only = (await one("select public.eng_parameter_save($1::jsonb) id", [JSON.stringify({ revision_id: pr.revisionId, key: "largura_util", label: "Largura útil", configurable: true, scope: "util", sources: [{ document_id: pr.docs.drawing, max: 1900 }] })])).id
  assert.ok(only)
  await db.query("select public.eng_revision_submit($1::uuid)", [pr.revisionId])
  for (const issue of await all("select id, parameter_key from public.product_engineering_issues where revision_id = $1 and status = 'Aberta'", [pr.revisionId])) {
    await db.query("select public.eng_issue_resolve($1::jsonb, 'Eng')", [JSON.stringify({ issue_id: issue.id, resolution: "ok", adopted_min: issue.parameter_key === "altura" ? 500 : 1000, adopted_max: issue.parameter_key === "altura" ? 2500 : 2000 })])
  }
  await rejects("select public.eng_revision_validate($1::uuid, 'Eng')", [pr.revisionId], /Largura útil.*mínimo e máximo documentados/)
  assert.equal((await one("select status from public.product_engineering_revisions where id = $1", [pr.revisionId])).status, "Em validacao")
})

test("configuração dentro e fora dos limites, passo, inteiro, carga e regras de compatibilidade (revisão validada)", async () => {
  const pr = await pilot("FZ Limites")
  await validateRevision(pr)
  const standard = await configure(pr)
  assert.deepEqual([standard.status, standard.homologated, standard.errors.length], ["Valida", true, 0])
  // medidas diferentes do padrão SEM fórmula aprovada: os materiais não acompanhariam a medida, então o sistema não chama de válida
  const custom = await configure(pr, { comprimento: 4000, largura: 1800, altura: 1200 })
  assert.deepEqual([custom.status, custom.errors.length, custom.warnings.some((w) => w.code === "sem_formula")], ["Requer analise tecnica", 0, true])
  const tooWide = await configure(pr, { comprimento: 3000, largura: 2300, altura: 1000 }) // 2300 é o máximo do DESENHO, acima do adotado (2000)
  assert.equal(tooWide.status, "Fora dos limites")
  assert.match(tooWide.errors[0].message, /Largura acima do máximo permitido \(2000 mm\)/)
  assert.equal((await configure(pr, { comprimento: 1900 })).status, "Fora dos limites")
  assert.equal((await configure(pr, { comprimento: 6050 })).status, "Fora dos limites")
  assert.equal((await configure(pr, { altura: 2600 })).status, "Fora dos limites")
  assert.equal((await configure(pr, { comprimento: 3025 })).status, "Invalida") // fora do passo de 50 mm
  assert.equal((await configure(pr, { comprimento: 3000.5 })).status, "Invalida") // comprimento é inteiro
  // capacidade: carga prevista acima da lotação de 550 kg
  const heavy = await configure(pr, {}, {}, { planned_load: 600 })
  assert.deepEqual([heavy.status, heavy.errors[0].code], ["Fora dos limites", "capacidade"])
  assert.equal((await configure(pr, {}, {}, { planned_load: 500 })).errors.length, 0)
  assert.equal((await configure(pr, {}, {}, { planned_load: -1 })).status, "Invalida")
  // combinação incompatível definida pela engenharia (regra cadastrada, não inventada no código)
  await db.query("update public.product_engineering_revisions set status = 'Rascunho' where id = $1", [pr.revisionId]).catch(() => null)
  const pr2 = await pilot("FZ Regras")
  await db.query("select public.eng_rule_save($1::jsonb)", [JSON.stringify({ revision_id: pr2.revisionId, code: "alto_estreito", kind: "bloqueia", expr: OP("and", OP(">", P("altura"), N(2000)), OP("<", P("largura"), N(1200))), expr_text: "altura > 2000 e largura < 1200", message: "Altura acima de 2000 mm exige largura mínima de 1200 mm." })])
  await rejects("select public.eng_rule_save($1::jsonb)", [JSON.stringify({ revision_id: pr2.revisionId, code: "ruim", kind: "bloqueia", expr: { fn: "pg_sleep", args: [N(10)] }, message: "x" })], /Função não permitida/)
  await validateRevision(pr2)
  const blocked = await configure(pr2, { comprimento: 3000, largura: 1100, altura: 2100 })
  assert.deepEqual([blocked.status, blocked.errors.map((e) => e.code)], ["Invalida", ["regra"]])
  assert.equal(blocked.errors[0].message, "Altura acima de 2000 mm exige largura mínima de 1200 mm.")
  assert.equal((await configure(pr2, { comprimento: 3000, largura: 1300, altura: 2100 })).errors.length, 0)
})

test("motor de expressões: só operações permitidas; sem código arbitrário, sem divisão por zero, sem parâmetro desconhecido", async () => {
  const ev = async (node, vars = {}) => (await one("select public.eng_eval($1::jsonb, $2::jsonb) v", [JSON.stringify(node), JSON.stringify(vars)])).v
  assert.equal(await ev(OP("+", N(2), OP("*", P("x"), N(3))), { x: 4 }), 14)
  assert.equal(await ev(FN("ceil", OP("/", P("c"), N(1000))), { c: 3500 }), 4)
  assert.equal(await ev(FN("max", N(1), P("a"), N(3)), { a: 7 }), 7)
  assert.equal(await ev({ if: OP(">", P("a"), N(1)), then: N(10), else: N(20) }, { a: 0 }), 20)
  assert.equal(await ev(OP("==", P("acabamento"), S("galvanizado")), { acabamento: "galvanizado" }), true)
  await rejects("select public.eng_eval($1::jsonb, '{}'::jsonb)", [JSON.stringify(OP("/", N(1), N(0)))], /Divisão por zero/)
  await rejects("select public.eng_eval($1::jsonb, '{}'::jsonb)", [JSON.stringify(P("y"))], /Parâmetro desconhecido/)
  await rejects("select public.eng_eval($1::jsonb, '{}'::jsonb)", [JSON.stringify(OP("||", N(1), N(2)))], /Operador não permitido/)
  await rejects("select public.eng_expr_params($1::jsonb)", [JSON.stringify({ fn: "pg_sleep", args: [N(1)] })], /Função não permitida/)
  await rejects("select public.eng_expr_params($1::jsonb)", [JSON.stringify({ sql: "drop table x" })], /desconhecido/)
  await rejects("select public.eng_expr_params($1::jsonb)", [JSON.stringify(P("Maiúscula; drop"))], /Nome de parâmetro inválido/)
  let deep = N(1)
  for (let i = 0; i < 40; i++) deep = OP("+", deep, N(1))
  await rejects("select public.eng_expr_params($1::jsonb)", [JSON.stringify(deep)], /profunda demais/)
  assert.deepEqual((await one("select public.eng_expr_params($1::jsonb) p", [JSON.stringify(OP("+", P("comprimento"), OP("*", P("largura"), P("comprimento"))))])).p.sort(), ["comprimento", "comprimento", "largura"])
})

test("fórmulas: só a aprovada vale; quantidades acompanham as medidas, com perda, arredondamento técnico e plano de corte; recálculo de kits, materiais e custo", async () => {
  const pr = await pilot("FZ Formulas")
  // fórmula de perfil: 2 longarinas do comprimento + 3 travessas da largura, em metros, perda 5%, arredondar para cima de 0,5 em 0,5 m
  const expr = OP("/", OP("+", OP("*", N(2), P("comprimento")), OP("*", N(3), P("largura"))), N(1000))
  const formula = (await one("select public.eng_formula_save($1::jsonb, 'Eng') id", [JSON.stringify({
    revision_id: pr.revisionId, kit_id: pr.kitChassi, material_id: pr.perfil, expr, expr_text: "(2*comprimento + 3*largura)/1000", unit: "M", loss_percent: 5, rounding: "cima", rounding_step: 0.5,
    cut_rule: { bar_length: 6000, kerf: 0, pieces: [{ label: "Longarina", length: P("comprimento"), count: N(2) }, { label: "Travessa", length: P("largura"), count: N(3) }] } })])).id
  await rejects("select public.eng_formula_save($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, kit_id: pr.kitEletrica, material_id: pr.perfil, expr, unit: "M" })], /não faz parte do kit/) // não é componente do kit
  await rejects("select public.eng_formula_save($1::jsonb)", [JSON.stringify({ revision_id: pr.revisionId, kit_id: pr.kitChassi, material_id: pr.chapa, expr: { fn: "sleep", args: [] }, unit: "UN" })], /Função não permitida/)
  const rascunho = await configure(pr, { comprimento: 4000, largura: 1500, altura: 1000 })
  assert.equal(num(rascunho.materials.find((m) => m.material_id === pr.perfil).quantity), 12)
  assert.deepEqual([rascunho.status, rascunho.warnings.some((w) => w.code === "formula_pendente")], ["Requer analise tecnica", true])
  await rejects("select public.eng_formula_approve($1::uuid, '')", [formula], /quem aprova/)
  await db.query("select public.eng_formula_approve($1::uuid, 'Engenheiro Igor')", [formula])
  await rejects("select public.eng_formula_approve($1::uuid, 'Engenheiro Igor')", [formula], /está aprovada/) // aprovada não é aprovada de novo nem editada
  await validateRevision(pr)
  await rejects("update public.product_formulas set expr = '{\"n\": 1}'::jsonb where id = $1", [formula], /não pode ser alterada/)
  const small = await configure(pr, { comprimento: 3000, largura: 1500, altura: 1000 })
  const big = await configure(pr, { comprimento: 5000, largura: 2000, altura: 1000 })
  const perfilOf = (cfg) => cfg.materials.find((m) => m.material_id === pr.perfil)
  // (2*3000+3*1500)/1000 = 10,5 m; +5% = 11,025; arredonda para cima de 0,5 => 11,5
  assert.deepEqual([num(perfilOf(small).quantity), perfilOf(small).source, perfilOf(small).formula_text, perfilOf(small).params_used.sort()], [11.5, "formula", "(2*comprimento + 3*largura)/1000", ["comprimento", "largura"]])
  // (2*5000+3*2000)/1000 = 16 m; +5% = 16,8; => 17
  assert.equal(num(perfilOf(big).quantity), 17)
  assert.equal(num(perfilOf(big).loss_percent), 5)
  assert.equal(perfilOf(big).formula_version, 1)
  assert.equal(perfilOf(big).approved_by, "Engenheiro Igor")
  // os custos acompanham o custo vigente do perfil por metro, chapas e fio inalterados, mão de obra fixa da estrutura
  assert.equal(num(big.costs.materials) - num(small.costs.materials), (17 - 11.5) * num(perfilOf(big).unit_cost))
  assert.equal(num(big.costs.total) - num(small.costs.total), (17 - 11.5) * num(perfilOf(big).unit_cost))
  assert.equal(num(big.costs.labor), 300)
  assert.deepEqual([big.status, big.homologated], ["Valida", true]) // fórmula aprovada: as quantidades acompanham as medidas
  assert.equal(num(big.margin), num(big.price) - num(big.costs.total))
  // preço NÃO muda sozinho com a medida
  assert.equal(num(big.price), num(small.price))
  assert.equal(num(big.price), 9000)
  // plano de corte: 2x5000 + 3x2000 em barras de 6000 mm => 3 barras (5000 | 5000 | 2000+2000+2000), sobra de 2000 mm no total
  const plan = big.cut_list[0].plan
  assert.equal(num(plan.waste_mm), 2000)
  assert.deepEqual([num(plan.bars), plan.pieces.map((p) => [p.label, num(p.length_mm), num(p.count)])], [3, [["Longarina", 5000, 2], ["Travessa", 2000, 3]]])
  // rastreabilidade da estrutura e dos kits
  assert.equal(big.bom_version_id, pr.versionId)
  assert.deepEqual(big.kits.map((k) => [k.name.startsWith("Kit"), num(k.quantity), num(k.version)]), [[true, 1, 1], [true, 1, 1]])
  // fórmula negativa e parâmetro inexistente são recusados sem derrubar o sistema
  const r3 = (await one("select public.eng_revision_copy($1::uuid, 'R3', 'Eng') id", [pr.revisionId])).id
  await db.query("select public.eng_formula_save($1::jsonb)", [JSON.stringify({ revision_id: r3, kit_id: pr.kitChassi, material_id: pr.perfil, expr: OP("-", N(1), P("comprimento")), unit: "M" })])
  await db.query("select public.eng_formula_save($1::jsonb)", [JSON.stringify({ revision_id: r3, kit_id: pr.kitChassi, material_id: pr.perfil, expr: OP("-", N(1), P("comprimento")), unit: "M" })]).catch(() => null)
  await rejects("select public.eng_formula_approve((select id from public.product_formulas where revision_id = $1 and status = 'Rascunho'), 'Eng')", [r3], /maior ou igual a zero/)
})

test("opções: acabamento e acessórios mudam preço, custo e kits; opção inexistente ou inativa é recusada; margem mínima da empresa alerta", async () => {
  const pr = await pilot("FZ Opcoes")
  const rodaKit = (await rpc("kit_save", { name: "Kit Estepe FZ", components: [{ component_id: await material("Roda estepe", { cost: 200 }), quantity: 1, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  await stockIn((await one("select id from public.materials where name = 'Roda estepe'")).id, 50, 200)
  const opt = (group, code, label, extra = {}) => one("select public.eng_option_save($1::jsonb) id", [JSON.stringify({ revision_id: pr.revisionId, option_group: group, code, label, ...extra })])
  await opt("acabamento", "pintado", "Pintado", { is_default: true, price_delta: 0 })
  await opt("acabamento", "galvanizado", "Galvanizado a fogo", { price_delta: 1200, cost_delta: 700 })
  await opt("acessorio", "estepe", "Estepe", { price_delta: 450, kit_id: rodaKit })
  await opt("acessorio", "descontinuado", "Descontinuado", { active: false })
  await validateRevision(pr)
  const base = await configure(pr)
  assert.deepEqual([base.options.acabamento, num(base.price), num(base.costs.finishing)], ["pintado", 9000, 0])
  const full = await configure(pr, {}, { acabamento: "galvanizado", acessorios: ["estepe"] })
  assert.deepEqual([num(full.price), num(full.price_options), num(full.costs.finishing)], [9000 + 1200 + 450, 1650, 700])
  assert.equal(num(full.costs.total) - num(base.costs.total), 700 + 200) // acabamento terceirizado + roda do kit do estepe
  assert.ok(full.materials.some((m) => m.name === "Roda estepe" && m.origin === "opcao" && m.option_code === "estepe"))
  assert.equal(full.kits.length, base.kits.length + 1)
  assert.deepEqual(full.options.selected.map((s) => s.code).sort(), ["estepe", "galvanizado"])
  assert.equal((await configure(pr, {}, { acabamento: "cromado" })).status, "Invalida")
  assert.equal((await configure(pr, {}, { acessorios: ["descontinuado"] })).status, "Invalida")
  assert.equal((await configure(pr, {}, { acessorios: ["inexistente"] })).errors[0].code, "dado")
  // margem mínima da empresa
  await db.query("select public.sales_settings_update('{\"min_margin_percent\": 95}'::jsonb)")
  const alert = await configure(pr, {}, { acabamento: "galvanizado" })
  assert.equal(alert.margin_alert, true)
  assert.ok(alert.warnings.some((w) => w.code === "margem"))
  assert.equal(num(alert.price), 10200) // o preço continua o negociado: a margem só alerta
  await db.query("select public.sales_settings_update('{\"min_margin_percent\": 0}'::jsonb)")
})

test("venda: configuração fora do padrão só vende com análise técnica aprovada; ao converter vira snapshot imutável e a ordem usa os materiais congelados", async () => {
  const pr = await pilot("FZ Venda", { price: 9000 })
  const r2issue = null
  // fórmula aprovada na revisão que será validada
  const f = (await one("select public.eng_formula_save($1::jsonb, 'Eng') id", [JSON.stringify({ revision_id: pr.revisionId, kit_id: pr.kitChassi, material_id: pr.perfil, expr: OP("/", P("comprimento"), N(250)), expr_text: "comprimento/250", unit: "M" })])).id
  await db.query("select public.eng_formula_approve($1::uuid, 'Eng')", [f])
  await validateRevision(pr)
  const client = (await one("select id from public.clients where document is not null limit 1")).id
  const quoteFor = async (configId, qty = 1) => {
    const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [pr.id]))[0]
    const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', $2, $2) returning id", [client, qty * 9000])
    await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, product_sku, configuration_id) values ($1, 0, 'Produto', $2, 'FZ 1E sob medida', $3, 9000, 9000, 1, $4, $5, 1, $6, $7)", [quote.id, pr.id, qty, qty * 9000, snap.bom_version_id, snap.sku, configId])
    return quote.id
  }
  // dentro dos limites
  const good = await rpc("product_configuration_save", { product_id: pr.id, params: { comprimento: 5000, largura: 1800, altura: 1200 }, options: {} }, "Vendedor")
  assert.equal(good.status, "Valida")
  // fora dos limites: não vende; pede análise técnica; engenharia aprova ou rejeita com justificativa
  const bad = await rpc("product_configuration_save", { product_id: pr.id, params: { comprimento: 6500, largura: 1800, altura: 1200 } }, "Vendedor")
  assert.equal(bad.status, "Fora dos limites")
  const badQuote = await quoteFor(bad.configuration_id)
  await rejects("select public.sales_order_from_quote($1::uuid)", [badQuote], /não pode ser vendida/)
  await rejects("select public.product_configuration_request_review($1::uuid, 'curto', 'Vendedor')", [bad.configuration_id], /mínimo 10/)
  const review = (await one("select public.product_configuration_request_review($1::uuid, 'Cliente pediu 6,5 m para transportar casco especial.', 'Vendedor') id", [bad.configuration_id])).id
  await rejects("select public.product_configuration_request_review($1::uuid, 'Cliente pediu 6,5 m para transportar casco.', 'Vendedor')", [bad.configuration_id], /duplicate|unique/i)
  await rejects("select public.product_configuration_decide_review($1::uuid, 'Aprovada', 'ok', '')", [review], /Informe quem decide/)
  await db.query("select public.product_configuration_decide_review($1::uuid, 'Rejeitada', 'Fora do que o CCT cobre.', 'Engenheiro Igor')", [review])
  assert.equal((await one("select status from public.product_configurations where id = $1", [bad.configuration_id])).status, "Rejeitada pela engenharia")
  await rejects("select public.sales_order_from_quote($1::uuid)", [badQuote], /não pode ser vendida/)
  // dentro dos limites: converte, congela e a ordem leva os materiais EXATOS da configuração (sem estoque padrão, mesmo havendo saldo de acabado)
  await stockIn(pr.id, 3, 100)
  const goodQuote = await quoteFor(good.configuration_id, 2)
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [goodQuote])).r.sales_order_id
  const frozen = await one("select frozen_at, frozen_context, drift from public.product_configurations where id = $1", [good.configuration_id])
  assert.ok(frozen.frozen_at)
  assert.match(frozen.frozen_context, /conversão do orçamento/)
  assert.deepEqual([num(frozen.drift.cost_at_quote), frozen.drift.bom_changed], [num(good.costs.total), false])
  assert.equal((await one("select configuration_id from public.sales_order_items where sales_order_id = $1", [order])).configuration_id, good.configuration_id)
  await rejects("update public.product_configurations set price = 1 where id = $1", [good.configuration_id], /congelada/)
  await rejects("delete from public.product_configurations where id = $1", [good.configuration_id], /não pode ser apagada/)
  const confirmed = (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [order])).r
  const po = confirmed.production_orders_created[0]
  assert.equal(num((await one("select quantity from public.production_orders where id = $1", [po])).quantity), 2) // 3 acabados em estoque, mas item configurado é sob medida: fabrica tudo
  const perfilLine = good.materials.find((m) => m.material_id === pr.perfil)
  assert.equal(num(perfilLine.quantity), 20) // 5000/250
  assert.equal(num((await one("select required_quantity q from public.production_order_materials where production_order_id = $1 and material_id = $2", [po, pr.perfil])).q), 40) // x 2 unidades
  assert.equal((await one("select configuration_id from public.production_orders where id = $1", [po])).configuration_id, good.configuration_id)
  // depois da venda, o cadastro mestre muda (nova revisão com limites diferentes, preço, kit) e NADA da venda muda
  const r2 = (await one("select public.eng_revision_copy($1::uuid, 'R2') id", [pr.revisionId])).id
  await db.query("update public.product_parameters set adopted_max = 3000 where revision_id = $1 and key = 'comprimento'", [r2])
  await db.query("select public.eng_revision_validate($1::uuid, 'Eng')", [r2])
  await rpc("product_save", { product_id: pr.id, name: "FZ Venda", sale_price: 15000, allows_sale: true })
  await rpc("kit_save", { kit_id: pr.kitChassi, name: "Kit Chassi FZ Venda", components: [{ component_id: pr.perfil, quantity: 99, unit: "M", loss_percent: 0 }], activate: true })
  const stillFrozen = await one("select params, price, materials, costs, kits, revision_label from public.product_configurations where id = $1", [good.configuration_id])
  assert.deepEqual([num(stillFrozen.params.comprimento), num(stillFrozen.price), stillFrozen.revision_label], [5000, 9000, "R1"])
  assert.equal(num(stillFrozen.materials.find((m) => m.material_id === pr.perfil).quantity), 20)
  assert.equal(num((await one("select required_quantity q from public.production_order_materials where production_order_id = $1 and material_id = $2", [po, pr.perfil])).q), 40)
  assert.equal(num((await one("select unit_price from public.sales_order_items where sales_order_id = $1", [order])).unit_price), 9000)
  // ficha de fabricação: modelo, medidas exatas, desenho, kits, materiais e revisão do projeto
  const sheet = (await one("select public.production_order_sheet($1::uuid) s", [po])).s
  assert.deepEqual([sheet.configuration.revision_label, num(sheet.configuration.params.comprimento), num(sheet.configuration.params.largura), num(sheet.order.quantity)], ["R1", 5000, 1800, 2])
  assert.equal(sheet.configuration.drawing_spec.grade, "ilustrativo")
  assert.ok(sheet.materials.length >= 3 && sheet.kits.length === 2)
  assert.equal(sheet.sales_order.client, "Cliente Teste")
  void r2issue
})

test("documentação veicular herda a configuração vendida (CAT, código marca/modelo/versão, medidas); troca de configuração é controlada e nunca silenciosa", async () => {
  const pr = await pilot("FZ Doc")
  const f = (await one("select public.eng_formula_save($1::jsonb) id", [JSON.stringify({ revision_id: pr.revisionId, kit_id: pr.kitChassi, material_id: pr.perfil, expr: OP("/", P("comprimento"), N(250)), unit: "M" })])).id
  await db.query("select public.eng_formula_approve($1::uuid, 'Eng')", [f])
  await validateRevision(pr)
  const client = (await one("select id from public.clients where document is not null limit 1")).id
  const cfgA = await rpc("product_configuration_save", { product_id: pr.id, params: { comprimento: 4000, largura: 1500, altura: 1000 } }, "V")
  const cfgB = await rpc("product_configuration_save", { product_id: pr.id, params: { comprimento: 5000, largura: 1500, altura: 1000 } }, "V")
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [pr.id]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', 18000, 18000) returning id", [client])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, product_sku, configuration_id) values ($1, 0, 'Produto', $2, 'FZ 1E', 2, 9000, 9000, 1, 18000, $3, 1, $4, $5)", [quote.id, pr.id, snap.bom_version_id, snap.sku, cfgA.configuration_id])
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
  await db.query("select public.confirm_sales_order($1::uuid, 'Gerente')", [order])
  const docs = await all("select * from public.vehicle_documentation where sales_order_id = $1 order by unit_number", [order])
  assert.equal(docs.length, 2)
  assert.ok(docs.every((d) => d.configuration_id === cfgA.configuration_id && d.cat_number === "1143/2019" && d.brand_model_version_code === "R/ND CARRETAS FZ 1E"))
  // o envio leva a configuração e as medidas vendidas
  await db.query("update public.vehicle_documentation set vin = '9BWZZZ377VT100001' where id = $1", [docs[0].id])
  await db.query("update public.vehicle_documentation set vin = '9BWZZZ377VT100002' where id = $1", [docs[1].id])
  await db.query("update public.vehicle_documentation set status = 'Pronto para envio' where sales_order_id = $1", [order])
  const begin = (await one("select public.vehicle_doc_begin_submit($1::uuid, 'k1') r", [docs[0].id])).r
  assert.deepEqual([num(begin.payload.configuration.params.comprimento), begin.payload.configuration.revision, begin.payload.configuration.cct_number], [4000, "R1", "A0.051.856"])
  await db.query("select public.vehicle_doc_finish_submit($1::uuid, $2::jsonb)", [begin.attempt_id, JSON.stringify({ outcome: "sucesso", protocol: "PROT-CFG-1" })])
  await db.query("select public.vehicle_doc_apply_result($1::uuid, $2::jsonb)", [docs[0].id, JSON.stringify({ result: "aprovado", result_key: "r1" })])
  // revisão controlada: motivo obrigatório; a unidade já aprovada fica marcada para reavaliação e deixa de contar como liberada
  const item = (await one("select id from public.sales_order_items where sales_order_id = $1", [order])).id
  await rejects("select public.sales_item_reconfigure($1::uuid, $2::uuid, 'curto', 'Vendedor')", [item, cfgB.configuration_id], /mínimo 10/)
  await db.query("select public.sales_settings_update('{\"require_documentation_before_production\": true}'::jsonb)")
  const before = (await one("select public.production_eligibility($1::uuid) e", [order])).e
  assert.equal(num(before.documentation.approved), 1)
  const change = (await one("select public.sales_item_reconfigure($1::uuid, $2::uuid, 'Cliente pediu 5 m de comprimento.', 'Gerente') r", [item, cfgB.configuration_id])).r
  assert.equal(num(change.documentation_flagged), 1) // a unidade aprovada
  const flagged = await all("select id, status, config_review_required, configuration_id from public.vehicle_documentation where sales_order_id = $1 order by unit_number", [order])
  assert.deepEqual(flagged.map((d) => [d.config_review_required, d.configuration_id === cfgB.configuration_id]), [[true, true], [false, true]])
  const eligible = (await one("select public.production_eligibility($1::uuid) e", [order])).e
  assert.equal(num(eligible.documentation.approved), 0) // revisão pendente: não conta como liberada
  await rejects("select public.vehicle_doc_ack_config_review($1::uuid, 'x', 'Docs')", [flagged[0].id], /Registre o que foi avaliado/)
  await db.query("select public.vehicle_doc_ack_config_review($1::uuid, 'Dados enviados continuam corretos para o novo comprimento.', 'Docs')", [flagged[0].id])
  assert.equal(num((await one("select public.production_eligibility($1::uuid) e", [order])).e.documentation.approved), 1)
  assert.equal(num(change.price_difference), 0)
  const events = await all("select event from public.vehicle_documentation_events where documentation_id = $1", [flagged[0].id])
  assert.ok(events.some((e) => e.event === "Configuração revisada") && events.some((e) => e.event === "Revisão avaliada"))
  assert.ok((await all("select event from public.sales_order_events where sales_order_id = $1", [order])).some((e) => e.event === "Configuração revisada"))
  // a ordem foi replanejada com os materiais da configuração nova e a antiga ficou guardada (substituída)
  const po = await all("select quantity, status, configuration_id from public.production_orders where sales_order_id = $1 order by created_at", [order])
  assert.deepEqual([po.length, po.map((p) => p.status), po[1].configuration_id === cfgB.configuration_id], [2, ["Cancelada", "Aguardando materiais" === po[1].status ? "Aguardando materiais" : po[1].status], true])
  assert.equal(num((await one("select required_quantity q from public.production_order_materials where production_order_id = (select id from public.production_orders where sales_order_id = $1 and status <> 'Cancelada') and material_id = $2", [order, pr.perfil])).q), 40) // 5000/250 x 2
  assert.ok((await one("select superseded_at from public.product_configurations where id = $1", [cfgA.configuration_id])).superseded_at)
  // depois que a produção consome material, a configuração não troca mais
  await db.query("select public.sales_settings_update('{\"require_documentation_before_production\": false}'::jsonb)")
  const activePo = (await one("select id from public.production_orders where sales_order_id = $1 and status <> 'Cancelada'", [order])).id
  await db.query("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 1))", [activePo, pr.perfil])
  await rejects("select public.sales_item_reconfigure($1::uuid, $2::uuid, 'Troca tardia de configuração.', 'Gerente')", [item, cfgA.configuration_id], /já consumiu material/)
})

test("isolamento: a configuração de uma empresa não é lida, revisada nem vendida pela outra", async () => {
  const pr = await pilot("FZ Isolada")
  await validateRevision(pr)
  const cfg = await rpc("product_configuration_save", { product_id: pr.id, params: { comprimento: 3000, largura: 1500, altura: 1000 } }, "V")
  assert.ok((await one("select public.product_configuration_get($1::uuid) c", [cfg.configuration_id])).c)
  await asCompany(COMPANY_B)
  assert.equal((await one("select public.product_configuration_get($1::uuid) c", [cfg.configuration_id])).c, null)
  await rejects("select public.product_configuration_freeze($1::uuid)", [cfg.configuration_id], /não encontrada/)
  await rejects("select public.product_configuration_request_review($1::uuid, 'Pedido de análise de outra empresa.', 'X')", [cfg.configuration_id], /não encontrada/)
  assert.equal(num((await one("select count(*) n from public.product_configurations where system_company_id = $1 and id = $2", [COMPANY_B, cfg.configuration_id])).n), 0)
  // o cadastro de engenharia é do catálogo compartilhado: as duas empresas enxergam a mesma revisão validada
  assert.equal(num((await one("select count(*) n from public.product_engineering_revisions where product_id = $1", [pr.id])).n), 1)
  const asB = await configure(pr)
  assert.equal(asB.status, "Valida")
  await asCompany(COMPANY_A)
})
