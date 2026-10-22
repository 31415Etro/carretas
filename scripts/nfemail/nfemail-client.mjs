// Cliente do portal NFeMail (https://app.nfemail.com.br) usando um navegador real (Chrome).
// O login do portal exige reCAPTCHA Enterprise: o script abre o Chrome como uma pessoa abriria e NÃO tenta burlar o captcha.
// Só LÊ e baixa XMLs (consulta de notas). Nunca emite, altera ou exclui nada no portal.
import { chromium } from "playwright-core"

const BASE = "https://app.nfemail.com.br"
export const onlyDigits = (value) => String(value || "").replace(/\D/g, "")

export async function openPortal({ headless = false } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless })
  const context = await browser.newContext({ locale: "pt-BR", acceptDownloads: true, viewport: { width: 1400, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  return { browser, context, page }
}

export async function login(page, email, password) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
  await page.fill(".inputEmail", email)
  await page.fill(".inputSenha", password)
  await page.click("#btnLogin")
  try {
    await page.waitForURL("**/Logado", { timeout: 40_000 })
  } catch {
    throw new Error("Login no NFeMail não concluiu (senha alterada ou reCAPTCHA recusou). Abra o portal manualmente e confira.")
  }
}

/** Empresas do login: [{ index, name, cnpj }]. */
export async function listCompanies(page) {
  await page.goto(`${BASE}/Logado`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("[id^='cphPainel_dtl_Empresas_Buscar_tr_']", { state: "attached" })
  return page.$$eval("[id^='cphPainel_dtl_Empresas_Buscar_tr_']", (rows) =>
    rows.map((row, index) => {
      const text = (row.innerText || "").replace(/\s+/g, " ")
      const match = text.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)
      return { index, name: text.replace(/empresa selecionada/i, "").trim().slice(0, 90), cnpj: match ? match[1].replace(/\D/g, "") : "" }
    }),
  )
}

export async function selectCompany(page, index) {
  await page.goto(`${BASE}/Logado`, { waitUntil: "domcontentloaded" })
  // a lista fica oculta atrás de avisos do portal: clica no link por script, sem depender de ele estar visível
  const link = `#cphPainel_dtl_Empresas_Buscar_lbt_Empresas_Selecionar0_${index}`
  await Promise.all([page.waitForLoadState("domcontentloaded"), page.$eval(link, (el) => el.click())])
  await page.waitForTimeout(1500)
}

const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Baixa um ZIP só com XMLs da empresa corrente. tipo: "entrada" | "saida". Datas ISO (yyyy-mm-dd). Retorna o caminho do ZIP ou null (sem notas). */
export async function downloadXmlZip(page, { tipo, from, to, by = "recepcao", target }) {
  await page.goto(`${BASE}/ConsultaNF`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#cphPainel_tbx_PeriodoInicial")
  await page.check(by === "emissao" ? "#cphPainel_rdl_Data_0" : "#cphPainel_rdl_Data_1")
  await page.fill("#cphPainel_tbx_PeriodoInicial", br(from))
  await page.fill("#cphPainel_tbx_PeriodoFinal", br(to))
  await page.check(tipo === "entrada" ? "#cphPainel_rdl_Tipo_1" : "#cphPainel_rdl_Tipo_2")
  await page.check("#cphPainel_Radiobtn_Destino_2") // ZIP (apenas XML)
  const downloading = page.waitForEvent("download", { timeout: 90_000 }).catch(() => null)
  await page.click("#cphPainel_lbt_Exibir")
  const download = await downloading
  if (!download) return null
  await download.saveAs(target)
  return target
}
