import assert from "node:assert/strict"
import test from "node:test"

import { decryptSecret, encryptSecret, secretsConfigured } from "./secrets.ts"

test("cifra e decifra com a chave do servidor; sem chave não grava", () => {
  const previous = process.env.CONFIG_ENCRYPTION_KEY
  delete process.env.CONFIG_ENCRYPTION_KEY
  assert.equal(secretsConfigured(), false)
  assert.throws(() => encryptSecret("senha"), /CONFIG_ENCRYPTION_KEY/)

  process.env.CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  assert.equal(secretsConfigured(), true)
  const token = encryptSecret("minha-senha-do-certificado")
  assert.ok(token.startsWith("v1:"))
  assert.ok(!token.includes("minha-senha"))
  assert.equal(decryptSecret(token), "minha-senha-do-certificado")
  assert.notEqual(encryptSecret("x"), encryptSecret("x")) // IV aleatório

  // adulteração é detectada
  const parts = token.split(":")
  parts[3] = Buffer.from("outro conteudo").toString("base64")
  assert.throws(() => decryptSecret(parts.join(":")))

  process.env.CONFIG_ENCRYPTION_KEY = "chave-curta"
  assert.equal(secretsConfigured(), false)
  if (previous === undefined) delete process.env.CONFIG_ENCRYPTION_KEY
  else process.env.CONFIG_ENCRYPTION_KEY = previous
})
