import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export const dynamic = "force-dynamic"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function DELETE(request: Request) {
  try {
    if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Somente administradores podem excluir registros." }, { status: 403 })
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 })
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind")
    const id = url.searchParams.get("id") || ""
    const transactionId = url.searchParams.get("transactionId") || ""
    if ((kind !== "pagar" && kind !== "receber") || !uuidPattern.test(id)) {
      return NextResponse.json({ error: "Conta financeira invalida." }, { status: 400 })
    }

    const supabase = createAdminClient()
    const table = kind === "pagar" ? "accounts_payable" : "accounts_receivable"
    const { data: account, error: readError } = await supabase.from(table).select("*").eq("id", id).maybeSingle()
    if (readError) throw new Error(`${table}: ${readError.message}`)
    if (!account) return NextResponse.json({ error: "Conta nao encontrada." }, { status: 404 })

    let linkedTransactionId = uuidPattern.test(transactionId) ? transactionId : ""
    if (!linkedTransactionId) {
      const { data: candidates, error: transactionError } = await supabase
        .from("financial_transactions")
        .select("id,type,description,due_date,expected_amount,work_id,service_order_id,client_id,supplier_name")
        .eq("type", kind === "pagar" ? "saida" : "entrada")
        .eq("description", account.description)
        .eq("due_date", account.due_date)
      if (transactionError) throw new Error(`financial_transactions: ${transactionError.message}`)
      const matches = (candidates || []).filter((item) =>
        Number(item.expected_amount || 0) === Number(account.expected_amount || 0)
        && (item.work_id || "") === (account.work_id || "")
        && (item.service_order_id || "") === (account.service_order_id || "")
        && (kind === "pagar"
          ? (item.supplier_name || "") === (account.supplier_name || "")
          : (item.client_id || "") === (account.client_id || "")),
      )
      if (matches.length === 1) linkedTransactionId = matches[0].id
    }

    if (linkedTransactionId) {
      const { error: transactionDeleteError } = await supabase.from("financial_transactions").delete().eq("id", linkedTransactionId)
      if (transactionDeleteError) throw new Error(`financial_transactions: ${transactionDeleteError.message}`)
    }
    const { error: accountDeleteError } = await supabase.from(table).delete().eq("id", id)
    if (accountDeleteError) throw new Error(`${table}: ${accountDeleteError.message}`)

    return NextResponse.json({ ok: true, transactionDeleted: Boolean(linkedTransactionId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao excluir conta financeira." }, { status: 500 })
  }
}
