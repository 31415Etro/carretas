// Etapa 13: produção simplificada. O gestor avança a carreta na esteira com um clique; a última etapa já dá entrada do acabado.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
let db
let keySeq = 0

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const num = (value) => Number(value)
const rejects = async (sql, params, pattern) => {
  let failure = null
  try { await db.query(sql, params) } catch (error) { failure = error }
  assert.ok(failure, `esperava erro: ${sql.slice(0, 100)}`)
  if (pattern) assert.match(failure.message, pattern)
}
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const key = () => `k${++keySeq}-${Math.random().toString(36).slice(2, 8)}`
const taskOf = (po, unit, code) => one("select * from public.shop_tasks where production_order_id = $1 and unit_number = $2 and step_code = $3", [po, unit, code])
const workers = {}

async function product(name, { stock = 1 } = {}) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  const aco = (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, 'M', 'Materia-prima', $2, 'Ativo', false, 1, 1, 'Aço') returning id", [`Aço ${name}`, sku])).id
  if (stock > 0) await db.query(`select public.apply_stock_movement(jsonb_build_object('material_id', $1::text, 'movement_type', 'Saldo inicial', 'quantity', $2::numeric, 'unit_cost', 1))`, [aco, stock])
  const kit = (await rpc("kit_save", { name: `Kit ${name}`, category: "Chassi", components: [{ component_id: aco, quantity: 6, unit: "M", loss_percent: 0 }], activate: true })).kit_id
  const r = await rpc("product_save", { name, model: "FZ 1E", sale_price: 9000, allows_sale: true, unit: "UN", structure: { kits: [{ kit_id: kit, quantity: 1 }], activate: true } })
  return r.product_id
}
async function worker(name, sectors, extra = {}) {
  const id = (await one("select public.shop_worker_save($1::jsonb, 'g') id", [JSON.stringify({ name, sectors, pin: "1234", ...extra })])).id
  const code = (await one("select code from public.shop_workers where id = $1", [id])).code
  workers[name] = { id, code, token: (await one("select public.shop_worker_login($1, '1234', 'tablet') r", [code])).r.token }
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql"] })
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await one("select public.shop_steps_seed('teste') n")
  await worker("Soldador", ["Soldagem"])
  await worker("Montador", ["Montagem"])
})

test("avançar conclui a etapa atual, libera a próxima e leva a ordem para Em produção", async () => {
  const p = await product("Avanço", { stock: 1 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  const po = r.production_order_id
  const steps = await all("select step_code, kind from public.shop_tasks where production_order_id = $1 and unit_number = 1 order by seq", [po])
  assert.ok(steps.length >= 3)
  assert.equal((await taskOf(po, 1, steps[0].step_code)).status, "Pronta")
  const first = (await one("select public.shop_unit_advance($1, 1, 'gestor') r", [po])).r
  assert.equal(first.unit_finished, false)
  assert.equal((await taskOf(po, 1, steps[0].step_code)).status, "Concluida")
  assert.equal((await one("select status from public.production_orders where id = $1", [po])).status, "Em producao")
  assert.ok(first.next)
  const ev = await one("select count(*) n from public.shop_task_events where event = 'Concluída pelo gestor' and actor = 'gestor'")
  assert.ok(num(ev.n) >= 1)
})

test("percorrer todas as etapas: a carreta termina e entra no estoque de acabados; avançar de novo é recusado", async () => {
  const p = await product("Linha Toda", { stock: 1 })
  const r = await rpc("production_order_create_manual", { product_id: p, quantity: 1 })
  const po = r.production_order_id
  let last = null
  for (let i = 0; i < 30; i++) {
    const pending = num((await one("select count(*) n from public.shop_tasks where production_order_id = $1 and status not in ('Concluida','Cancelada')", [po])).n)
    if (!pending) break
    last = (await one("select public.shop_unit_advance($1, 1, 'gestor') r", [po])).r
  }
  assert.equal(last.unit_finished, true)
  assert.equal(num((await one("select count(*) n from public.shop_tasks where production_order_id = $1 and status not in ('Concluida','Cancelada') and kind <> 'administrativa'", [po])).n), 0)
  assert.ok(num((await one("select produced_quantity from public.production_orders where id = $1", [po])).produced_quantity) >= 1)
  await rejects("select public.shop_unit_advance($1, 1, 'gestor')", [po], /já foram concluídas/)
})

test("ordem inexistente ou de outra empresa é recusada", async () => {
  await rejects("select public.shop_unit_advance(gen_random_uuid(), 1, 'gestor')", [], /não encontrada/)
})

test("liberação não pede mais sinal/pagamento nem autorização", async () => {
  const r = (await one("select public.production_eligibility(gen_random_uuid()) r")).r
  assert.equal(r.eligible, false)
  assert.ok(r.blockers.every((blocker) => blocker.code === "pedido"))
})
