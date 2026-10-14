import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { reconciledNotes, statementKeyFromNotes, STATEMENT_ORIGIN } from "@/lib/bank-reconciliation"

export const dynamic = "force-dynamic"

type Pair = { manualId: string; statementId: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Concilia lançamentos já existentes (manuais, contas pagas...) com linhas do extrato já importadas.
 * O lançamento manual passa a carregar a chave, a data e o valor do banco; o lançamento duplicado criado pelo extrato é
 * apagado. Assim o pagamento conta UMA vez nos totais (cards, entradas e saídas, DRE).
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { pairs } = (await request.json()) as { pairs?: Pair[] }
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > 300) return NextResponse.json({ error: "Informe de 1 a 300 pares para conciliar." }, { status: 400 })
    const admin = context.admin
    const done: Array<{ manualId: string; statementId: string }> = []
    const failed: Array<{ manualId: string; statementId: string; error: string }> = []
    const today = new Date().toISOString().slice(0, 10)

    for (const pair of pairs) {
      try {
        if (!uuid.test(pair.manualId) || !uuid.test(pair.statementId) || pair.manualId === pair.statementId) throw new Error("Lançamentos inválidos.")
        const { data: rows, error } = await admin.from("financial_transactions").select("*").in("id", [pair.manualId, pair.statementId])
        if (error) throw new Error(error.message)
        const manual = rows?.find((row) => row.id === pair.manualId)
        const statement = rows?.find((row) => row.id === pair.statementId)
        if (!manual || !statement) throw new Error("Lançamento não encontrado (talvez já conciliado).")
        if (statement.origin !== STATEMENT_ORIGIN) throw new Error("O lançamento do extrato não é de origem 'Extrato bancario'.")
        if (manual.origin === STATEMENT_ORIGIN || statementKeyFromNotes(manual.notes || "")) throw new Error("O lançamento manual já está conciliado com um extrato.")
        if (manual.type !== statement.type) throw new Error("Não dá para conciliar uma entrada com uma saída.")

        const update = {
          realized_date: statement.realized_date || statement.due_date,
          realized_amount: Number(statement.realized_amount || 0),
          due_date: manual.due_date || statement.due_date,
          status: "Realizado",
          notes: reconciledNotes(manual.notes || "", statement.notes || "", today),
          attachment_url: manual.attachment_url || statement.attachment_url || "",
          payment_method: manual.payment_method || statement.payment_method || "",
        }
        const original = { realized_date: manual.realized_date, realized_amount: manual.realized_amount, due_date: manual.due_date, status: manual.status, notes: manual.notes, attachment_url: manual.attachment_url, payment_method: manual.payment_method }
        const updated = await admin.from("financial_transactions").update(update).eq("id", manual.id)
        if (updated.error) throw new Error(updated.error.message)
        const removed = await admin.from("financial_transactions").delete().eq("id", statement.id)
        if (removed.error) {
          await admin.from("financial_transactions").update(original).eq("id", manual.id) // não deixa pela metade
          throw new Error(removed.error.message)
        }
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
