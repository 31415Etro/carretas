// Baixa o ZIP de XMLs de um período pela API fiscal do WebControl, usando a SUA sessão (o token que o site grava no cookie depois que VOCÊ faz o login).
// O login em si (com captcha) é feito por você no navegador; este script não tenta entrar nem resolver captcha.
//
// Configuração (em .env.local, nunca vai para o Git):
//   WEBCONTROL_AUTH_HEADER=Authorization: Bearer SEU_TOKEN      (copie o nome e o valor do cabeçalho de qualquer chamada da API no DevTools > Rede)
//   (se o token vier por cookie: WEBCONTROL_COOKIE=nome=valor; outro=valor)
//   WEBCONTROL_ID_CADASTRO=ID_DA_EMPRESA_NO_WEBCONTROL           (o número que aparece na URL .../download/zip/{idCadastro}/...)
//
// Uso:
//   node scripts/webcontrol/baixar-notas.mjs --desde 2026-01-01 --ate 2026-09-30 --cnpj 21161569000109 [--formato yyyy-mm-dd|dd-mm-yyyy|ddmmyyyy] [--pasta C:\notas]
// Gera <pasta>/<cnpj>-entrada.zip. Depois importe só para a Contabilidade (sem financeiro):
//   node scripts/nfemail/sincronizar.mjs --contabil --zip <pasta> --empresa <cnpj> --desde 2026-01-01 --ate 2026-09-30
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
for (const file of [path.join(root, ".env.local")]) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
}
const args = process.argv.slice(2)
const option = (name, fallback = "") => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback }
const from = option("desde"), to = option("ate"), cnpj = option("cnpj").replace(/\D/g, ""), format = option("formato", "yyyy-mm-dd"), folder = option("pasta", path.join(root, "notas-baixadas"))
const header = process.env.WEBCONTROL_AUTH_HEADER || (process.env.WEBCONTROL_COOKIE ? `Cookie: ${process.env.WEBCONTROL_COOKIE}` : ""), id = process.env.WEBCONTROL_ID_CADASTRO || ""
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || cnpj.length !== 14) { console.error("Informe --desde AAAA-MM-DD --ate AAAA-MM-DD --cnpj (14 dígitos)."); process.exit(2) }
if (!header.includes(":") || !id) { console.error("Configure WEBCONTROL_AUTH_HEADER (ou WEBCONTROL_COOKIE) e WEBCONTROL_ID_CADASTRO no .env.local (veja o topo deste arquivo)."); process.exit(2) }
const fmt = (iso) => (format === "dd-mm-yyyy" ? iso.split("-").reverse().join("-") : format === "ddmmyyyy" ? iso.split("-").reverse().join("") : iso)
const [name, ...rest] = header.split(":")
const url = `https://api2.webcontrolempresas.com.br/api-notas/api/v1/download/zip/${encodeURIComponent(id)}/${fmt(from)}/${fmt(to)}`
console.log("Baixando:", url)
const response = await fetch(url, { headers: { [name.trim()]: rest.join(":").trim(), Accept: "application/zip,application/octet-stream,*/*" } })
if (!response.ok) { console.error(`O WebControl respondeu HTTP ${response.status}. Token vencido? Entre de novo no site e copie o cabeçalho atual.`); process.exit(1) }
const buffer = Buffer.from(await response.arrayBuffer())
if (buffer.length < 100 || buffer.subarray(0, 2).toString() !== "PK") { console.error("A resposta não é um ZIP:", buffer.subarray(0, 200).toString("utf8")); process.exit(1) }
fs.mkdirSync(folder, { recursive: true })
const target = path.join(folder, `${cnpj}-entrada.zip`)
fs.writeFileSync(target, buffer)
console.log(`ZIP salvo: ${target} (${(buffer.length / 1048576).toFixed(1)} MB)`)
