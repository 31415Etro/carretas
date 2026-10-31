// Automação do formulário de emissão de NF-e do NFeMail (https://app.nfemail.com.br), com um navegador real.
// Mapa do portal (ASP.NET WebForms): painel -> /Gerenciamento -> "nova nf-e" -> /Emissao4 (abas Cabeçalho, Destinatário, Itens, Totais, Transporte, Inf. Adicionais, Cobrança).
// Destinatário novo: /CadastrosNfeClientesIncluir. Cancelamento: /Gerenciamento -> linha da nota -> "outras ações" -> "cancelar nota".
// Tudo aqui é chamado por emitir.mjs; "dry" (ensaio) preenche até os itens e NÃO salva nem transmite nada.
import fs from "node:fs"
import path from "node:path"

export const BASE = "https://app.nfemail.com.br"
const P = "#cphPainel_tab_NFe_tab_"
const digits = (value) => String(value ?? "").replace(/\D/g, "")
export const norm = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
const money = (value) => { const n = Number(String(value ?? "").replace(/[^\d,.-]/g, "").includes(",") ? String(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".") : String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0 }
const br = (n, places = 2) => n.toFixed(places).replace(".", ",")

/** Espera o postback assíncrono (UpdatePanel) terminar. */
export async function settle(page, extra = 500) {
  await page.waitForTimeout(extra)
  for (let i = 0; i < 80; i++) {
    const busy = await page.evaluate(() => { try { return Boolean(window.Sys && window.Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()) } catch { return false } }).catch(() => false)
    if (!busy) break
    await page.waitForTimeout(250)
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {})
  await page.waitForTimeout(300)
}

/** Clique real; se algo cobrir o botão (janela do portal), clica por script. */
export async function click(page, selector, { wait = 500 } = {}) {
  try { await page.click(selector, { timeout: 8000 }) } catch { await page.$eval(selector, (el) => el.click()) }
  await settle(page, wait)
}
async function text(page, selector, value) {
  await page.fill(selector, String(value ?? ""))
  await page.press(selector, "Tab").catch(() => {})
  await settle(page, 250)
}
async function pick(page, selector, value) {
  await page.selectOption(selector, String(value))
  await settle(page, 350)
}
const exists = (page, selector) => page.$(selector).then(Boolean)

/** Mensagens de erro/aviso visíveis no portal (faixa vermelha, validadores, avisos). */
export async function portalMessages(page) {
  return page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" }
    const out = new Set()
    for (const el of document.querySelectorAll("div, span, td, p, li")) {
      if (!visible(el) || el.children.length > 3) continue
      const t = (el.innerText || "").replace(/\s+/g, " ").trim()
      if (t.length < 8 || t.length > 400) continue
      if (/(obrigat|inv[aá]lid|rejei|n[aã]o foi poss|falha|erro|informe|preencha|ausente|n[aã]o autoriz|duplicidade|denegad)/i.test(t) && !/^(copiar|campos? obrigat[oó]rios?)$/i.test(t)) {
        const cls = String(el.className || "") + " " + String(el.parentElement?.className || "") + " " + String(el.id || "")
        if (/(erro|error|alert|danger|valid|mensag|notify|aviso|warn)/i.test(cls) || /^campo /i.test(t)) out.add(t)
      }
    }
    return [...out].slice(0, 6)
  }).catch(() => [])
}

async function snapshot(page, dir, name) {
  try { fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }) } catch { /* sem print */ }
}
async function guard(page, label, dir) {
  const messages = await portalMessages(page)
  if (messages.length) { await snapshot(page, dir, `erro-${Date.now()}`); throw new Error(`${label}: ${messages.join(" | ")}`) }
}

// ---------------------------------------------------------------- abertura

export async function openNewNfe(page) {
  await page.goto(`${BASE}/Gerenciamento`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#cphPainel_lbt_NovaNFe")
  await Promise.all([page.waitForURL("**/Emissao4", { timeout: 40_000 }), page.$eval("#cphPainel_lbt_NovaNFe", (el) => el.click())])
  await page.waitForSelector(`${P}Cab_ddl_CFOP_Padrao`, { state: "attached" })
  await settle(page, 800)
}
async function openTab(page, key) {
  await click(page, `#__tab_cphPainel_tab_NFe_tab_${key}`, { wait: 500 })
}

// ---------------------------------------------------------------- cabeçalho

export async function fillHeader(page, header) {
  await openTab(page, "Cab")
  if (header.cfop) await pick(page, `${P}Cab_ddl_CFOP_Padrao`, header.cfop)
  if (header.nature) await text(page, `${P}Cab_tbx_Cab_NaturezaOperacao`, header.nature)
  if (header.purpose) await pick(page, `${P}Cab_ddl_Cab_Finalidade`, header.purpose)
  if (header.finalConsumer) await pick(page, `${P}Cab_ddl_Cab_ConsumidorFinal`, header.finalConsumer)
  if (header.presence) await pick(page, `${P}Cab_ddl_Cab_PresencaComprador`, header.presence)
  if (header.issueDate) await text(page, `${P}Cab_tbx_Cab_DataEmissao`, header.issueDate)
}

// ---------------------------------------------------------------- destinatário

const formatDoc = (doc) => (doc.length === 14 ? doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"))

async function selectRecipientInNote(page, recipient) {
  const doc = digits(recipient.document)
  await openTab(page, "Dest")
  await click(page, `${P}Dest_imgbtn_Dest_Buscar`)
  await text(page, `${P}Dest_tbx_Destinario_Filtrar_CNPJ`, formatDoc(doc))
  await click(page, `${P}Dest_lbt_Dest_Filtrar`, { wait: 800 })
  for (let i = 0; i < 8; i++) {
    const link = await page.$(`${P}Dest_dtl_Dest_Buscar_lbt_Dest_Selecionar0_${i}`)
    if (!link) break
    if (digits(await link.innerText()) === doc) { await click(page, `${P}Dest_dtl_Dest_Buscar_imgbtn_Dest_Selecionar_${i}`, { wait: 900 }); return true }
  }
  await click(page, `${P}Dest_imgbtn_Dest_Cancelar`).catch(() => {})
  return false
}

/** Cadastra o destinatário no NFeMail (menu clientes) quando ele ainda não existe lá. */
async function registerRecipient(page, recipient, log) {
  const doc = digits(recipient.document)
  const T = "#cphPainel_tcr_Clientes_tpl_Dados_"
  log("Destinatário novo no NFeMail: cadastrando.")
  await page.goto(`${BASE}/CadastrosNfeClientesIncluir`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(`${T}rdl_Destinatario_Identificacao_0`)
  const kind = recipient.personType === "PF" ? 1 : recipient.personType === "PE" ? 2 : 0
  await click(page, `${T}rdl_Destinatario_Identificacao_${kind}`)
  if (kind === 0) { await text(page, `${T}tbx_Destinatario_CNPJ`, formatDoc(doc)); await text(page, `${T}tbx_Destinatario_RazaoSocial`, recipient.name) }
  else { await text(page, `${T}tbx_Destinatario_CPF`, formatDoc(doc)); await text(page, `${T}tbx_Destinatario_Nome`, recipient.name) }
  await text(page, `${T}tbx_CEP`, digits(recipient.zip).replace(/(\d{5})(\d{3})/, "$1-$2"))
  await text(page, `${T}tbx_Logradouro`, recipient.street)
  await text(page, `${T}tbx_LogradouroNumero`, recipient.number || "S/N")
  if (recipient.complement) await text(page, `${T}tbx_Complemento`, recipient.complement)
  await text(page, `${T}tbx_Bairro`, recipient.district)
  await selectByLabel(page, `${T}ddl_Estado`, recipient.state, "UF")
  await settle(page, 700)
  await selectByLabel(page, `${T}ddl_Cidade`, recipient.city, "cidade")
  if (await exists(page, `${T}ddl_Pais`)) await pick(page, `${T}ddl_Pais`, "1058")
  if (recipient.stateRegistration) await text(page, `${T}tbx_IE`, recipient.stateRegistration)
  await pick(page, `${T}ddl_IE_Indicador`, recipient.ieIndicator || "9")
  if (recipient.phone) await text(page, `${T}tbx_Telefone`, digits(recipient.phone))
  await click(page, `${T}lbt_Adicionar`, { wait: 1200 })
  await guard(page, "Cadastro do destinatário no NFeMail", "/tmp")
}

/** Seleciona uma opção pelo texto (sem acento, maiúsculas). */
async function selectByLabel(page, selector, label, what) {
  const wanted = norm(label)
  const options = await page.$$eval(`${selector} option`, (list) => list.map((o) => ({ value: o.value, text: o.textContent || "" })))
  const match = options.find((o) => norm(o.text) === wanted) || options.find((o) => norm(o.text).startsWith(wanted) && wanted.length > 2)
  if (!match) throw new Error(`NFeMail não tem ${what} "${label}" na lista.`)
  await pick(page, selector, match.value)
}

export async function fillRecipient(page, recipient, log) {
  let found = await selectRecipientInNote(page, recipient)
  if (!found) {
    await registerRecipient(page, recipient, log)
    await openNewNfe(page)
    found = await selectRecipientInNote(page, recipient)
    if (!found) throw new Error("O destinatário foi cadastrado no NFeMail, mas não apareceu na busca para selecionar.")
  }
  log("Destinatário selecionado.")
  if (recipient.email && (await exists(page, `${P}Dest_tbx_Dest_Email`))) await text(page, `${P}Dest_tbx_Dest_Email`, recipient.email)
  if (recipient.operationDestination) await pick(page, `${P}Dest_ddl_Dest_DestinoOperacao`, recipient.operationDestination)
}

// ---------------------------------------------------------------- itens

async function fillTax(page, group, tax, itemTotal) {
  // PIS/COFINS: situação tributária; base/alíquota/valor só se o campo estiver habilitado
  const prefix = `${P}Prod_tab_Trib_tab_Prod_${group}_`
  await click(page, `#__tab_cphPainel_tab_NFe_tab_Prod_tab_Trib_tab_Prod_${group}`)
  await pick(page, `${prefix}ddl_Prod_${group}_CST`, tax.cst)
  const base = `${prefix}tbx_Prod_${group}_ValorBaseCalculo`
  const rate = `${prefix}tbx_Prod_${group}_Aliquota`
  const value = `${prefix}tbx_Prod_${group}_Valor${group}`
  // a base só habilita depois do postback da situação tributária; se não habilitar, o tipo de cálculo "Percentual" é marcado de novo para forçar
  const enabled = () => page.waitForFunction((id) => { const el = document.querySelector(id); return el && !el.disabled }, base, { timeout: 3500 }).then(() => true).catch(() => false)
  let canFill = await enabled()
  if (!canFill) { await click(page, `${prefix}rbl_Prod_${group}_TipoCalculo_0`, { wait: 600 }).catch(() => {}); canFill = await enabled() }
  if (!canFill) {
    // situação sem base de cálculo (ex.: 49 no Simples): o portal ainda exige base quando "Percentual" está marcado; marca "Em valor" e zera o que habilitar
    await click(page, `${prefix}rbl_Prod_${group}_TipoCalculo_1`, { wait: 700 }).catch(() => {})
    for (const field of [`tbx_Prod_${group}_QtdVendida`, `tbx_Prod_${group}_AliquotaReais`, `tbx_Prod_${group}_Valor${group}`]) {
      if (await page.$eval(`${prefix}${field}`, (el) => !el.disabled).catch(() => false)) await text(page, `${prefix}${field}`, field.includes("QtdVendida") ? "0" : "0,00")
    }
  }
  if (canFill) {
    await text(page, base, br(money(tax.base) || itemTotal))
    await text(page, rate, br(money(tax.aliquota)))
    const amount = tax.valor !== "" && tax.valor != null ? money(tax.valor) : Math.round((money(tax.base) || itemTotal) * money(tax.aliquota)) / 100
    if (await page.$eval(value, (el) => !el.disabled).catch(() => false)) await text(page, value, br(amount))
  }
}

async function fillIcms(page, item, itemTotal) {
  const prefix = `${P}Prod_tab_Trib_tab_Prod_ICMS_`
  await click(page, "#__tab_cphPainel_tab_NFe_tab_Prod_tab_Trib_tab_Prod_ICMS")
  const simples = await page.$eval(`${prefix}rbl_Prod_ICMS_Regime_1`, (el) => el.checked).catch(() => false)
  if (!simples) throw new Error("Esta empresa está no regime normal no NFeMail: o preenchimento do ICMS normal ainda não foi mapeado (use o NFeMail direto ou fale com o suporte do sistema).")
  await pick(page, `${prefix}ddl_Prod_ICMS_SN_CST`, item.icms.cst)
  await pick(page, `${prefix}ddl_Prod_ICMS_SN_Origem`, item.origin || "0")
  if (item.icms.aliquota && (await page.$eval(`${prefix}tbx_Prod_ICMS_SN_AliquotaCC`, (el) => !el.disabled).catch(() => false))) await text(page, `${prefix}tbx_Prod_ICMS_SN_AliquotaCC`, br(money(item.icms.aliquota)))
  if (await page.$eval(`${prefix}tbx_Prod_ICMS_SN_Aliquota`, (el) => !el.disabled).catch(() => false) && item.icms.aliquota) {
    await text(page, `${prefix}tbx_Prod_ICMS_SN_ValorBaseCalculo`, br(money(item.icms.base) || itemTotal))
    await text(page, `${prefix}tbx_Prod_ICMS_SN_Aliquota`, br(money(item.icms.aliquota)))
    await text(page, `${prefix}tbx_Prod_ICMS_SN_ValorICMS`, br(item.icms.valor !== "" ? money(item.icms.valor) : (money(item.icms.base) || itemTotal) * money(item.icms.aliquota) / 100))
  }
}

export async function addItem(page, item, log, dir) {
  const total = Math.round(money(item.quantity) * money(item.unitPrice) * 100) / 100
  await openTab(page, "Prod")
  await click(page, `${P}Prod_lbt_Prod_Incluir_Novo`, { wait: 900 })
  await page.waitForSelector(`${P}Prod_ddl_Prod_CFOP`, { state: "visible", timeout: 20_000 })
  await pick(page, `${P}Prod_ddl_Prod_CFOP`, item.cfop)
  await text(page, `${P}Prod_tbx_Prod_Codigo`, item.code || "1")
  await text(page, `${P}Prod_tbx_Prod_Descricao`, item.description)
  await text(page, `${P}Prod_tbx_Prod_NCM`, digits(item.ncm))
  if (item.additionalInfo) await text(page, `${P}Prod_tbx_Prod_InfoAdicional`, item.additionalInfo)
  await text(page, `${P}Prod_tbx_Prod_Quantidade_Comercial`, String(money(item.quantity) || 1).replace(".", ","))
  await text(page, `${P}Prod_tbx_Prod_Valor_Unitario_Comercial`, br(money(item.unitPrice), 2))
  await text(page, `${P}Prod_tbx_Prod_Un_Comercial`, item.unit || "UN")
  await text(page, `${P}Prod_tbx_Prod_GTIN_EAN`, item.gtin || "SEM GTIN")
  await fillIcms(page, item, total)
  await fillTax(page, "PIS", item.pis, total)
  await fillTax(page, "COFINS", item.cofins, total)
  if (item.ipi?.cst) {
    await click(page, "#__tab_cphPainel_tab_NFe_tab_Prod_tab_Trib_tab_Prod_IPI")
    await pick(page, `${P}Prod_tab_Trib_tab_Prod_IPI_ddl_Prod_IPI_CST`, item.ipi.cst)
    const ipi = `${P}Prod_tab_Trib_tab_Prod_IPI_`
    if (await page.$eval(`${ipi}tbx_Prod_IPI_CodigoEnquadramento`, (el) => !el.disabled).catch(() => false)) await text(page, `${ipi}tbx_Prod_IPI_CodigoEnquadramento`, "999")
    if (await page.$eval(`${ipi}tbx_Prod_IPI_Aliquota`, (el) => !el.disabled).catch(() => false)) {
      await text(page, `${ipi}tbx_Prod_IPI_ValorBaseCalculo`, br(money(item.ipi.base) || total))
      await text(page, `${ipi}tbx_Prod_IPI_Aliquota`, br(money(item.ipi.aliquota)))
      await text(page, `${ipi}tbx_Prod_IPI_ValorIPI`, br(item.ipi.valor !== "" ? money(item.ipi.valor) : (money(item.ipi.base) || total) * money(item.ipi.aliquota) / 100))
    }
  }
  await click(page, `${P}Prod_lbt_Prod_Salvar`, { wait: 1200 })
  // salvou = voltou para a lista de itens (o formulário do item some)
  const stillOpen = await page.$eval(`${P}Prod_ddl_Prod_CFOP`, (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).catch(() => false)
  if (stillOpen) {
    const messages = await portalMessages(page)
    await snapshot(page, dir, `item-erro-${Date.now()}`)
    throw new Error(`Item "${item.description.slice(0, 40)}" não foi aceito pelo NFeMail${messages.length ? `: ${messages.join(" | ")}` : "."}`)
  }
  log(`Item incluído: ${item.description.slice(0, 50)}.`)
}

// ---------------------------------------------------------------- pagamento, transporte, informações

export async function fillPayment(page, payment, total, log, dir) {
  await openTab(page, "Cobranca")
  // o portal abre o quadro "Pagamentos" por um botão da aba; tenta os caminhos conhecidos
  const opener = await page.$(`${P}Cobranca_lbt_Pagamentos_Adicionar`)
  if (opener) await opener.evaluate((el) => el.click()).then(() => settle(page, 900))
  const form = `${P}Cobranca_ddl_Pagamento_IndicadorPagamento`
  if (!(await page.$eval(form, (el) => { const r = el.getBoundingClientRect(); return r.width > 0 }).catch(() => false))) {
    await snapshot(page, dir, `pagamento-${Date.now()}`)
    const controls = await page.$$eval("a, input, button, select", (nodes) => nodes.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /Cobranca/.test(n.id) }).map((n) => n.id.replace("cphPainel_tab_NFe_tab_Cobranca_", "") + (n.title ? `(${n.title.trim().slice(0, 30)})` : "") + ((n.innerText || "").trim() ? `[${(n.innerText || "").trim().slice(0, 25)}]` : ""))).catch(() => [])
    throw new Error(`Não achei o quadro de pagamento na aba Cobrança do NFeMail. Controles visíveis: ${controls.join(", ")}`)
  }
  await pick(page, form, payment.indicator)
  await pick(page, `${P}Cobranca_ddl_Pagamento_FormaPagamento`, payment.form)
  await text(page, `${P}Cobranca_tbx_Pagamento_ValorPagamento`, br(money(payment.value) || total))
  if (payment.description) await text(page, `${P}Cobranca_tbx_DescricaoPagamento`, payment.description)
  await click(page, `${P}Cobranca_lbt_Pagamentos_Salvar`, { wait: 1000 })
  await guard(page, "Pagamento", dir)
  log("Pagamento informado.")
}

export async function fillTransportAndInfo(page, transport, info) {
  await openTab(page, "Trans")
  if (transport?.mode) await pick(page, `${P}Trans_ddl_Trans_Modalidade`, transport.mode)
  if (info) { await openTab(page, "InfoAdicionais"); await text(page, `${P}InfoAdicionais_tbx_InfoAdicionais`, info) }
}

// ---------------------------------------------------------------- salvar, validar, transmitir

async function lastRow(page) {
  await page.goto(`${BASE}/Gerenciamento`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#cphPainel_dtl_Registros_lbl_Situacao_0", { timeout: 20_000 }).catch(() => {})
  return page.evaluate(() => {
    const row = (suffix) => document.querySelector(`#cphPainel_dtl_Registros_${suffix}_0`)
    const info = (row("lbl_CNPJ")?.innerText || "").replace(/\s+/g, " ")
    return { situation: (row("lbl_Situacao")?.innerText || "").trim(), info, number: (info.match(/N[úu]mero:\s*(\d+)/i) || [])[1] || "", key: (info.match(/Chave:\s*(\d{44})/) || [])[1] || "", series: (info.match(/S[ée]rie:\s*(\d+)/i) || [])[1] || "" }
  })
}

/** Salva, valida e transmite; devolve número/chave. Lança erro com o motivo do portal/SEFAZ se não autorizar. */
export async function saveAndTransmit(page, log, dir) {
  const number = await page.$eval(`${P}Cab_tbx_Cab_NumeroNF`, (el) => el.value).catch(() => "")
  await click(page, "#cphPainel_lbt_SalvarNota", { wait: 1500 })
  await guard(page, "Salvar NF-e", dir)
  log(`NF-e ${number} salva; validando.`)
  await click(page, "#cphPainel_lbt_ValidarNota", { wait: 2500 })
  await guard(page, "Validação da NF-e", dir)
  log("Validada; assinando e transmitindo.")
  await click(page, "#cphPainel_lbt_AssinarTransmitir", { wait: 3000 })
  const messages = await portalMessages(page)
  if (messages.length) { await snapshot(page, dir, `transmitir-${Date.now()}`); throw new Error(`Transmissão: ${messages.join(" | ")}`) }
  // aguarda a SEFAZ responder: a nota aparece como autorizada (ou rejeitada) na lista
  const deadline = Date.now() + 120_000
  let row = null
  while (Date.now() < deadline) {
    row = await lastRow(page)
    if (/autorizad/i.test(row.situation) && (!number || row.number === number)) return { number: row.number, series: row.series, accessKey: row.key }
    if (/rejeit|denegad/i.test(row.situation) && (!number || row.number === number)) throw new Error(`A SEFAZ rejeitou a nota ${row.number} (situação: ${row.situation}). Abra o NFeMail para ver o motivo detalhado.`)
    await page.waitForTimeout(5000)
  }
  throw new Error(`A nota ${number} não foi autorizada em 2 minutos (situação: ${row?.situation || "desconhecida"}). Confira no NFeMail antes de tentar de novo.`)
}

/** Baixa o XML da nota pela lista (botão "baixar xml" da linha). */
export async function downloadXml(page, accessKey, dir) {
  await page.goto(`${BASE}/Gerenciamento`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#cphPainel_dtl_Registros_ibt_Download_0")
  const rows = await page.$$eval("[id^='cphPainel_dtl_Registros_lbl_CNPJ_']", (list) => list.map((el) => ({ id: el.id, text: el.innerText })))
  const hit = rows.find((row) => row.text.replace(/\s+/g, " ").includes(accessKey))
  const index = hit ? hit.id.split("_").pop() : "0"
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 40_000 }), page.$eval(`#cphPainel_dtl_Registros_ibt_Download_${index}`, (el) => el.click())])
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${accessKey}.download`)
  await download.saveAs(target)
  return target
}

// ---------------------------------------------------------------- cancelamento

export async function cancelNote(page, { number, accessKey, reason }, log, dir) {
  await page.goto(`${BASE}/Gerenciamento`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#cphPainel_dtl_Registros_ibt_Acoes_0")
  // filtra pela numeração para achar a linha certa
  await click(page, "#cphPainel_Radiobtn_FiltroSelecaoNumero").catch(() => {})
  await text(page, "#cphPainel_tbx_FiltroNumeracaoInicial", number)
  await text(page, "#cphPainel_tbx_FiltroNumeracaoFinal", number)
  await click(page, "#cphPainel_lbt_FiltroBuscar", { wait: 1500 })
  const rows = await page.$$eval("[id^='cphPainel_dtl_Registros_lbl_CNPJ_']", (list) => list.map((el) => ({ id: el.id, text: el.innerText })))
  const hit = rows.find((row) => row.text.replace(/\s+/g, " ").includes(accessKey)) || rows.find((row) => new RegExp(`N[úu]mero:\\s*${number}\\b`, "i").test(row.text.replace(/\s+/g, " ")))
  if (!hit) throw new Error(`Não achei a nota ${number} na lista do NFeMail para cancelar.`)
  const index = hit.id.split("_").pop()
  await click(page, `#cphPainel_dtl_Registros_ibt_Acoes_${index}`)
  await click(page, `#cphPainel_dtl_Registros_lbt_Acao_Cancelar_${index}`, { wait: 1000 })
  await page.waitForSelector("#cphPainel_tbx_Cancelar_Motivo", { state: "visible", timeout: 15_000 })
  await text(page, "#cphPainel_tbx_Cancelar_Motivo", reason)
  await click(page, "#cphPainel_lbt_Cancelar_Sim", { wait: 3000 })
  const messages = await portalMessages(page)
  const denied = await page.$eval("#cphPainel_lbl_Cancelar_Negado", (el) => el.innerText.trim()).catch(() => "")
  if (denied) throw new Error(`Cancelamento negado: ${denied}`)
  if (messages.length) { await snapshot(page, dir, `cancelar-${Date.now()}`); throw new Error(`Cancelamento: ${messages.join(" | ")}`) }
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await page.goto(`${BASE}/Gerenciamento`, { waitUntil: "domcontentloaded" })
    const state = await page.evaluate((num) => {
      const rowsInfo = [...document.querySelectorAll("[id^='cphPainel_dtl_Registros_lbl_CNPJ_']")]
      for (const el of rowsInfo) {
        if (!new RegExp(`N[úu]mero:\\s*${num}\\b`, "i").test((el.innerText || "").replace(/\s+/g, " "))) continue
        const index = el.id.split("_").pop()
        return (document.querySelector(`#cphPainel_dtl_Registros_lbl_Situacao_${index}`)?.innerText || "").trim()
      }
      return ""
    }, number)
    if (/cancelad/i.test(state)) { log(`NF-e ${number} cancelada.`); return }
    await page.waitForTimeout(5000)
  }
  throw new Error(`O cancelamento da nota ${number} não foi confirmado em 90 segundos. Confira no NFeMail.`)
}
