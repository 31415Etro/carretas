// Confere se cada chamada RPC do código usa funções e nomes de parâmetros que existem no banco (PGlite com 217 a 229).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createDatabase } from "./harness.mjs"

const REPO = (process.env.RPC_CHECK_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")).replace(/[\/]*$/, "/")
const db = await createDatabase({ extra: ["217_itens_estrutura.sql", "218_kits_e_estrutura_de_produto.sql", "219_vendas_producao_mrp.sql", "220_materia_prima_consultas.sql", "221_kits_consultas_e_conversao.sql", "222_produtos_finais.sql", "223_pedido_producao_integracao.sql", "224_documentacao_veicular.sql", "225_engenharia_parametrica.sql", "226_fotografias_e_pedido_pdf.sql", "227_chao_de_fabrica.sql", "228_matricula_ordem_e_documentacao_avulsas.sql", "229_esteira_sem_impedimentos.sql", "234_producao_simplificada.sql", "235_vinculos_pedido_ordem_kits.sql"] })
const sigs = new Map()
for (const row of (await db.query(`select p.proname, coalesce(array_agg(a.n order by a.i) filter (where a.n is not null), '{}') args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  left join lateral unnest(p.proargnames) with ordinality as a(n, i) on true group by p.oid, p.proname`)).rows) sigs.set(row.proname, row.args)

let problems = 0, checked = 0
for (const file of ["lib/sales-server.ts", "lib/products-server.ts", "lib/quotes-server.ts", "lib/kits-server.ts", "lib/vehicle-documentation-server.ts", "lib/engineering-server.ts", "lib/product-photos-server.ts", "lib/sales-pdf-server.ts", "lib/shop-floor-server.ts"]) {
  const text = fs.readFileSync(REPO + file, "utf8")
  // rpc(admin, "nome", { a, b: x })  ou  admin.rpc("nome", { ... })
  const re = /(?:rpc(?:<[^(\n]*>)?\(admin, |admin\.rpc\()"([a-z_0-9]+)"(?:, \{(.*)\})?/g
  for (const m of text.matchAll(re)) {
    const [, name, body] = m
    checked++
    const known = sigs.get(name)
    if (!known) { console.log(`✗ ${file}: função inexistente ${name}`); problems++; continue }
    const used = (body || "").split(",").map((part) => part.trim().split(":")[0].trim()).filter((key) => /^p(_\w+)?$/.test(key) || key.startsWith("p_"))
    for (const key of used) if (!known.includes(key)) { console.log(`✗ ${file}: ${name} não tem o parâmetro ${key} (tem: ${known.join(", ")})`); problems++ }
  }
}
console.log(`${checked} chamadas verificadas:`, problems ? `${problems} problema(s)` : "todas conferem com o banco")
process.exit(problems ? 1 : 0)
