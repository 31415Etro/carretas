// Etapa 18: cadastros sem travas. Kit, matéria-prima e produto só precisam de nome; fiscal, preço, NCM e estrutura são opcionais.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

let db
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r
const rawMaterial = async (name, extra = "") => (await one(`insert into public.materials (name, unit, item_type, status, controls_stock${extra ? ", " + extra.split("|")[0] : ""}) values ($1, 'UN', 'Materia-prima', 'Ativo', true${extra ? ", " + extra.split("|")[1] : ""}) returning *`, [name]))

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql", "235_vinculos_pedido_ordem_kits.sql", "237_baixa_dos_kits_no_pedido.sql", "238_cadastros_sem_travas.sql"] })
})

test("matéria-prima: venda sem preço vira consumo interno e NCM incompleto é ignorado (nada bloqueia o cadastro)", async () => {
  const sale = await rawMaterial("Sem preço", "allows_sale, sale_price|true, 0")
  assert.equal(sale.allows_sale, false)
  const badNcm = await rawMaterial("NCM torto", "ncm|'1234'")
  assert.equal(badNcm.ncm, null)
  const goodNcm = await rawMaterial("NCM bom", "ncm|'7216.21.00'")
  assert.ok(goodNcm.id)
  const priced = await rawMaterial("Com preço", "allows_sale, sale_price, ncm|true, 25, '72162100'")
  assert.equal(priced.allows_sale, true)
})

test("kit: nome basta; sem matéria-prima salva como rascunho vazio, não ativa, e a composição entra depois", async () => {
  const empty = await rpc("kit_save", { name: "K", components: [] })
  assert.ok(empty.kit_id)
  assert.equal(empty.version_id, null)
  const noList = await rpc("kit_save", { name: "Kit sem lista" })
  assert.ok(noList.kit_id)
  const mp = (await rawMaterial("MP do kit")).id
  const filled = await rpc("kit_save", { kit_id: empty.kit_id, name: "K", components: [{ component_id: mp, quantity: 2, unit: "UN", loss_percent: 0 }] })
  assert.ok(filled.version_id)
  // esvaziar o rascunho remove a composição em vez de recusar
  await rpc("kit_save", { kit_id: empty.kit_id, version_id: filled.version_id, name: "K", components: [] })
  assert.equal(Number((await one("select count(*) n from public.kit_components where kit_version_id = $1", [filled.version_id])).n), 0)
  // kit nunca tem preço de venda: o valor é zerado em vez de recusar
  const kit = await one("update public.materials set sale_price = 10 where id = $1 returning sale_price", [empty.kit_id])
  assert.equal(Number(kit.sale_price), 0)
})

test("produto: só o nome; sem preço não fica à venda, NCM sem confirmação é guardado e inválido é ignorado", async () => {
  const bare = await rpc("product_save", { name: "P" })
  assert.ok(bare.product_id)
  const row = await one("select allows_sale, ncm from public.materials where id = $1", [bare.product_id])
  assert.equal(row.allows_sale, false)
  const withNcm = await rpc("product_save", { name: "Produto NCM", sale_price: 100, ncm: "8716.39.00", ncm_confirmed: false })
  assert.equal((await one("select ncm from public.materials where id = $1", [withNcm.product_id])).ncm, "87163900")
  const badNcm = await rpc("product_save", { name: "Produto NCM torto", sale_price: 100, ncm: "8716" })
  assert.equal((await one("select ncm from public.materials where id = $1", [badNcm.product_id])).ncm, null)
})

test("produto: estrutura opcional; sem kits só cadastra, kit repetido conta uma vez e kit sem versão ativa pode ser vinculado", async () => {
  const none = await rpc("product_save", { name: "Sem estrutura", structure: { kits: [] } })
  assert.equal(none.version_id, null)
  const kit = (await rpc("kit_save", { name: "Kit rascunho", components: [] })).kit_id
  const linked = await rpc("product_save", { name: "Com kit rascunho", structure: { kits: [{ kit_id: kit, quantity: 0 }, { kit_id: kit, quantity: 3 }] } })
  assert.ok(linked.version_id)
  const links = (await db.query("select quantity from public.product_kits where bom_version_id = $1", [linked.version_id])).rows
  assert.equal(links.length, 1)
  assert.equal(Number(links[0].quantity), 1)                                       // quantidade vazia/zero vira 1
})
