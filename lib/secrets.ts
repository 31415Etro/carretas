// Cifra de segredos guardados no banco (senha do certificado digital etc.): AES-256-GCM com a chave
// CONFIG_ENCRYPTION_KEY (32 bytes em hexadecimal ou base64), que fica só no servidor.
// Gerar uma chave: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function key() {
  const raw = String(process.env.CONFIG_ENCRYPTION_KEY || "").trim()
  if (!raw) return null
  const buffer = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")
  return buffer.length === 32 ? buffer : null
}

export const secretsConfigured = () => key() !== null

export function encryptSecret(plain: string) {
  const secret = key()
  if (!secret) throw new Error("Defina CONFIG_ENCRYPTION_KEY (32 bytes) no servidor para guardar senhas e segredos com segurança.")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", secret, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":")
}

export function decryptSecret(token: string) {
  const secret = key()
  if (!secret) throw new Error("CONFIG_ENCRYPTION_KEY não configurada.")
  const [version, iv, tag, data] = String(token || "").split(":")
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato inválido.")
  const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
}
