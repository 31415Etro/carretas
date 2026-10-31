import { NextResponse } from "next/server"
import { digits } from "@/lib/nfe-emission"
import { issuerContext } from "@/lib/nfe-emission-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const like = (term: string) => term.replace(/[%,()*]/g, " ").trim()
const text = (value: unknown) => String(value ?? "").trim()

/** Destinatário no formato do formulário a partir de um cliente do ERP. */
function recipientFromClient(client: Record<string, any>) {
  const document = digits(client.document)
  const personType = document.length === 11 ? "PF" : "PJ"
  const state = text(client.state).toUpperCase()
  const ie = text(client.state_registration)
  const indicator = String(client.icms_indicator || "")
  return {
    source: "cliente", clientId: String(client.id), personType, document,
    name: text(client.corporate_name) || text(client.name), stateRegistration: /isent/i.test(ie) ? "" : ie,
    ieIndicator: ["1", "2", "9"].includes(indicator) ? indicator : /isent/i.test(ie) ? "2" : ie ? "1" : "9",
    zip: digits(client.zip_code), street: text(client.street), number: text(client.number) || "S/N", complement: text(client.complement), district: text(client.district), state, city: text(client.city),
    email: text(client.email), phone: digits(client.phone || client.mobile), operationDestination: state && state !== "PR" ? "2" : "1",
  }
}

/**
 * Dados para preencher a emissão a partir do que já existe no ERP.
 *   ?tipo=clientes&q=            busca de clientes (nome, documento)
 *   ?tipo=cliente&id=            destinatário pronto de um cliente
 *   ?tipo=orcamentos&q=          orçamentos recentes
 *   ?tipo=orcamento&id=          itens do orçamento (código, descrição, NCM, unidade, quantidade, valor) + destinatário do cliente
 *   ?tipo=chassis&q=&clienteId=  chassis da Documentação Veicular (VIN, produto, cliente)
 */
export async function GET(request: Request) {
  const context = await issuerContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const type = params.get("tipo")
    const term = like(params.get("q") || "")
    const admin = context.admin

    if (type === "clientes") {
      let query = admin.from("clients").select("id,name,corporate_name,document,city,state").order("name").limit(30)
      if (term) {
        const digitsOnly = digits(term)
        query = query.or([`name.ilike.%${term}%`, `corporate_name.ilike.%${term}%`, ...(digitsOnly.length >= 3 ? [`document.ilike.%${digitsOnly}%`] : [])].join(","))
      }
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ clients: (data || []).map((row) => ({ id: String(row.id), name: text(row.corporate_name) || text(row.name), document: digits(row.document), place: [row.city, row.state].filter(Boolean).join("/") })) })
    }

    if (type === "cliente") {
      const { data, error } = await admin.from("clients").select("*").eq("id", String(params.get("id"))).maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 })
      return NextResponse.json({ recipient: recipientFromClient(data) })
    }

    if (type === "orcamentos") {
      let query = admin.from("quotes").select("id,quote_number,title,status,total_amount,issue_date,clients(name,corporate_name)").order("created_at", { ascending: false }).limit(40)
      if (term) query = query.or(`quote_number.ilike.%${term}%,title.ilike.%${term}%`)
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ quotes: (data || []).map((row: any) => ({ id: String(row.id), number: text(row.quote_number), title: text(row.title), status: text(row.status), total: Number(row.total_amount || 0), issueDate: text(row.issue_date), client: text(row.clients?.corporate_name) || text(row.clients?.name) })) })
    }

    if (type === "orcamento") {
      const id = String(params.get("id"))
      const quote = await admin.from("quotes").select("id,quote_number,title,client_id,total_amount,freight_amount,discount_amount,payment_condition_name,notes").eq("id", id).maybeSingle()
      if (quote.error) throw quote.error
      if (!quote.data) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 })
      const items = await admin.from("quote_items").select("id,position,line_type,material_id,description,unit,quantity,unit_price,discount_percent,total,product_sku,materials(internal_code,ncm,unit,origin)").eq("quote_id", id).order("position")
      if (items.error) throw items.error
      const client = quote.data.client_id ? await admin.from("clients").select("*").eq("id", quote.data.client_id).maybeSingle() : { data: null }
      return NextResponse.json({
        quote: { id, number: text(quote.data.quote_number), title: text(quote.data.title), total: Number(quote.data.total_amount || 0), freight: Number(quote.data.freight_amount || 0), discount: Number(quote.data.discount_amount || 0), paymentCondition: text(quote.data.payment_condition_name) },
        items: (items.data || []).map((row: any) => ({
          quoteItemId: String(row.id), code: text(row.product_sku) || text(row.materials?.internal_code), description: text(row.description), ncm: digits(row.materials?.ncm), unit: text(row.unit) || text(row.materials?.unit) || "UN",
          quantity: Number(row.quantity || 0), unitPrice: Number(row.unit_price || 0) * (1 - Number(row.discount_percent || 0) / 100), origin: text(row.materials?.origin) || "0",
        })),
        recipient: client.data ? recipientFromClient(client.data) : null,
      })
    }

    if (type === "chassis") {
      let query = admin.from("vehicle_documentation").select("id,vin,product_name,product_model,status,client_id,clients(name,corporate_name)").not("vin", "is", null).order("created_at", { ascending: false }).limit(40)
      if (params.get("clienteId")) query = query.eq("client_id", String(params.get("clienteId")))
      if (term) query = query.or(`vin.ilike.%${term}%,product_name.ilike.%${term}%,product_model.ilike.%${term}%`)
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ chassis: (data || []).map((row: any) => ({ id: String(row.id), vin: text(row.vin).toUpperCase(), product: text(row.product_name) || text(row.product_model), status: text(row.status), client: text(row.clients?.corporate_name) || text(row.clients?.name) })) })
    }

    return NextResponse.json({ error: "Tipo inválido." }, { status: 400 })
  } catch (error) { return NextResponse.json({ error: (error as { message?: string })?.message || "Não foi possível carregar." }, { status: 500 }) }
}
