import { randomBytes, randomUUID } from "node:crypto"
import { audit } from "@/lib/audit"
import type { createAdminClient } from "@/lib/supabase/server"
import { categorizeReceipt, parseReceiptText } from "@/lib/receipt-ocr"
import { canCancelAdvance, canFinalize, canUpload, needsSettlementChoice, summarizeAdvance, summarizeCategories, validateCategoryBudgets, type CategoryBudgets, type SettlementAction } from "@/lib/travel-advance"

type Admin = ReturnType<typeof createAdminClient>
export const ADVANCE_MIGRATION_HINT = "Antecipação de reembolso para viagem ainda não instalado no banco. Rode scripts/217_orcamento_viagem.sql no SQL Editor do Supabase."
const BUCKET = "comprovantes-viagem"
const MAX_PHOTO_BYTES = 12 * 1024 * 1024

export type BankSnapshot = { bankName: string; bankAgency: string; bankAccount: string; bankAccountType: string; pixKey: string }

const isMissing = (message: string) => /does not exist|Could not find|schema cache/i.test(message)
export function advanceError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  return isMissing(message) && /travel_advance/i.test(message) ? new Error(ADVANCE_MIGRATION_HINT) : new Error(message)
}

function newToken() {
  return randomBytes(18).toString("base64url")
}

export async function listEmployeeOptions(admin: Admin) {
  const columns = "id,full_name,email,bank_name,bank_agency,bank_account,bank_account_type,pix_key"
  let result: { data: Array<Record<string, any>> | null; error: { message: string } | null } = await admin.from("profiles").select(`${columns},cpf`).eq("active", true).neq("role", "client").order("full_name")
  if (result.error && /cpf/.test(result.error.message)) result = await admin.from("profiles").select(columns).eq("active", true).neq("role", "client").order("full_name") // script 239 ainda não rodou
  const { data, error } = result
  if (error) throw error
  return (data || []).map((row) => ({
    id: String(row.id), name: String(row.full_name || row.email || "Sem nome"), email: String(row.email || ""), cpf: String(row.cpf || ""),
    bank: { bankName: String(row.bank_name || ""), bankAgency: String(row.bank_agency || ""), bankAccount: String(row.bank_account || ""), bankAccountType: String(row.bank_account_type || ""), pixKey: String(row.pix_key || "") } as BankSnapshot,
  }))
}

export type CreateAdvanceInput = { employeeId: string; reason: string; amount: number; startDate: string; endDate: string; bank: BankSnapshot; categoryBudgets: CategoryBudgets; cpf?: string }
export const ADVANCE_ORIGIN = "Antecipacao Viagem"
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })

/** O dinheiro sai do caixa quando a antecipação é liberada: o valor total entra em Entradas e Saídas como Saída realizada, ligada à antecipação pela chave em `notes`. */
async function postAdvanceOutflow(admin: Admin, advance: { id: string; number?: number | null; employee_name: string; reason: string; amount: number }) {
  const { data: dre } = await admin.from("dre_accounts").select("id").eq("name", "Sem classificacao").limit(1)
  const code = advance.number ? `ANT-${String(advance.number).padStart(5, "0")}` : ""
  const day = today()
  const { error } = await admin.from("financial_transactions").insert({
    id: randomUUID(), type: "saida", description: `Antecipação de reembolso para viagem${code ? ` ${code}` : ""} - ${advance.employee_name}`, dre_account_id: dre?.[0]?.id ? String(dre[0].id) : null,
    supplier_name: advance.employee_name, competence_date: day, due_date: day, realized_date: day, expected_amount: advance.amount, realized_amount: advance.amount, status: "Realizado", origin: ADVANCE_ORIGIN,
    notes: `${ADVANCE_ORIGIN} | ${advance.id}\n${code ? `Lançamento ${code}\n` : ""}${advance.employee_name}${advance.reason ? ` - ${advance.reason}` : ""}`,
  })
  if (error) throw error
}

export async function advanceCompany(admin: Admin, companyId: string) {
  const { data } = await admin.from("system_companies").select("name,legal_name,trade_name,cnpj").eq("id", companyId).maybeSingle()
  return { name: String(data?.legal_name || data?.trade_name || data?.name || ""), cnpj: String(data?.cnpj || "") }
}

/** Cria a antecipação de reembolso para viagem, gera o link e salva/atualiza os dados bancários do funcionário no cadastro (para reaproveitar da próxima vez). */
export async function createAdvance(admin: Admin, input: CreateAdvanceInput, createdBy: string) {
  if (!input.employeeId) throw new Error("Escolha o funcionário.")
  if (!(input.amount > 0)) throw new Error("Informe um valor maior que zero.")
  if (!input.startDate || !input.endDate || input.endDate < input.startDate) throw new Error("Período inválido.")
  const budgetCheck = validateCategoryBudgets(input.amount, input.categoryBudgets)
  if (!budgetCheck.ok) throw new Error(budgetCheck.reason)
  const { data: employee, error: employeeError } = await admin.from("profiles").select("id,full_name,email").eq("id", input.employeeId).maybeSingle()
  if (employeeError) throw employeeError
  if (!employee) throw new Error("Funcionário não encontrado.")

  if (input.cpf?.trim()) await admin.from("profiles").update({ cpf: input.cpf.trim() }).eq("id", input.employeeId) // coluna nova (script 239): sem ela o CPF só vai na antecipação
  await admin.from("profiles").update({
    bank_name: input.bank.bankName || null, bank_agency: input.bank.bankAgency || null, bank_account: input.bank.bankAccount || null,
    bank_account_type: input.bank.bankAccountType || null, pix_key: input.bank.pixKey || null,
  }).eq("id", input.employeeId)

  const row = {
    token: newToken(), employee_id: input.employeeId, employee_name: String(employee.full_name || employee.email || ""), employee_email: employee.email || null,
    reason: input.reason.slice(0, 300), amount: input.amount, category_budgets: input.categoryBudgets, start_date: input.startDate, end_date: input.endDate, bank_snapshot: input.bank, created_by: createdBy,
  }
  let created = await admin.from("travel_advances").insert({ ...row, employee_cpf: input.cpf?.trim() || "" }).select("*").single()
  if (created.error && /employee_cpf/.test(created.error.message)) created = await admin.from("travel_advances").insert(row).select("*").single() // script 239 ainda não rodou
  if (created.error) throw advanceError(created.error, "Erro ao criar a antecipação de reembolso para viagem.")
  const data = created.data as { id: string; token: string; number?: number | null; employee_name: string; reason: string; amount: number }
  try {
    await postAdvanceOutflow(admin, { id: data.id, number: data.number, employee_name: data.employee_name, reason: data.reason, amount: Number(data.amount) })
  } catch (error) {
    await admin.from("travel_advances").delete().eq("id", data.id) // sem o lançamento no caixa a antecipação não fica criada
    throw advanceError(error, "Não foi possível lançar a saída da antecipação em Entradas e Saídas.")
  }
  return { id: data.id, token: data.token, number: data.number ?? null }
}

/** Notinha como aparece na lista do financeiro (com a foto e o que o sistema leu). */
type AdvanceReceipt = { id: string; amount: number; status: string; category: string; photo_url: string; establishment: string; occurred_at: string | null; review_note: string; created_at: string }

async function withReceipts<T extends { id: string }>(admin: Admin, advances: T[]) {
  if (!advances.length) return advances.map((advance) => ({ ...advance, receipts: [] as AdvanceReceipt[] }))
  const { data, error } = await admin.from("travel_advance_receipts").select("id,advance_id,amount,status,category,photo_url,establishment,occurred_at,review_note,created_at").in("advance_id", advances.map((advance) => advance.id)).order("created_at")
  if (error) throw error
  const byAdvance = new Map<string, AdvanceReceipt[]>()
  for (const row of data || []) {
    const list = byAdvance.get(String(row.advance_id)) || []
    list.push({ id: String(row.id), amount: Number(row.amount), status: String(row.status), category: String(row.category), photo_url: String(row.photo_url || ""), establishment: String(row.establishment || ""), occurred_at: row.occurred_at ? String(row.occurred_at) : null, review_note: String(row.review_note || ""), created_at: String(row.created_at || "") })
    byAdvance.set(String(row.advance_id), list)
  }
  return advances.map((advance) => ({ ...advance, receipts: byAdvance.get(advance.id) || [] }))
}

/** Lista para a tela interna do financeiro (com resumo de gasto/saldo de cada um). */
export async function listAdvances(admin: Admin) {
  const { data, error } = await admin.from("travel_advances").select("*").order("created_at", { ascending: false }).limit(300)
  if (error) throw advanceError(error, "Erro ao carregar os antecipações de reembolso para viagem.")
  const withReceiptsData = await withReceipts(admin, data || [])
  return withReceiptsData.map((row) => ({ ...row, summary: summarizeAdvance(Number(row.amount), row.receipts), categories: summarizeCategories(row.category_budgets || {}, row.receipts) }))
}

/** Notas pendentes de revisão (de antecipações de reembolso para viagem já finalizadas pelo funcionário): a "página de pendências". */
export async function listPendingReview(admin: Admin) {
  const { data: advances, error } = await admin.from("travel_advances").select("id,employee_name,reason,amount,end_date").eq("status", "Finalizado").order("finalized_at", { ascending: true })
  if (error) throw advanceError(error, "Erro ao carregar as pendências.")
  if (!advances?.length) return []
  const { data: receipts, error: receiptsError } = await admin.from("travel_advance_receipts").select("*").in("advance_id", advances.map((advance) => advance.id)).order("created_at")
  if (receiptsError) throw receiptsError
  const byAdvance = new Map(advances.map((advance) => [advance.id, advance]))
  return (receipts || []).map((row) => ({ ...row, advance: byAdvance.get(row.advance_id) }))
}

export async function getAdvanceDetail(admin: Admin, id: string) {
  const { data: advance, error } = await admin.from("travel_advances").select("*").eq("id", id).maybeSingle()
  if (error) throw advanceError(error, "Erro ao carregar a antecipação de reembolso para viagem.")
  if (!advance) throw new Error("Antecipação de reembolso para viagem não encontrada.")
  const { data: receipts, error: receiptsError } = await admin.from("travel_advance_receipts").select("*").eq("advance_id", id).order("created_at", { ascending: false })
  if (receiptsError) throw receiptsError
  return { ...advance, company: await advanceCompany(admin, String(advance.system_company_id)), receipts: receipts || [], summary: summarizeAdvance(Number(advance.amount), receipts || []), categories: summarizeCategories(advance.category_budgets || {}, receipts || []) }
}

export async function reviewReceipt(admin: Admin, receiptId: string, action: "aprovar" | "contestar", note: string, reviewer: string) {
  if (action === "contestar" && !note.trim()) throw new Error("Escreva a observação do que está estranho.")
  const { data: receipt, error } = await admin.from("travel_advance_receipts").select("advance_id").eq("id", receiptId).maybeSingle()
  if (error) throw error
  if (!receipt) throw new Error("Registro não encontrado.")
  const update = action === "aprovar"
    ? { status: "Aprovado", review_note: "", reviewed_by: reviewer, reviewed_at: new Date().toISOString() }
    : { status: "Contestado", review_note: note.slice(0, 500), reviewed_by: reviewer, reviewed_at: new Date().toISOString() }
  const { error: updateError } = await admin.from("travel_advance_receipts").update(update).eq("id", receiptId)
  if (updateError) throw updateError

  // alguma nota contestada: reabre o link para o funcionário ver e agir; nenhuma pendente/contestada: fecha a antecipação de reembolso para viagem
  const { data: all, error: allError } = await admin.from("travel_advance_receipts").select("status").eq("advance_id", receipt.advance_id)
  if (allError) throw allError
  const statuses = (all || []).map((row) => String(row.status))
  if (statuses.includes("Contestado")) await admin.from("travel_advances").update({ status: "Aberto" }).eq("id", receipt.advance_id)
  else if (statuses.every((status) => status === "Aprovado")) await admin.from("travel_advances").update({ status: "Concluido" }).eq("id", receipt.advance_id)
  return { advanceId: String(receipt.advance_id) }
}

export async function markSettlementResolved(admin: Admin, advanceId: string, note: string) {
  const { error } = await admin.from("travel_advances").update({ settlement_resolved: true, settlement_note: note.slice(0, 500) }).eq("id", advanceId)
  if (error) throw error
}

/** Cancela a antecipação (aberta ou finalizada) com motivo obrigatório: o link para de aceitar notinhas e o lançamento da saída fica cancelado. */
export async function cancelAdvance(admin: Admin, advanceId: string, input: { reason: string; by: string }) {
  const reason = input.reason.trim()
  if (!reason) throw new Error("Informe o motivo do cancelamento.")
  const { data: current, error: readError } = await admin.from("travel_advances").select("id,status,employee_name,amount").eq("id", advanceId).maybeSingle()
  if (readError) throw readError
  if (!current) throw new Error("Antecipação não encontrada.")
  if (current.status === "Cancelado") return
  if (!canCancelAdvance(String(current.status))) throw new Error("Só dá para cancelar antecipação aberta ou finalizada. Esta já foi concluída.")
  const stamp = { cancel_reason: reason.slice(0, 500), cancelled_by: input.by, cancelled_at: new Date().toISOString() }
  let update = await admin.from("travel_advances").update({ status: "Cancelado", ...stamp }).eq("id", advanceId).in("status", ["Aberto", "Finalizado"]).select("id")
  // colunas novas (script 240): sem elas o motivo vai na observação da antecipação
  if (update.error && /cancel_reason|cancelled_by|cancelled_at/.test(update.error.message)) update = await admin.from("travel_advances").update({ status: "Cancelado", settlement_note: `Cancelada por ${input.by}: ${reason}`.slice(0, 500) }).eq("id", advanceId).in("status", ["Aberto", "Finalizado"]).select("id")
  if (update.error) throw update.error
  // cancelada, a saída não aconteceu: o lançamento fica cancelado (e fora do saldo)
  if (update.data?.length) {
    await admin.from("financial_transactions").update({ status: "Cancelado", realized_amount: 0, realized_date: null }).eq("origin", ADVANCE_ORIGIN).like("notes", `${ADVANCE_ORIGIN} | ${advanceId}%`)
    await audit({ module: "financeiro", action: "Cancelamento", description: `Cancelou a antecipação de reembolso para viagem de ${current.employee_name} (R$ ${Number(current.amount).toFixed(2)}).`, recordId: advanceId, tableName: "travel_advances", reason })
  }
}

/** Exclui de vez a antecipação: notinhas (e as fotos), lançamento da saída e o registro. Só chamar depois de checar canDeleteAdvance. */
export async function deleteAdvance(admin: Admin, advanceId: string, by: string) {
  const { data: advance, error } = await admin.from("travel_advances").select("id,status,employee_name,amount,reason,number").eq("id", advanceId).maybeSingle()
  if (error) throw error
  if (!advance) throw new Error("Antecipação não encontrada.")
  const { data: receipts } = await admin.from("travel_advance_receipts").select("photo_url").eq("advance_id", advanceId)
  const paths = (receipts || []).map((row) => String(row.photo_url || "").split(`/${BUCKET}/`)[1]).filter(Boolean)
  if (paths.length) await admin.storage.from(BUCKET).remove(paths).catch(() => null) // foto que não sai do armazenamento não impede a exclusão
  const { error: transactionError } = await admin.from("financial_transactions").delete().eq("origin", ADVANCE_ORIGIN).like("notes", `${ADVANCE_ORIGIN} | ${advanceId}%`)
  if (transactionError) throw transactionError
  const { error: deleteError } = await admin.from("travel_advances").delete().eq("id", advanceId) // as notinhas saem junto (cascata)
  if (deleteError) throw deleteError
  await audit({ module: "financeiro", action: "Exclusão", description: `Excluiu a antecipação de reembolso para viagem de ${advance.employee_name} (R$ ${Number(advance.amount).toFixed(2)}, situação ${advance.status}) e o lançamento da saída.`, recordId: advanceId, tableName: "travel_advances", oldValues: advance, reason: `Excluída por ${by}` })
}

// ---------------- Portal público (sem sessão; o token é a autorização) ----------------

/** O token não diz de qual empresa é: acha a empresa certa (sem filtro) e devolve um cliente já travado nela, como o webhook do Asaas faz com o CNPJ. */
export async function companyScopedByToken(createAdmin: (options?: { bypassCompanyScope?: boolean; companyId?: string }) => Admin, token: string) {
  if (!token || token.length < 10) throw new Error("Link inválido.")
  const unscoped = createAdmin({ bypassCompanyScope: true })
  const { data, error } = await unscoped.from("travel_advances").select("id,system_company_id").eq("token", token).maybeSingle()
  if (error) throw advanceError(error, "Erro ao abrir o link.")
  if (!data) throw new Error("Link não encontrado. Confira o endereço ou peça um novo ao financeiro.")
  return createAdmin({ companyId: String(data.system_company_id) })
}

export async function getByToken(admin: Admin, token: string) {
  if (!token || token.length < 10) throw new Error("Link inválido.")
  const { data: advance, error } = await admin.from("travel_advances").select("*").eq("token", token).maybeSingle()
  if (error) throw advanceError(error, "Erro ao abrir o link.")
  if (!advance) throw new Error("Link não encontrado. Confira o endereço ou peça um novo ao financeiro.")
  const { data: receipts, error: receiptsError } = await admin.from("travel_advance_receipts").select("*").eq("advance_id", advance.id).order("created_at", { ascending: false })
  if (receiptsError) throw receiptsError
  return { advance, receipts: receipts || [] }
}

export async function portalState(admin: Admin, token: string) {
  const { advance, receipts } = await getByToken(admin, token)
  const summary = summarizeAdvance(Number(advance.amount), receipts)
  const categoryBudgets: CategoryBudgets = advance.category_budgets || {}
  return {
    id: advance.id, number: advance.number ?? null, employeeCpf: String(advance.employee_cpf || ""), company: await advanceCompany(admin, String(advance.system_company_id)),
    reason: advance.reason, amount: Number(advance.amount), startDate: advance.start_date, endDate: advance.end_date,
    status: advance.status, employeeName: advance.employee_name, ownPocketJustification: advance.own_pocket_justification,
    settlementAction: advance.settlement_action, settlementResolved: advance.settlement_resolved,
    canUpload: canUpload(advance.status, advance.end_date), summary, categories: summarizeCategories(categoryBudgets, receipts),
    receipts: receipts.map((row) => ({ id: row.id, photoUrl: row.photo_url, amount: Number(row.amount), establishment: row.establishment, category: row.category, occurredAt: row.occurred_at, status: row.status, reviewNote: row.review_note })),
  }
}

/** Recebe uma foto de notinha: guarda no Storage, lê os campos pelo texto do OCR (feito no navegador) e salva o registro. */
export async function addReceiptPhoto(admin: Admin, token: string, file: File, ocrText: string) {
  const { advance } = await getByToken(admin, token)
  if (!canUpload(advance.status, advance.end_date)) throw new Error("Este link não está mais recebendo notinhas (prazo encerrado ou orçamento já finalizado).")
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Foto muito grande: envie até 12 MB.")

  const { data: bucket } = await admin.storage.getBucket(BUCKET)
  if (!bucket) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_PHOTO_BYTES, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] })
    if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
  }
  const safeName = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "notinha.jpg"
  const path = `${advance.id}/${randomUUID()}-${safeName}`
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: false })
  if (uploadError) throw new Error(uploadError.message)
  const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path)

  const parsed = ocrText.trim() ? parseReceiptText(ocrText) : { amount: 0, establishment: "", occurredAt: new Date().toISOString().slice(0, 10), category: "Outros" as const, warnings: ["Leitura automática não disponível: preencha manualmente."] }
  const row = { advance_id: advance.id, photo_url: publicUrl.publicUrl, amount: parsed.amount, establishment: parsed.establishment, category: parsed.category, occurred_at: parsed.occurredAt }
  const { data, error } = await admin.from("travel_advance_receipts").insert(row).select("id").single()
  if (error) throw advanceError(error, "Erro ao salvar o registro.")
  return { id: data.id as string, ...parsed }
}

/** Corrige um campo lido errado pelo OCR (valor, estabelecimento, data ou categoria), antes de finalizar. */
export async function editReceipt(admin: Admin, token: string, receiptId: string, patch: { amount?: number; establishment?: string; occurredAt?: string; category?: string }) {
  const { advance, receipts } = await getByToken(admin, token)
  if (!canUpload(advance.status, advance.end_date)) throw new Error("Não é mais possível editar: o link não está mais aberto.")
  const receipt = receipts.find((row) => row.id === receiptId)
  if (!receipt) throw new Error("Registro não encontrado.")
  if (receipt.status === "Aprovado") throw new Error("Este registro já foi aprovado pelo financeiro e não pode mais ser alterado.")
  const update: Record<string, unknown> = {}
  if (patch.amount !== undefined) update.amount = Math.max(0, Number(patch.amount) || 0)
  if (patch.establishment !== undefined) update.establishment = String(patch.establishment).slice(0, 120)
  if (patch.occurredAt !== undefined) update.occurred_at = patch.occurredAt
  if (patch.category !== undefined) update.category = patch.category
  if (receipt.status === "Contestado") { update.status = "Enviado"; update.review_note = "" }
  const { error } = await admin.from("travel_advance_receipts").update(update).eq("id", receiptId)
  if (error) throw error
}

/** Aplica a leitura automática (feita depois do envio, em segundo plano) numa notinha que ainda está sem valor e sem estabelecimento. */
export async function applyReceiptOcr(admin: Admin, token: string, receiptId: string, ocrText: string) {
  const { advance, receipts } = await getByToken(admin, token)
  if (!canUpload(advance.status, advance.end_date)) return { applied: false }
  const receipt = receipts.find((row) => row.id === receiptId)
  if (!receipt || receipt.status === "Aprovado" || Number(receipt.amount) > 0 || !ocrText.trim()) return { applied: false }
  const parsed = parseReceiptText(ocrText)
  if (!(parsed.amount > 0) && !parsed.establishment) return { applied: false }
  const { error } = await admin.from("travel_advance_receipts").update({ amount: parsed.amount, establishment: parsed.establishment, category: parsed.category, occurred_at: parsed.occurredAt }).eq("id", receiptId)
  if (error) throw error
  return { applied: true, ...parsed }
}

/** Reserva: o celular não conseguiu ler a notinha; o servidor lê a foto já enviada e aplica o valor, o estabelecimento e a data. */
export async function readReceiptOnServer(admin: Admin, token: string, receiptId: string) {
  const { receipts } = await getByToken(admin, token)
  const receipt = receipts.find((row) => row.id === receiptId)
  if (!receipt?.photo_url) return { applied: false }
  const response = await fetch(receipt.photo_url)
  if (!response.ok) return { applied: false }
  const { ocrReceiptBuffer } = await import("@/lib/ocr-server")
  const text = await ocrReceiptBuffer(Buffer.from(await response.arrayBuffer()))
  return applyReceiptOcr(admin, token, receiptId, text)
}

export async function deleteReceipt(admin: Admin, token: string, receiptId: string) {
  const { advance, receipts } = await getByToken(admin, token)
  if (!canUpload(advance.status, advance.end_date)) throw new Error("Não é mais possível remover: o link não está mais aberto.")
  const receipt = receipts.find((row) => row.id === receiptId)
  if (!receipt) throw new Error("Registro não encontrado.")
  if (receipt.status === "Aprovado") throw new Error("Este registro já foi aprovado pelo financeiro e não pode ser removido.")
  const { error } = await admin.from("travel_advance_receipts").delete().eq("id", receiptId)
  if (error) throw error
}

export async function finalizeAdvance(admin: Admin, token: string, input: { ownPocketJustification: string; settlementAction: SettlementAction | null }) {
  const { advance, receipts } = await getByToken(admin, token)
  if (advance.status !== "Aberto") throw new Error("Esta antecipação de reembolso para viagem já foi finalizada.")
  if (!receipts.length) throw new Error("Suba ao menos uma notinha antes de finalizar.")
  const summary = summarizeAdvance(Number(advance.amount), receipts)
  const canFinish = canFinalize(summary, input.ownPocketJustification)
  if (!canFinish.ok) throw new Error(canFinish.reason)
  if (needsSettlementChoice(summary, input.settlementAction)) throw new Error("Escolha o que fazer com o valor que sobrou: devolver ou descontar do salário.")
  const { error } = await admin.from("travel_advances").update({
    status: "Finalizado", own_pocket_justification: input.ownPocketJustification.slice(0, 500), settlement_action: input.settlementAction, finalized_at: new Date().toISOString(),
  }).eq("id", advance.id)
  if (error) throw error
}
