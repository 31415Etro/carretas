// Sobe um Postgres local (PGlite), aplica o stub do Supabase e as migrações do ERP na ordem. Usado pelos testes de SQL.
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const scripts = path.resolve(here, "..")
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8")

export const BASE_BUNDLES = ["01_base_sistema_e_perfis.sql", "02_base_financeiro_asaas_multiempresa.sql", "03_erp_200_a_206.sql", "04_erp_207_a_211.sql", "05_erp_212_a_215_e_buckets.sql", "06_erp_216_importacao_nf.sql"]

export async function createDatabase({ upTo = BASE_BUNDLES.length, extra = [] } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(read(here, "stub-supabase.sql"))
  for (const file of BASE_BUNDLES.slice(0, upTo)) {
    try {
      await db.exec(read(scripts, "supabase", file))
    } catch (error) {
      throw new Error(`Falha em supabase/${file}: ${error.message}`)
    }
  }
  for (const file of extra) {
    try {
      await db.exec(read(scripts, file))
    } catch (error) {
      throw new Error(`Falha em ${file}: ${error.message}`)
    }
  }
  return db
}
