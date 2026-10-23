// Etapa 9: fotografias persistentes dos produtos (caminho definitivo, galeria, auditoria das referências antigas) e PDF do pedido versionado.
import test, { before } from "node:test"
import assert from "node:assert/strict"
import { createDatabase } from "./harness.mjs"

const COMPANY_A = "00000000-0000-4000-8000-000000000001"
const COMPANY_B = "39faf343-bd20-4074-b600-518faf4365ee"
let db

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const asCompany = async (id) => db.exec(`select set_config('request.headers', '{"x-system-company-id":"${id}","x-audit-actor-email":"foto@teste.com"}', false)`)
const rejects = async (sql, params, pattern) => assert.rejects(() => db.query(sql, params), (error) => (pattern ? pattern.test(error.message) : true), `esperava erro: ${sql.slice(0, 90)}`)
const rpc = async (name, payload) => (await one(`select public.${name}($1::jsonb) r`, [JSON.stringify(payload)])).r

async function product(name, photoUrl = null) {
  const sku = (await one("select public.next_item_sku('Materia-prima') s")).s
  const m = (await one("insert into public.materials (name, unit, item_type, internal_code, status, allows_sale, cost_price, average_cost, category) values ($1, 'UN', 'Materia-prima', $2, 'Ativo', false, 1, 1, 'Aço') returning id", [`MP ${name}`, sku])).id
  const k = (await rpc("kit_save", { name: `Kit ${name}`, components: [{ component_id: m, quantity: 1, unit: "UN", loss_percent: 0 }], activate: true })).kit_id
  const r = await rpc("product_save", { name, model: name.slice(0, 6), sale_price: 5000, allows_sale: true, unit: "UN", photo_url: photoUrl, structure: { kits: [{ kit_id: k, quantity: 1 }], activate: true } })
  return r.product_id
}
const add = (material, extra = {}) => rpc("product_photo_add", { material_id: material, bucket: "product-photos", path: `${material}/${Math.random().toString(36).slice(2)}.jpg`, mime_type: "image/jpeg", size_bytes: 1000, original_name: "foto.jpg", ...extra })
const photoUrl = async (material) => (await one("select photo_url from public.materials where id = $1", [material])).photo_url
const SUPA = "https://abc.supabase.co/storage/v1/object/public/catalog-files/2026-09/uuid-zagaia.jpg"
const saveProduct = (id, name, photo) => rpc("product_save", { product_id: id, name, model: name.slice(0, 6), sale_price: 5000, allows_sale: true, unit: "UN", photo_url: photo })

async function order() {
  const p = await product(`Ped ${Math.random().toString(36).slice(2, 6)}`)
  const snap = (await all("select * from public.product_quote_snapshot(array[$1::uuid])", [p]))[0]
  const quote = await one("insert into public.quotes (client_id, salesperson_id, valid_until, quote_type, status, items_subtotal, total_amount) values ((select id from public.clients limit 1), (select id from public.salespeople limit 1), current_date + 10, 'Produto', 'Aprovado', 5000, 5000) returning id")
  await db.query("insert into public.quote_items (quote_id, position, line_type, material_id, description, quantity, unit_price, catalog_price, unit_cost, total, bom_version_id, bom_version_number, lead_time_days, product_sku) values ($1, 0, 'Produto', $2, 'Carreta', 1, 5000, 5000, $3, 5000, $4, $5, 10, $6)",
    [quote.id, p, snap.est_cost, snap.bom_version_id, snap.bom_version, snap.sku])
  return (await one("select public.sales_order_from_quote($1::uuid) r", [quote.id])).r.sales_order_id
}

before(async () => {
  db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "226_fotografias_e_pedido_pdf.sql"] })
  await db.exec(`insert into public.system_companies (id, name, legal_name, trade_name) values ('${COMPANY_B}', 'Empresa B', 'Empresa B', 'Empresa B') on conflict do nothing`)
  await asCompany(COMPANY_A)
  await db.exec("insert into public.clients (name, type, document) values ('Cliente Teste', 'PJ', '12345678000195')")
  await db.exec("insert into public.salespeople (name) values ('Vendedor Teste')")
  await db.exec(`select public.sales_settings_update('{"require_documentation_before_production":false,"require_operational_authorization":false}'::jsonb, 'teste')`)
})

test("primeira foto vira principal, aponta para a URL estável e sobrevive ao formulário reenviar a URL antiga ou vazia", async () => {
  const p = await product("Foto Um", SUPA)
  const a = await add(p)
  assert.equal(a.is_main, true)
  assert.equal(await photoUrl(p), `/api/produtos/foto/${a.id}`)
  await saveProduct(p, "Foto Um", SUPA)
  assert.equal(await photoUrl(p), `/api/produtos/foto/${a.id}`)
  await saveProduct(p, "Foto Um", "")
  assert.equal(await photoUrl(p), `/api/produtos/foto/${a.id}`)
})

test("o caminho tem de ser definitivo: URL temporária, blob, data e caminho local são recusados", async () => {
  const p = await product("Foto Dois")
  for (const path of ["blob:http://localhost/abc", "data:image/png;base64,AAAA", "C:\\fotos\\a.jpg", "https://x.com/a.jpg"]) {
    await rejects("select public.product_photo_add($1::jsonb)", [JSON.stringify({ material_id: p, bucket: "product-photos", path })], /temporária|caminho/)
  }
  await rejects("select public.product_photo_add($1::jsonb)", [JSON.stringify({ material_id: p, bucket: "product-photos", path: "" })], /caminho/)
})

test("galeria: principal, adicionais, troca da principal, ordem e legenda", async () => {
  const p = await product("Galeria")
  const a = await add(p); const b = await add(p, { purpose: "detalhe", caption: "Cubo" }); const c = await add(p, { make_main: true })
  assert.equal(c.is_main, true)
  let list = (await one("select public.product_photo_list($1::uuid) l", [p])).l
  assert.equal(list.length, 3); assert.equal(list[0].id, c.id); assert.equal(list.filter((f) => f.is_main).length, 1)
  assert.equal(await photoUrl(p), `/api/produtos/foto/${c.id}`)
  await db.query("select public.product_photo_set_main($1::uuid)", [a.id])
  assert.equal(await photoUrl(p), `/api/produtos/foto/${a.id}`)
  await db.query("select public.product_photo_reorder($1::uuid, $2::uuid[])", [p, [c.id, b.id, a.id]])
  list = (await one("select public.product_photo_list($1::uuid) l", [p])).l
  assert.deepEqual(list.map((f) => f.id), [a.id, c.id, b.id])
  await rejects("select public.product_photo_reorder($1::uuid, $2::uuid[])", [p, [a.id, b.id]], /exatamente/)
  await db.query("select public.product_photo_update($1::uuid, $2::jsonb)", [b.id, JSON.stringify({ caption: "Cubo multifuro" })])
  assert.equal((await one("select caption from public.product_photos where id = $1", [b.id])).caption, "Cubo multifuro")
})

test("remoção controlada: exige motivo, não apaga o registro e promove a próxima como principal", async () => {
  const p = await product("Remocao")
  const a = await add(p); const b = await add(p)
  await rejects("select public.product_photo_remove($1::uuid, 'x')", [a.id], /motivo/)
  const r = (await one("select public.product_photo_remove($1::uuid, 'Foto errada do modelo', 'Gerente') r", [a.id])).r
  assert.equal(r.new_main, b.id)
  assert.equal(await photoUrl(p), `/api/produtos/foto/${b.id}`)
  assert.equal((await one("select status, removed_by from public.product_photos where id = $1", [a.id])).status, "Removida")
  await rejects("delete from public.product_photos where id = $1", [a.id], /não são apagadas/)
  await rejects("update public.product_photos set path = 'outro.jpg' where id = $1", [b.id], /não podem ser alterados/)
  await rejects("update public.product_photos set status = 'Disponivel' where id = $1", [a.id], /não volta/)
  await db.query("select public.product_photo_remove($1::uuid, 'Substituída por outra', 'Gerente')", [b.id])
  assert.equal(await photoUrl(p), null)
})

test("auditoria das fotos antigas: cataloga sem alterar o cadastro; temporárias ficam indisponíveis; arquivo ausente limpa a referência quebrada", async () => {
  const good = await product("Antiga Boa", SUPA)
  const lost = await product("Antiga Perdida", "https://abc.supabase.co/storage/v1/object/public/catalog-files/2026-08/sumiu.jpg")
  const blob = await product("Antiga Blob", "blob:http://localhost:3000/1234-abcd")
  const external = await product("Antiga Externa", "https://exemplo.com/foto.png")
  const result = (await one("select public.product_photos_backfill_legacy() r")).r
  assert.equal(Number(result.catalogued) >= 4, true)
  assert.equal(await photoUrl(good), SUPA)
  const row = async (m) => one("select * from public.product_photos where material_id = $1", [m])
  const g = await row(good)
  assert.equal(g.status, "Pendente de verificacao"); assert.equal(g.bucket, "catalog-files"); assert.equal(g.path, "2026-09/uuid-zagaia.jpg"); assert.equal(g.is_main, true)
  assert.equal((await row(blob)).status, "Indisponivel")
  assert.equal((await row(external)).path, null)
  assert.equal(Number((await one("select public.product_photos_backfill_legacy() r")).r.catalogued), 0)
  assert.equal(Number((await one("select count(*) n from public.product_photos where material_id = $1", [good])).n), 1)
  await db.query("select public.product_photo_mark($1::uuid, 'Disponivel', 'Arquivo encontrado')", [g.id])
  assert.equal(await photoUrl(good), `/api/produtos/foto/${g.id}`)
  const l = await row(lost)
  await db.query("select public.product_photo_mark($1::uuid, 'Indisponivel', 'Arquivo não existe no armazenamento')", [l.id])
  assert.equal(await photoUrl(lost), null)
  assert.equal((await row(lost)).legacy_url.includes("sumiu.jpg"), true)
  const fresh = await add(lost)
  assert.equal(await photoUrl(lost), `/api/produtos/foto/${fresh.id}`)
  assert.equal(Number((await one("select count(*) n from public.product_photos where material_id = $1", [lost])).n), 2)
})

test("foto para documento: usa a escolhida do produto ou a principal; indisponível nunca entra", async () => {
  const p = await product("Para PDF")
  const a = await add(p); const b = await add(p, { purpose: "configuracao" })
  assert.equal((await one("select public.product_photo_for_document($1::uuid) f", [p])).f.id, a.id)
  assert.equal((await one("select public.product_photo_for_document($1::uuid, $2::uuid) f", [p, b.id])).f.id, b.id)
  const other = await product("Outro")
  assert.equal((await one("select public.product_photo_for_document($1::uuid, $2::uuid) f", [other, b.id])).f, null)
  await db.query("select public.product_photo_mark($1::uuid, 'Indisponivel', 'sumiu')", [b.id])
  assert.equal((await one("select public.product_photo_for_document($1::uuid, $2::uuid) f", [p, b.id])).f, null)
})

test("PDF do pedido: versões imutáveis, motivo para nova versão, conversão repetida não duplica e outra empresa não vê", async () => {
  const o = await order()
  const base = { file_bucket: "sales-documents", file_path: `${o}/v1.pdf`, file_name: "pedido.pdf", size_bytes: 12345, sha256: "abc", photo_refs: [{ photo_id: null, problem: "sem foto" }], configuration_refs: [] }
  const reg = (payload) => one("select public.sales_order_document_register($1::uuid, $2::jsonb, 'Vendedor') r", [o, JSON.stringify(payload)]).then((row) => row.r)
  const v1 = await reg({ ...base, trigger_source: "conversao" })
  assert.equal(v1.version, 1)
  assert.equal((await reg({ ...base, trigger_source: "conversao" })).duplicate, true)
  await rejects("select public.sales_order_document_register($1::uuid, $2::jsonb)", [o, JSON.stringify({ ...base, file_path: `${o}/v2.pdf` })], /motivo/)
  const v2 = await reg({ ...base, file_path: `${o}/v2.pdf`, reason: "Cliente trocou o acabamento" })
  assert.equal(v2.version, 2)
  await rejects("update public.sales_order_documents set file_path = 'x' where sales_order_id = $1", [o], /não pode ser alterado/)
  await rejects("delete from public.sales_order_documents where sales_order_id = $1", [o], /não pode ser alterado/)
  const list = (await one("select public.sales_order_document_list($1::uuid) l", [o])).l
  assert.deepEqual(list.map((d) => d.version), [2, 1])
  assert.equal((await one("select public.sales_order_document_get($1::uuid, 1) d", [o])).d.file_path, `${o}/v1.pdf`)
  await asCompany(COMPANY_B)
  assert.deepEqual((await one("select public.sales_order_document_list($1::uuid) l", [o])).l, [])
  await rejects("select public.sales_order_document_register($1::uuid, $2::jsonb)", [o, JSON.stringify({ ...base, trigger_source: "manual" })], /não encontrado/)
  await asCompany(COMPANY_A)
})
