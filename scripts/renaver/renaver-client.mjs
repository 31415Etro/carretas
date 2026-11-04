// Cliente do Renaver (https://renaver.absolutasolucoes.com.br/renaver/) usando um navegador real (Chrome).
// O Renaver é Wisej (a tela é desenhada pelo servidor e não há API): o robô age como uma pessoa, na tela.
// LER é o padrão. A única operação que muda algo no portal é enterZeroKm() com dry=false (Entrada de Zero KM), sempre para UM chassi por vez e só depois de
// conferir que o painel "Dados da Entrada" lista exatamente aquele chassi.
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright-core"

export const TABS = ["Pendentes de Entrada", "Em Estoque", "Em Transferência", "Saídas"]
export const digits = (value) => String(value || "").replace(/\D/g, "")
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const GRID_TOP = 232      // abaixo do cabeçalho da grade
const GRID_BOTTOM = 905   // acima da barra de botões
const CHECK_X = 242       // coluna do checkbox / seletor de linha

export async function openPortal({ headless = false } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless })
  const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(40_000)
  return { browser, context, page }
}

export const header = async (page) => {
  const text = await page.innerText("body").catch(() => "")
  const cnpj = /CNPJ:\s*([\d./-]+)/.exec(text)?.[1] || ""
  return { cnpj: digits(cnpj), text }
}

export async function login(page, url, email, password) {
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {})
  await page.waitForSelector("input[type=password]", { timeout: 30_000 })
  await page.locator("input[type=email], input[type=text]").first().fill(email)
  await page.locator("input[type=password]").first().fill(password)
  await page.keyboard.press("Enter")
  const until = Date.now() + 40_000
  while (Date.now() < until) {
    if ((await header(page)).cnpj) return
    await wait(1000)
  }
  throw new Error("Login no Renaver não concluiu (senha alterada ou portal fora do ar).")
}

/** Abre o menu "Veículos Montadora" e espera a grade. */
export async function openMontadora(page) {
  await page.getByText("Veículos Montadora", { exact: true }).click({ timeout: 20_000 }).catch(() => {
    throw new Error("O menu \"Veículos Montadora\" não apareceu: a empresa ativa não é a montadora.")
  })
  await wait(5000)
}

async function selectTab(page, tab) {
  await page.getByText(tab, { exact: true }).first().click()
  await wait(3000)
}

/** Linhas visíveis agora: [{ vin, cy, before: [textos à esquerda], after: [textos à direita] }], pela posição na tela (a grade só desenha o que cabe). */
async function visibleRows(page) {
  return page.evaluate(({ top, bottom }) => {
    const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
    const nodes = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || "").trim()
      const element = node.parentElement
      if (!text || !element || (element.checkVisibility && !element.checkVisibility())) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      nodes.push({ text, x: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 })
    }
    return nodes.filter((item) => VIN.test(item.text) && item.cy >= top && item.cy <= bottom).map((item) => {
      const row = nodes.filter((other) => other !== item && Math.abs(other.cy - item.cy) < 9).sort((a, b) => a.x - b.x)
      return { vin: item.text, cy: item.cy, before: row.filter((other) => other.x < item.x).map((other) => other.text), after: row.filter((other) => other.x > item.x).map((other) => other.text) }
    })
  }, { top: GRID_TOP, bottom: GRID_BOTTOM })
}

async function scrollGrid(page, delta) {
  await page.mouse.move(800, 600)
  await page.mouse.wheel(0, delta)
  await wait(700)
}

/** Lê TODAS as linhas da aba atual (rolando a grade até não aparecer chassi novo). */
export async function readTab(page, tab) {
  await selectTab(page, tab)
  await scrollGrid(page, -100000)
  const found = new Map()
  let idle = 0
  for (let round = 0; round < 80 && idle < 2; round += 1) {
    let added = 0
    for (const row of await visibleRows(page)) {
      if (found.has(row.vin)) continue
      added += 1
      found.set(row.vin, { tab, vin: row.vin, montadoraAt: row.before.filter((text) => /\d{2,4}[-/]\d{2}[-/]\d{2,4}/.test(text)).join(" ") || row.before.join(" "), status: row.after[0] || "", kind: row.after[1] || "" })
    }
    idle = added ? 0 : idle + 1
    await scrollGrid(page, 450)
  }
  await scrollGrid(page, -100000)
  return [...found.values()]
}

export async function readAll(page, log = () => {}) {
  const rows = []
  for (const tab of TABS) {
    const part = await readTab(page, tab)
    log(`${tab}: ${part.length} chassi(s).`)
    rows.push(...part)
  }
  return rows
}

async function openOptionsMenu(page) {
  const box = await page.getByText("OPÇÕES", { exact: true }).first().boundingBox()
  if (!box) throw new Error("Botão OPÇÕES não encontrado.")
  await page.mouse.click(box.x + box.width / 2 + 65, box.y + box.height / 2)
  await wait(1500)
}

/** Textos de chassi do painel "Dados da Entrada" (abaixo do título dele). */
async function dialogVins(page) {
  return page.evaluate(() => {
    const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
    const nodes = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || "").trim()
      const element = node.parentElement
      if (!text || !element || (element.checkVisibility && !element.checkVisibility())) continue
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0) continue
      // só conta o que está À VISTA: as linhas da grade que ficam atrás do painel também existem no DOM, mas o painel as cobre
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
      const top = document.elementFromPoint(cx, cy)
      nodes.push({ text, x: rect.left, top: rect.top, bottom: rect.bottom, covered: !top || !(element === top || element.contains(top) || top.contains(element)) })
    }
    const title = nodes.find((item) => item.text === "Dados da Entrada")
    const confirm = nodes.find((item) => item.text === "Confirmar")
    if (!title || !confirm) return null
    return nodes.filter((item) => VIN.test(item.text) && !item.covered && item.top > title.bottom && item.bottom < confirm.top).map((item) => item.text)
  })
}

/**
 * Entrada de Zero KM de UM chassi. Marca a linha, abre OPÇÕES > Entrada de Zero KM e CONFERE o painel antes de agir.
 * dry = true: fecha no "Cancelar" (ensaio, nada é enviado). dry = false: clica em "Confirmar".
 * Devolve { ok, message }: ok só diz que o portal aceitou o clique; quem confirma o sucesso é a leitura seguinte (o chassi sai de Pendentes de Entrada).
 */
export async function enterZeroKm(page, vin, { dry = true, shotDir = "" } = {}) {
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}-${vin}.png`) }).catch(() => {}) }
  await selectTab(page, "Pendentes de Entrada")
  await scrollGrid(page, -100000)
  let target = null
  for (let round = 0; round < 80 && !target; round += 1) {
    target = (await visibleRows(page)).find((row) => row.vin === vin) || null
    if (!target) await scrollGrid(page, 450)
  }
  if (!target) return { ok: false, message: "O chassi não está mais em Pendentes de Entrada." }
  await page.mouse.click(CHECK_X, target.cy)
  await wait(1200)
  await openOptionsMenu(page)
  await page.getByText("Entrada de Zero KM", { exact: true }).click({ timeout: 10_000 })
  await wait(3500)
  const listed = await dialogVins(page)
  await shot("painel")
  if (!listed) return { ok: false, message: "O painel \"Dados da Entrada\" não abriu (talvez o portal tenha avisado que nenhum chassi está marcado)." }
  if (listed.length !== 1 || listed[0] !== vin) {
    await page.getByText("Cancelar", { exact: true }).first().click().catch(() => {})
    return { ok: false, message: `O painel listou ${listed.length} chassi(s) (${listed.join(", ") || "nenhum"}) em vez de apenas ${vin}; nada foi enviado.` }
  }
  if (dry) {
    await page.getByText("Cancelar", { exact: true }).first().click()
    await wait(1500)
    return { ok: true, message: "Ensaio: o painel listou só o chassi certo; fechado em Cancelar, nada foi enviado." }
  }
  const before = (await page.innerText("body")).length
  await page.getByText("Confirmar", { exact: true }).first().click()
  await wait(5000)
  const body = await page.innerText("body")
  await shot("depois")
  const problem = /n[aã]o foi poss[ií]vel|erro|falha|rejeit/i.exec(body.slice(Math.max(0, before - 200)))
  await page.getByText(/^(OK|Ok|Fechar)$/).first().click({ timeout: 2500 }).catch(() => {})
  await wait(1500)
  return problem ? { ok: false, message: `O portal respondeu com "${problem[0]}" ao confirmar; confira o Renaver.` } : { ok: true, message: "Entrada de Zero KM confirmada no portal." }
}

export function loadEnv(dir) {
  for (const file of [path.join(dir, ".env.local"), path.join(process.cwd(), ".env.local")]) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  }
}
