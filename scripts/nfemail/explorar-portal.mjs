// Exploração interativa do NFeMail: executa passos de um arquivo JSON e, em cada "dump", lista só os campos VISÍVEIS da tela e guarda um print.
// Nunca usa "assinar e transmitir". Uso: node portal-steps.mjs passos.json   (EMPRESA_INDEX escolhe a empresa)
import fs from "node:fs"
import path from "node:path"
import { login, openPortal, selectCompany } from "./nfemail-client.mjs"

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
}
const out = process.env.OUT || "/root/mig/nfemail-explore"
fs.mkdirSync(out, { recursive: true })
const steps = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const portal = await openPortal({ headless: false })
const { page } = portal
page.setDefaultTimeout(30_000)

async function dump(name, only = "") {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
  const fields = await page.$$eval("input, select, textarea, a, button", (nodes) => {
    const visible = (n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" }
    const text = (n) => (n.innerText || n.value || n.title || "").replace(/\s+/g, " ").trim().slice(0, 50)
    return nodes.filter(visible).filter((n) => !(n.tagName === "INPUT" && n.type === "hidden")).map((n) => {
      const tag = n.tagName.toLowerCase()
      let label = ""
      if (tag === "input" || tag === "select" || tag === "textarea") {
        label = (n.id && document.querySelector("label[for='" + n.id + "']")?.innerText) || ""
        if (!label) { let p = n.previousElementSibling; label = p ? (p.innerText || "").trim() : ""; if (!label && n.parentElement) label = (n.parentElement.innerText || "").split("\n")[0] }
      }
      return [tag + (n.type ? ":" + n.type : ""), n.id.replace("cphPainel_", ""), (label || text(n)).replace(/\s+/g, " ").trim().slice(0, 45), tag === "select" ? [...n.options].slice(0, 25).map((o) => o.value + "=" + o.text.trim().slice(0, 30)).join(" ; ") : (tag === "input" || tag === "textarea") ? (n.value || "").slice(0, 25) : ""]
    })
  })
  const shown = fields.filter((f) => !only || f[1].includes(only))
  console.log(`--- DUMP ${name}: ${page.url()} (${shown.length}/${fields.length} visíveis)`)
  for (const f of shown) console.log(f.filter((x) => x !== "").join(" | "))
}

try {
  await login(page, process.env.NFEMAIL_EMAIL, process.env.NFEMAIL_PASSWORD)
  await selectCompany(page, Number(process.env.EMPRESA_INDEX || 0))
  await page.goto("https://app.nfemail.com.br/Gerenciamento", { waitUntil: "domcontentloaded" })
  for (const step of steps) {
    if (step.open) { await page.goto(`https://app.nfemail.com.br/${step.open}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); continue }
    if (step.dump) { await dump(step.dump, step.only || ""); continue }
    if (step.pclick) { await page.click(step.pclick); await page.waitForTimeout(step.after ?? 2500); continue }
    if (step.wait) { await page.waitForTimeout(step.wait); continue }
    const sel = step.sel
    if (step.click) { await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), page.$eval(step.click, (el) => el.click())]); await page.waitForTimeout(step.after ?? 2500); continue }
    if (step.fill) { await page.fill(step.fill, String(step.val)); continue }
    if (step.type) { await page.click(step.type); await page.keyboard.type(String(step.val), { delay: 60 }); await page.waitForTimeout(step.after ?? 1500); continue }
    if (step.select) { await page.selectOption(step.select, step.val); await page.waitForTimeout(step.after ?? 1500); continue }
    if (step.eval) { console.log("EVAL:", JSON.stringify(await page.evaluate(step.eval))); continue }
  }
} catch (error) {
  console.log("ERRO:", error.message)
  try { await page.screenshot({ path: path.join(out, "erro.png"), fullPage: true }) } catch {}
} finally { await portal.browser.close() }
