import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import type { createAdminClient } from "@/lib/supabase/server"
import { reconciledNotes, statementKeyFromNotes, STATEMENT_ORIGIN } from "@/lib/bank-reconciliation"

export const dynamic = "force-dynamic"

type Admin = ReturnType<typeof createAdminClient>
type Row = Record<string, any>
type Ref = { kind: "tx" | "ap"; id: string }
type Pair = { manualId: string; statementId: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const money = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const brDate = (value: unknown) => String(value || "").slice(0, 10).split("-").reverse().join("/")

async function loadTx(admin: Admin, id: string) {
  const { data, error } = await admin.from("financial_transactions").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as Row | null
}

/**
 * Junta dois lançamentos de Entradas e Saídas que são o MESMO pagamento: `keeper` fica e `dropped` é apagado, para o valor
 * contar uma vez nos cards, em Entradas e Saídas e no DRE. Se `dropped` veio do extrato, `keeper` passa a ter a data, o valor
 * e a chave do banco.
 */
async function mergeTransactions(admin: Admin, keeper: Row, dropped: Row, today: string) {
  if (keeper.type !== dropped.type) throw new Error("Não dá para conciliar uma entrada com uma saída.")
  if (keeper.origin === STATEMENT_ORIGIN && dropped.origin === STATEMENT_ORIGIN) throw new Error("Dois lançamentos de extrato não se conciliam entre si.")
  const fromBank = dropped.origin === STATEMENT_ORIGIN
  const note = fromBank ? String(dropped.notes || "") : `Lançamento duplicado removido na conciliação: ${dropped.description} (${money(dropped.realized_amount || dropped.expected_amount)} em ${brDate(dropped.realized_date || dropped.due_date)}).`
  const update: Row = fromBank
    ? { realized_date: dropped.realized_date || dropped.due_date, realized_amount: Number(dropped.realized_amount || 0), due_date: keeper.due_date || dropped.due_date, status: "Realizado", attachment_url: keeper.attachment_url || dropped.attachment_url || "", payment_method: keeper.payment_method || dropped.payment_method || "" }
    : {}
  update.notes = reconciledNotes(keeper.notes || "", note, today)
  const original = Object.fromEntries(Object.keys(update).map((key) => [key, keeper[key]]))
  const updated = await admin.from("financial_transactions").update(update).eq("id", keeper.id)
  if (updated.error) throw new Error(updated.error.message)
  const removed = await admin.from("financial_transactions").delete().eq("id", dropped.id)
  if (removed.error) {
    await admin.from("financial_transactions").update(original).eq("id", keeper.id) // não deixa pela metade
    throw new Error(removed.error.message)
  }
}

/** Lançamento (Entradas e Saídas) que já representa uma conta a pagar paga (mesmos dados que a tela usa para ligá-los). */
async function transactionOfPayable(admin: Admin, payable: Row) {
  let query = admin.from("financial_transactions").select("*").eq("type", "saida").eq("description", payable.description).eq("expected_amount", payable.expected_amount)
  query = payable.due_date ? query.eq("due_date", payable.due_date) : query
  query = payable.supplier_name ? query.eq("supplier_name", payable.supplier_name) : query
  const { data, error } = await query.limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0] as Row | undefined) || null
}

/** Um lançamento de Entradas e Saídas é o pagamento de uma conta a pagar ainda aberta: a conta é quitada e o lançamento passa a ser o dela. */
async function settlePayable(admin: Admin, tx: Row, payable: Row, today: string) {
  if (tx.type !== "saida") throw new Error("Conta a pagar só se concilia com uma saída.")
  const paid = Number(tx.realized_amount || tx.expected_amount || 0)
  const expected = Number(payable.expected_amount || 0)
  const payableUpdate: Row = {
    status: paid + 0.009 >= expected ? "Paga" : "Parcialmente paga", payment_date: tx.realized_date || tx.due_date || today, paid_amount: paid,
    payment_method: tx.payment_method || payable.payment_method || "",
    notes: reconciledNotes(payable.notes || "", `Quitada pela conciliação com o lançamento "${tx.description}" (${money(paid)} em ${brDate(tx.realized_date || tx.due_date)}).`, today),
  }
  const txUpdate: Row = {
    description: payable.description, supplier_name: payable.supplier_name || tx.supplier_name, due_date: payable.due_date || tx.due_date, expected_amount: expected,
    service_order_id: payable.service_order_id || null, category_id: tx.category_id || payable.category_id || null, subcategory_id: tx.subcategory_id || payable.subcategory_id || null,
    cost_center_id: tx.cost_center_id || payable.cost_center_id || null, dre_account_id: tx.dre_account_id || payable.dre_account_id || null,
    origin: "Conta a pagar", status: "Realizado", notes: reconciledNotes(tx.notes || "", "", today),
  }
  const originalPayable = Object.fromEntries(Object.keys(payableUpdate).map((key) => [key, payable[key]]))
  const first = await admin.from("accounts_payable").update(payableUpdate).eq("id", payable.id)
  if (first.error) throw new Error(first.error.message)
  const second = await admin.from("financial_transactions").update(txUpdate).eq("id", tx.id)
  if (second.error) {
    await admin.from("accounts_payable").update(originalPayable).eq("id", payable.id)
    throw new Error(second.error.message)
  }
}

/** Escolhe quem fica quando dois lançamentos são o mesmo pagamento: o que não é do extrato; se nenhum é, o que o usuário pediu. */
function pickKeeper(source: Row, target: Row, keep?: "source" | "target") {
  if (source.origin === STATEMENT_ORIGIN) return { keeper: target, dropped: source }
  if (target.origin === STATEMENT_ORIGIN) return { keeper: source, dropped: target }
  return keep === "target" ? { keeper: target, dropped: source } : { keeper: source, dropped: target }
}

async function reconcileRefs(admin: Admin, source: Ref, target: Ref, keep: "source" | "target" | undefined, today: string) {
  if (source.kind === "ap" && target.kind === "ap") throw new Error("Duas contas a pagar não se conciliam: exclua a duplicada em Contas a Pagar.")
  const load = async (ref: Ref) => {
    if (!uuid.test(ref.id)) throw new Error("Lançamento inválido.")
    if (ref.kind === "tx") return loadTx(admin, ref.id)
    const { data, error } = await admin.from("accounts_payable").select("*").eq("id", ref.id).maybeSingle()
    if (error) throw new Error(error.message)
    return data as Row | null
  }
  const [a, b] = await Promise.all([load(source), load(target)])
  if (!a || !b) throw new Error("Lançamento não encontrado (talvez já conciliado ou excluído).")
  if (source.kind === "tx" && target.kind === "tx") {
    const { keeper, dropped } = pickKeeper(a, b, keep)
    await mergeTransactions(admin, keeper, dropped, today)
    return "Lançamentos conciliados: o pagamento passa a contar uma vez só."
  }
  const tx = source.kind === "tx" ? a : b
  const payable = source.kind === "ap" ? a : b
  if (payable.status === "Cancelada") throw new Error("A conta a pagar está cancelada.")
  if (payable.status === "Paga") {
    // a conta já foi paga e já tem lançamento: o que sobra é um lançamento duplicado
    const linked = await transactionOfPayable(admin, payable)
    if (!linked) throw new Error("A conta já está paga, mas não achei o lançamento dela em Entradas e Saídas para conciliar.")
    if (linked.id === tx.id) throw new Error("Este lançamento já é o da conta a pagar.")
    await mergeTransactions(admin, linked, tx, today)
    return "Conta já estava paga: o lançamento duplicado foi unido ao da conta e passa a contar uma vez só."
  }
  await settlePayable(admin, tx, payable, today)
  return "Conta a pagar quitada com o lançamento escolhido: o valor conta uma vez só."
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = (await request.json()) as { pairs?: Pair[]; source?: Ref; target?: Ref; keep?: "source" | "target" }
    const admin = context.admin
    const today = new Date().toISOString().slice(0, 10)

    // conciliação de um par escolhido na tela de conciliação (lançamento ou conta a pagar)
    if (body.source && body.target) {
      const message = await reconcileRefs(admin, body.source, body.target, body.keep, today)
      return NextResponse.json({ reconciled: 1, failed: [], message })
    }

    // pares extrato x lançamento manual (aba Conciliacao e sugestões automáticas)
    const { pairs } = body
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 300) return NextResponse.json({ error: "Informe de 1 a 300 pares para conciliar." }, { status: 400 })
    const done: Pair[] = []
    const failed: Array<Pair & { error: string }> = []
    for (const pair of pairs) {
      try {
        if (!uuid.test(pair.manualId) || !uuid.test(pair.statementId) || pair.manualId === pair.statementId) throw new Error("Lançamentos inválidos.")
        const [manual, statement] = await Promise.all([loadTx(admin, pair.manualId), loadTx(admin, pair.statementId)])
        if (!manual || !statement) throw new Error("Lançamento não encontrado (talvez já conciliado).")
        if (statement.origin !== STATEMENT_ORIGIN) throw new Error("O lançamento do extrato não é de origem 'Extrato bancario'.")
        if (manual.origin === STATEMENT_ORIGIN || statementKeyFromNotes(manual.notes || "")) throw new Error("O lançamento manual já está conciliado com um extrato.")
        await mergeTransactions(admin, manual, statement, today)
        done.push(pair)
      } catch (reason) {
        failed.push({ ...pair, error: reason instanceof Error ? reason.message : "Erro ao conciliar." })
      }
    }
    return NextResponse.json({ reconciled: done.length, failed }, { status: done.length || !failed.length ? 200 : 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao conciliar." }, { status: 400 })
  }
}
