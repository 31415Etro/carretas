// Etapa 7: documentação veicular por unidade e liberação CALCULADA da produção (regras padrão: documentação + autorização operacional obrigatórias).
// Nenhum serviço externo é chamado: o canal é simulado pelos próprios resultados gravados (envio, retorno, consulta).
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
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"doc@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
// chassi válido e único por chamada (17 caracteres, sem I, O e Q)
const newVin = () => `9BWZZZ377VT${String(100000 + vinSeq++).slice(-6)}`

async function material(name, { unit = "UN", cost = 0 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  return (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, $2, 'Materia-prima', $3, 'Ativo', false, $4, $4, 'Aço') returning id", [name, unit, sku, cost])).id
}
const stockIn = (id, qty, cost = null) => db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', $3::numeric))`, [id, qty, cost])
async function setup(name, { price = 9000 } = {}) {
  const m = await material(`MP ${name}`, { cost: 2 }); await stockIn(m, 1000, 2)
  const k = (await rpc("kit_save", { name: `Kit ${name}`, components: [{ component_id: m, quantity: 3, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const r = await rpc("product_save", { name, model: name.slice(0, 8), sale_price: price, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: k, quantity: 1 }], activate: true } })
  return { id: r.product_id, sku: r.sku, versionId: r.version_id, material: m }
}
async function approvedQuote(product, qty, { client, condition } = {}) {
  const clientId = client || (await one("select id from public.clients where document is not null limit 1")).id
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [product.id]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount, payment_condition_name, payment_condition_snapshot) values ($1, (select id from public.salespeople limit 1), current_date + 15, 'Produto', 'Aprovado', $2, $2, $3, $4::jsonb) returning id",
    [clientId, qty * 9000, condition ? "Condição teste" : null, condition ? JSON.stringify(condition) : null])
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', $3, 9000, 9000, $4, $5, $6, $7, 30, $8)",
    [quote.id, product.id, qty, snap.est_cost, qty * 9000, snap.bom_version_id, snap.bom_version, snap.sku])
  return quote.id
}
async function confirmedOrder(product, qty, options = {}) {
  const quote = await approvedQuote(product, qty, options)
  const order = (await one("select public.sales_order_from_quote($1::uuid) r", [quote])).r.sales_order_id
  const result = (await one("select public.confirm_sales_order($1::uuid, 'Gerente') r", [order])).r
  return { order, result, quote }
}
const docs = (order) => all("select * from public.vehicle_documentation where sales_order_id = $1 order by unit_number", [order])
const setVin = async (doc, vin = newVin()) => (await rpc("vehicle_doc_update", { documentation_id: doc.id, vin })) && vin
const submit = (doc, key) => one("select public.vehicle_doc_begin_submit($1::uuid, $2, 'Operador') r", [doc, key]).then((row) => row.r)
const finish = (attempt, payload) => one("select public.vehicle_doc_finish_submit($1::uuid, $2::jsonb, 'Operador') r", [attempt, JSON.stringify(payload)]).then((row) => row.r)
const result = (doc, payload) => one("select public.vehicle_doc_apply_result($1::uuid, $2::jsonb, 'Operador') r", [doc, JSON.stringify(payload)]).then((row) => row.r)
const eligibility = async (order) => (await one("select public.production_eligibility($1::uuid) r", [order])).r
const status = async (doc) => (await one("select status from public.vehicle_documentation where id = $1", [doc])).status
/** Leva a unidade até "Aprovado para liberação" pelo caminho normal. */
async function approveUnit(doc, tag) {
  await setVin(doc)
  const begin = await submit(doc.id, `env-${tag}-${doc.unit_number}`)
  await finish(begin.attempt_id, { outcome: "sucesso", protocol: `PROT-${tag}-${doc.unit_number}-${Math.random().toString(36).slice(2, 8)}`, message: "Recebido", response: { ok: true } })
  await result(doc.id, { result: "aprovado", result_key: `ret-${tag}-${doc.unit_number}`, message: "Pré-cadastro aprovado" })
}
const startPo = (po) => db.query("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po])

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_B)
  await db.exec("insert into public.warehouses (code, name, is_default) values ('DEP-B', 'Depósito B', true)")
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
})

test("venda com uma carreta: documentação nasce com o pedido, a demanda e os materiais são planejados e o início físico fica bloqueado", async () => {
  const product = await setup("Carreta Uma")
  const { order, result: confirmed } = await confirmedOrder(product, 1)
  const list = await docs(order)
  assert.equal(list.length, 1)
  assert.deepEqual([list[0].status, list[0].final_stage, list[0].unit_number, list[0].vin], ["Pendente de dados", "Nao iniciada", 1, null])
  assert.deepEqual([list[0].product_id, list[0].client_id, list[0].product_model !== null, list[0].bom_version_id], [product.id, (await one("select client_id from public.sales_orders where id = $1", [order])).client_id, true, product.versionId])
  // demanda registrada e materiais reservados, sem esperar a documentação
  const po = confirmed.production_orders_created[0]
  assert.ok(po)
  assert.equal(num((await one("select sum(reserved_quantity) q from public.production_order_materials where production_order_id = $1", [po])).q), 3)
  assert.equal((await one("select status from public.sales_orders where id = $1", [order])).status, "Aguardando producao")
  const blockers = (await eligibility(order)).blockers.map((b) => b.code).sort()
  assert.deepEqual(blockers, ["autorizacao", "documentacao"])
  // início físico bloqueado em todas as portas: situação, consumo e entrada do acabado
  await rejects("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po], /Produção bloqueada/)
  await rejects("select public.record_production_consumption(jsonb_build_object('production_order_id', $1::text, 'material_id', $2::text, 'quantity', 1))", [po, product.material], /Produção bloqueada/)
  await rejects("select public.complete_production(jsonb_build_object('production_order_id', $1::text, 'quantity', 1, 'auto_consume', true))", [po], /Produção bloqueada/)
  assert.equal(num((await one("select count(*) n from public.production_consumptions where production_order_id = $1", [po])).n), 0)
  // quando a documentação é aprovada e a produção autorizada, o cálculo libera
  await approveUnit(list[0], "u1")
  assert.equal((await eligibility(order)).eligible, false) // falta a autorização
  const released = (await one("select public.production_authorize($1::uuid, 'Diretor', 'ok') r", [order])).r
  assert.equal(released.eligible, true)
  assert.equal((await one("select status from public.sales_orders where id = $1", [order])).status, "Em producao") // liberada: o pedido sai de "Aguardando produção"
  await startPo(po)
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Em producao")
  assert.equal((await one("select status from public.sales_orders where id = $1", [order])).status, "Em producao")
})

test("venda com várias carretas: uma documentação por unidade, com unidade, item, produto e versão próprios; confirmar de novo não duplica", async () => {
  const product = await setup("Carreta Varias")
  const { order } = await confirmedOrder(product, 3)
  const list = await docs(order)
  assert.deepEqual(list.map((d) => d.unit_number), [1, 2, 3])
  assert.equal(new Set(list.map((d) => d.sales_order_item_id)).size, 1)
  assert.ok(list.every((d) => d.product_id === product.id && d.bom_version_id === product.versionId))
  await db.query("select public.confirm_sales_order($1::uuid)", [order]) // requisição repetida
  assert.equal((await docs(order)).length, 3)
  assert.equal(num((await one("select public.vehicle_documentation_generate($1::uuid) n", [order])).n), 0)
  // liberar só 2 das 3 unidades NÃO libera a fabricação
  await approveUnit(list[0], "v"); await approveUnit(list[1], "v")
  await db.query("select public.production_authorize($1::uuid, 'Diretor')", [order])
  const e = await eligibility(order)
  assert.equal(e.eligible, false)
  assert.deepEqual([e.documentation.units, e.documentation.approved], [3, 2])
  const po = (await one("select id from public.production_orders where sales_order_id = $1", [order])).id
  await rejects("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po], /2 de 3/)
  await approveUnit(list[2], "v")
  assert.equal((await eligibility(order)).eligible, true)
  // resumo do pedido para as telas de pedido, oportunidade e produção
  const summary = (await one("select public.vehicle_doc_summary($1::uuid) s", [order])).s
  assert.deepEqual([num(summary.total), num(summary.approved), num(summary.needs_action)], [3, 3, 0])
})

test("dados incompletos: sem chassi válido, CPF/CNPJ ou modelo não há envio; e o chassi nunca se repete (nem entre empresas)", async () => {
  const product = await setup("Carreta Dados")
  const { order } = await confirmedOrder(product, 2)
  const [u1, u2] = await docs(order)
  await rejects("select public.vehicle_doc_begin_submit($1::uuid, 'k-incompleto')", [u1.id], /Dados incompletos.*Chassi/)
  assert.deepEqual((await one("select public.vehicle_doc_missing($1::uuid) m", [u1.id])).m, ["Chassi (VIN)"])
  const bad = await rpc("vehicle_doc_update", { documentation_id: u1.id, vin: "ABC123" })
  assert.equal(bad.status, "Pendente de dados")
  assert.match(bad.missing[0], /inválido/)
  const vin = await setVin(u1)
  assert.equal(await status(u1.id), "Pronto para envio")
  // o mesmo chassi na unidade 2 é recusado, com ou sem caixa alta
  await rejects("select public.vehicle_doc_update($1::jsonb)", [JSON.stringify({ documentation_id: u2.id, vin: vin.toLowerCase() })], /já está em outra documentação/)
  // e em outra empresa também (o veículo físico é um só)
  await asCompany(COMPANY_B)
  await rejects("select public.vehicle_doc_update($1::jsonb)", [JSON.stringify({ documentation_id: u2.id, vin })], /outra empresa/)
  await asCompany(COMPANY_A)
  // cancelar a documentação libera o chassi para o veículo certo
  await db.query("select public.vehicle_doc_cancel($1::uuid, 'Chassi digitado errado')", [u1.id])
  assert.equal(await status(u1.id), "Cancelado")
  await rpc("vehicle_doc_update", { documentation_id: u2.id, vin })
  assert.equal((await one("select vin from public.vehicle_documentation where id = $1", [u2.id])).vin, vin)
  // cliente sem CPF/CNPJ impede o envio
  const noDoc = (await one("insert into public.clients (name, type) values ('Sem documento', 'PJ') returning id")).id
  const other = await confirmedOrder(await setup("Carreta Sem Doc"), 1).catch((e) => e)
  assert.ok(other.order) // o pedido nasce (cliente do orçamento tem documento)
  await db.query("update public.vehicle_documentation set client_id = $1 where id = $2", [noDoc, (await docs(other.order))[0].id])
  const doc = (await docs(other.order))[0]
  await rpc("vehicle_doc_update", { documentation_id: doc.id, vin: newVin() })
  assert.match((await one("select public.vehicle_doc_missing($1::uuid) m", [doc.id])).m[0], /CPF\/CNPJ/)
})

test("envio: a chave evita duplicidade, a mesma unidade não é enviada duas vezes e o protocolo é único", async () => {
  const product = await setup("Carreta Envio")
  const { order } = await confirmedOrder(product, 2)
  const [u1, u2] = await docs(order)
  await setVin(u1); await setVin(u2)
  const first = await submit(u1.id, "chave-1")
  assert.equal(first.duplicate, false)
  assert.equal(first.payload.vin, (await one("select upper(vin) v from public.vehicle_documentation where id = $1", [u1.id])).v)
  assert.equal(await status(u1.id), "Envio em andamento")
  const repeated = await submit(u1.id, "chave-1") // clique duplo
  assert.deepEqual([repeated.duplicate, repeated.attempt_id], [true, first.attempt_id])
  await rejects("select public.vehicle_doc_begin_submit($1::uuid, 'chave-2')", [u1.id], /já foi enviada/) // outra chave, mesma unidade
  const ok = await finish(first.attempt_id, { outcome: "sucesso", protocol: "PROT-UNICO-1", response: { id: 1 } })
  assert.deepEqual([ok.status, ok.protocol], ["Enviado", "PROT-UNICO-1"])
  assert.equal((await finish(first.attempt_id, { outcome: "sucesso", protocol: "PROT-UNICO-1" })).duplicate, true) // finalizar de novo não repete
  assert.equal(num((await one("select count(*) n from public.vehicle_documentation_attempts where documentation_id = $1", [u1.id])).n), 1)
  await rejects("select public.vehicle_doc_begin_submit($1::uuid, 'chave-3')", [u1.id], /já foi enviada/)
  // protocolo não pode ser de outra unidade
  const second = await submit(u2.id, "chave-u2")
  await rejects("select public.vehicle_doc_finish_submit($1::uuid, $2::jsonb)", [second.attempt_id, JSON.stringify({ outcome: "sucesso", protocol: "PROT-UNICO-1" })], /já está vinculado/)
  await rejects("select public.vehicle_doc_finish_submit($1::uuid, $2::jsonb)", [second.attempt_id, JSON.stringify({ outcome: "sucesso" })], /protocolo/)
})

test("serviço externo indisponível: a unidade volta para 'Pronto para envio', o erro fica no histórico e dá para tentar de novo", async () => {
  const product = await setup("Carreta Fora")
  const { order } = await confirmedOrder(product, 1)
  const [doc] = await docs(order)
  await setVin(doc)
  const a1 = await submit(doc.id, "t1")
  const failed = await finish(a1.attempt_id, { outcome: "indisponivel", message: "Portal fora do ar (503)" })
  assert.deepEqual([failed.outcome, failed.status], ["indisponivel", "Pronto para envio"])
  assert.equal((await one("select last_error from public.vehicle_documentation where id = $1", [doc.id])).last_error, "Portal fora do ar (503)")
  const a2 = await submit(doc.id, "t2")
  const ok = await finish(a2.attempt_id, { outcome: "sucesso", protocol: "PROT-FORA-1" })
  assert.equal(ok.status, "Enviado")
  const attempts = await all("select attempt_number, kind, outcome from public.vehicle_documentation_attempts where documentation_id = $1 order by attempt_number", [doc.id])
  assert.deepEqual(attempts.map((a) => [a.attempt_number, a.kind, a.outcome]), [[1, "envio", "indisponivel"], [2, "reenvio", "sucesso"]]) // todas as tentativas preservadas
  assert.equal((await one("select last_error from public.vehicle_documentation where id = $1", [doc.id])).last_error, null)
})

test("retornos do portal: processando, exigência, rejeição e aprovação; correção e reenvio preservam o histórico; consulta repetida não duplica", async () => {
  const product = await setup("Carreta Retorno")
  const { order } = await confirmedOrder(product, 1)
  const [doc] = await docs(order)
  await setVin(doc)
  const send = await submit(doc.id, "r1")
  await finish(send.attempt_id, { outcome: "sucesso", protocol: "PROT-RET-1" })
  // consulta: ainda processando (duas consultas com chaves diferentes são registradas; a mesma chave não)
  assert.equal((await result(doc.id, { result: "processando", result_key: "q1" })).status, "Aguardando processamento")
  assert.equal((await result(doc.id, { result: "processando", result_key: "q1" })).duplicate, true)
  assert.equal((await result(doc.id, { result: "processando", result_key: "q2" })).duplicate, false)
  // exigência: pendências guardadas, correção devolve para envio
  const requirement = await result(doc.id, { result: "exigencia", result_key: "q3", message: "Informar o CAT", pendencies: ["Informar o número do CAT"] })
  assert.equal(requirement.status, "Em exigencia")
  assert.deepEqual((await one("select pendencies p from public.vehicle_documentation where id = $1", [doc.id])).p, ["Informar o número do CAT"])
  const fixed = await rpc("vehicle_doc_update", { documentation_id: doc.id, cat_number: "CAT-2026-001", brand_model_version_code: "123456" })
  assert.equal(fixed.status, "Pronto para envio")
  const resend = await submit(doc.id, "r2")
  await finish(resend.attempt_id, { outcome: "sucesso", protocol: "PROT-RET-2" })
  // rejeição
  assert.equal((await result(doc.id, { result: "rejeitado", result_key: "q4", message: "Chassi incompatível com o ano" })).status, "Rejeitado")
  assert.equal((await eligibility(order)).eligible, false)
  await rpc("vehicle_doc_update", { documentation_id: doc.id, vin: newVin() })
  const third = await submit(doc.id, "r3")
  await finish(third.attempt_id, { outcome: "sucesso", protocol: "PROT-RET-3" })
  // aprovação final
  const approved = await result(doc.id, { result: "aprovado", result_key: "q5" })
  assert.equal(approved.status, "Aprovado para liberacao")
  assert.equal((await result(doc.id, { result: "aprovado", result_key: "q5" })).duplicate, true) // consulta repetida
  // depois de aprovada, retorno tardio de rejeição não desfaz a aprovação (fica registrado como ignorado)
  const late = await result(doc.id, { result: "rejeitado", result_key: "q6", message: "retorno atrasado" })
  assert.equal(late.ignored, true)
  assert.equal(await status(doc.id), "Aprovado para liberacao")
  const detail = (await one("select public.vehicle_doc_detail($1::uuid) d", [doc.id])).d
  assert.ok(detail.attempts.length >= 8)
  assert.deepEqual([...new Set(detail.attempts.filter((a) => ["envio", "reenvio"].includes(a.kind)).map((a) => a.kind))].sort(), ["envio", "reenvio"])
  assert.ok(["Criada", "Situação", "Dados", "Envio", "Retorno", "Resultado ignorado"].every((e) => detail.events.some((x) => x.event === e)))
  assert.equal(detail.documentation.final_stage, "Nao iniciada") // pré-cadastro aprovado não é CRLV/ATPV-e/emplacamento
  // o estágio final é separado e não muda a liberação
  await rejects("select public.vehicle_doc_set_final_stage($1::uuid, 'Concluida')", [(await docs((await confirmedOrder(await setup("Carreta Outra"), 1)).order))[0].id], /pré-cadastro aprovado/)
  await db.query("select public.vehicle_doc_set_final_stage($1::uuid, 'Aguardando fabricacao', 'CRLV após a nota', 'Doc')", [doc.id])
  assert.equal((await one("select final_stage from public.vehicle_documentation where id = $1", [doc.id])).final_stage, "Aguardando fabricacao")
  // resultado de uma unidade que nunca foi enviada é recusado
  const pending = (await docs((await confirmedOrder(await setup("Carreta Nunca"), 1)).order))[0]
  await rejects("select public.vehicle_doc_apply_result($1::uuid, $2::jsonb)", [pending.id, JSON.stringify({ result: "aprovado" })], /só há resultado do portal para o que foi enviado/)
})

test("liberação calculada: autorização revogada ou documentação cancelada bloqueiam de novo; exceção só para a exigência comercial, com regra formal e justificativa", async () => {
  const product = await setup("Carreta Liberacao")
  const { order } = await confirmedOrder(product, 1)
  const [doc] = await docs(order)
  await approveUnit(doc, "lib")
  await db.query("select public.production_authorize($1::uuid, 'Diretor')", [order])
  assert.equal((await eligibility(order)).eligible, true)
  const po = (await one("select id from public.production_orders where sales_order_id = $1", [order])).id
  // revogar a autorização bloqueia outra vez, e o status do pedido acompanha
  const revoked = (await one("select public.production_revoke_authorization($1::uuid, 'Revisão do projeto', 'Diretor') r", [order])).r
  assert.deepEqual([revoked.eligible, revoked.blockers[0].code], [false, "autorizacao"])
  await rejects("select public.production_change_status($1::uuid, 'start', 'Chefe')", [po], /autorização operacional/)
  assert.equal((await one("select status from public.sales_orders where id = $1", [order])).status, "Aguardando producao")
  await db.query("select public.production_authorize($1::uuid, 'Diretor')", [order])
  // pagamento exigido: bloqueia; exceção sem regra formal é recusada; documentação nunca é dispensável
  await db.query("select public.sales_settings_update('{\"require_payment_before_production\": true}'::jsonb, 'Gerente')")
  const e = await eligibility(order)
  assert.deepEqual(e.blockers.map((b) => [b.code, b.waivable]), [["pagamento", false]])
  await rejects("select public.production_release_exception($1::uuid, 'pagamento', 'Cliente de confiança, sinal na entrega', 'Diretor')", [order], /regra formal/)
  await db.query("select public.sales_settings_update('{\"allow_payment_exception\": true}'::jsonb, 'Gerente')")
  await rejects("select public.production_release_exception($1::uuid, 'documentacao', 'Quero pular a documentação', 'Diretor')", [order], /não pode ser dispensada/)
  await rejects("select public.production_release_exception($1::uuid, 'pagamento', 'curto', 'Diretor')", [order], /justificativa/)
  const waived = (await one("select public.production_release_exception($1::uuid, 'pagamento', 'Cliente de confiança, sinal na entrega', 'Diretor') r", [order])).r
  assert.equal(waived.eligible, true)
  assert.equal(num((await one("select count(*) n from public.sales_order_events where sales_order_id = $1 and event = 'Exceção'", [order])).n), 1) // auditoria
  await startPo(po) // liberado pela exceção formal, com a documentação aprovada
  await db.query("select public.sales_settings_update('{\"require_payment_before_production\": false}'::jsonb, 'Gerente')")
  // cancelar a documentação de um pedido vivo volta a bloquear (não se produz sem documentação)
  const second = await confirmedOrder(await setup("Carreta Cancelada"), 1)
  const [d2] = await docs(second.order)
  await approveUnit(d2, "can"); await db.query("select public.production_authorize($1::uuid, 'Diretor')", [second.order])
  assert.equal((await eligibility(second.order)).eligible, true)
  await db.query("select public.vehicle_doc_cancel($1::uuid, 'Pedido alterado')", [d2.id])
  const afterCancel = await eligibility(second.order)
  assert.equal(afterCancel.eligible, false)
  assert.match(afterCancel.blockers[0].message, /1 cancelada/)
  await db.query("select public.sales_settings_update('{\"require_payment_before_production\": false}'::jsonb, 'Gerente')")
})

test("isolamento entre empresas: ninguém envia, consulta, autoriza ou lista a documentação da outra", async () => {
  const product = await setup("Carreta Isolada")
  const { order } = await confirmedOrder(product, 1)
  const [doc] = await docs(order)
  await setVin(doc)
  await asCompany(COMPANY_B)
  assert.equal((await all("select 1 from public.vehicle_doc_list()")).length, 0)
  assert.equal(num((await one("select (public.vehicle_doc_dashboard()->>'open')::int n")).n), 0)
  await rejects("select public.vehicle_doc_detail($1::uuid)", [doc.id], /não encontrada/)
  await rejects("select public.vehicle_doc_begin_submit($1::uuid, 'x')", [doc.id], /outra empresa/)
  await rejects("select public.vehicle_doc_apply_result($1::uuid, $2::jsonb)", [doc.id, JSON.stringify({ result: "aprovado" })], /outra empresa/)
  await rejects("select public.vehicle_doc_cancel($1::uuid, 'x')", [doc.id], /outra empresa/)
  await rejects("select public.production_authorize($1::uuid, 'Alguém')", [order], /outra empresa/)
  await rejects("select public.vehicle_documentation_generate($1::uuid)", [order], /outra empresa/)
  assert.equal((await eligibility(order)).blockers[0].message, "Pedido de venda não encontrado.") // nem o cálculo vaza para a outra empresa
  assert.equal((await all("select * from public.vehicle_doc_pending_checks()")).length, 0)
  await asCompany(COMPANY_A)
  assert.equal((await all("select 1 from public.vehicle_doc_list(null, null, $1::uuid)", [order])).length, 1)
})

test("monitoramento: fila de consultas, atrasos e painel; resultado repetido não duplica", async () => {
  const product = await setup("Carreta Monitor")
  const { order } = await confirmedOrder(product, 2)
  const [u1, u2] = await docs(order)
  await setVin(u1); await setVin(u2)
  for (const [doc, protocol] of [[u1, "PROT-MON-1"], [u2, "PROT-MON-2"]]) await finish((await submit(doc.id, `m-${doc.unit_number}`)).attempt_id, { outcome: "sucesso", protocol })
  await db.query("update public.vehicle_documentation set next_check_at = now() - interval '1 minute' where id = any($1::uuid[])", [[u1.id, u2.id]])
  const queue = await all("select * from public.vehicle_doc_pending_checks(10)")
  assert.deepEqual(queue.map((q) => q.protocol).sort(), ["PROT-MON-1", "PROT-MON-2"])
  await db.query("select public.vehicle_doc_mark_checked($1::uuid, 120, 'Portal respondeu 503')", [u1.id])
  assert.deepEqual((await all("select protocol from public.vehicle_doc_pending_checks(10)")).map((q) => q.protocol), ["PROT-MON-2"]) // u1 só volta daqui a 2 h
  // sem retorno há mais dos dias configurados: aparece como atrasada
  await db.query("update public.vehicle_documentation set last_checked_at = now() - interval '10 days', submitted_at = now() - interval '10 days' where id = $1", [u2.id])
  assert.equal((await all("select stale from public.vehicle_doc_list(null, null, $1::uuid) where id = $2", [order, u2.id]))[0].stale, true)
  const dash = (await one("select public.vehicle_doc_dashboard() d")).d
  assert.ok(num(dash.stale) >= 1 && num(dash.waiting) >= 2)
  await db.query("select public.sales_settings_update('{\"documentation_stale_days\": 30}'::jsonb)")
  assert.equal((await all("select stale from public.vehicle_doc_list(null, null, $1::uuid) where id = $2", [order, u2.id]))[0].stale, false)
  await db.query("select public.sales_settings_update('{\"documentation_stale_days\": 7}'::jsonb)")
  // busca por chassi e por protocolo (rastreabilidade)
  const vin = (await one("select vin from public.vehicle_documentation where id = $1", [u1.id])).vin
  assert.equal((await all("select * from public.vehicle_doc_list($1)", [vin.slice(5)])).length, 1)
  assert.equal((await all("select * from public.vehicle_doc_list('PROT-MON-2')")).length, 1)
})

test("financeiro: títulos previstos só quando a empresa liga; uma vez só; soma igual ao pedido, com entrada", async () => {
  const product = await setup("Carreta Titulos", { price: 10000 })
  const before = num((await one("select count(*) n from public.accounts_receivable")).n)
  const off = await confirmedOrder(product, 1, { condition: { installments: 3, firstDueDays: 0, intervalDays: 30, paymentMethod: "PIX" } })
  assert.equal(num((await one("select count(*) n from public.accounts_receivable")).n), before) // desligado: nada é criado
  await db.query("select public.sales_settings_update('{\"generate_receivables_on_confirmation\": true}'::jsonb, 'Gerente')")
  const on = await confirmedOrder(product, 1, { condition: { installments: 3, firstDueDays: 0, intervalDays: 30, paymentMethod: "PIX" } })
  assert.equal(on.result.receivables.generated, 3)
  const rows = await all("select * from public.accounts_receivable where source_reference = (select order_number from public.sales_orders where id = $1) order by installment_number", [on.order])
  assert.deepEqual(rows.map((r) => num(r.expected_amount)), [3000, 3000, 3000])
  assert.match(rows[0].description, /entrada/)
  assert.deepEqual([rows[0].origin, rows[0].status, num(rows[0].received_amount)], ["Pedido de venda", "Aberta", 0])
  assert.equal(num((await one("select sum(expected_amount) s from public.accounts_receivable where source_reference = (select order_number from public.sales_orders where id = $1)", [on.order])).s), 9000)
  await db.query("select public.confirm_sales_order($1::uuid)", [on.order]) // repetir não gera de novo
  assert.equal(num((await one("select count(*) n from public.accounts_receivable where source_reference = (select order_number from public.sales_orders where id = $1)", [on.order])).n), 3)
  // pedido que já foi confirmado antes da regra ligada não ganha títulos escondidos
  assert.equal((await one("select receivables_generated_at from public.sales_orders where id = $1", [off.order])).receivables_generated_at, null)
  await db.query("select public.sales_settings_update('{\"generate_receivables_on_confirmation\": false}'::jsonb, 'Gerente')")
})

test("regras da empresa: configuração auditada; produto sem exigência documental e pedido sem documentação seguem sem bloqueio documental", async () => {
  const log = num((await one("select count(*) n from public.sales_settings_log")).n)
  await db.query("select public.sales_settings_update('{\"require_operational_authorization\": false}'::jsonb, 'Gerente')")
  assert.equal(num((await one("select count(*) n from public.sales_settings_log")).n), log + 1)
  await rejects("select public.sales_settings_update('{\"documentation_channel\": \"inventado\"}'::jsonb)", [], /Canal de documentação inválido/)
  const accessory = await setup("Acessorio Sem Doc")
  await db.query("update public.materials set requires_vehicle_documentation = false where id = $1", [accessory.id])
  const { order, result: confirmed } = await confirmedOrder(accessory, 1)
  assert.equal((await docs(order)).length, 0)
  const e = await eligibility(order)
  assert.equal(e.documentation.required, false)
  assert.equal(e.eligible, true) // sem autorização exigida nesta rodada e sem exigência documental
  await startPo(confirmed.production_orders_created[0])
  // sem a regra documental da empresa, a produção também segue (a regra é da empresa; a lei continua valendo fora do sistema)
  await db.query("select public.sales_settings_update('{\"require_operational_authorization\": true}'::jsonb, 'Gerente')")
  const flows = (await all("select * from public.production_release_map()"))
  assert.ok(flows.every((f) => typeof f.eligible === "boolean"))
})
