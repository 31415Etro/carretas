import type { createAdminClient } from "@/lib/supabase/server"
import { buildInstallments } from "@/lib/quotes"
import { companyBranding } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"
import { configurationGet } from "@/lib/engineering-server"
import { salesOrderDetail } from "@/lib/sales-server"

type Admin = ReturnType<typeof createAdminClient>
const MAX_PHOTO = 4 * 1024 * 1024

/** Busca a fotografia no servidor (evita bloqueio de CORS no navegador) e diz o motivo quando não consegue. */
async function loadPhoto(url: string | null | undefined) {
  if (!url) return { dataUrl: null as string | null, format: "JPEG", problem: "O produto não tem fotografia principal cadastrada." }
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!response.ok) return { dataUrl: null, format: "JPEG", problem: `A fotografia cadastrada não abre (HTTP ${response.status}): reenvie a foto no cadastro do produto.` }
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return { dataUrl: null, format: "JPEG", problem: `O arquivo da fotografia não é uma imagem aceita (${type || "tipo desconhecido"}).` }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_PHOTO) return { dataUrl: null, format: "JPEG", problem: "A fotografia é grande demais para o PDF (acima de 4 MB)." }
    return { dataUrl: `data:${type};base64,${bytes.toString("base64")}`, format: type === "image/png" ? "PNG" : type === "image/webp" ? "WEBP" : "JPEG", problem: "" }
  } catch {
    return { dataUrl: null, format: "JPEG", problem: "Não foi possível baixar a fotografia cadastrada." }
  }
}

/**
 * Dados do PDF do pedido de venda. Tudo vem do PEDIDO e da configuração CONGELADA da venda: nunca das medidas atuais do cadastro.
 * Parcelas e vencimentos usam a condição de pagamento negociada, com a mesma regra do orçamento (30 dias = mês a mês).
 */
export async function salesOrderPdfData(admin: Admin, id: string) {
  const detail = await salesOrderDetail(admin, id)
  const order = detail.order as Record<string, any>
  const company = await getSelectedSystemCompany()
  const branding = await companyBranding(admin, company.id)
  const { data: client } = await admin.from("clients").select("name,document,phone,email").eq("id", order.client_id).maybeSingle()
  const rule = order.payment_condition_snapshot as { installments?: number; firstDueDays?: number; intervalDays?: number; paymentMethod?: string } | null
  const baseDate = String(order.order_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const installments = rule && Number(order.total_amount) > 0
    ? buildInstallments(Number(order.total_amount), { installments: Number(rule.installments || 1), firstDueDays: Number(rule.firstDueDays || 0), intervalDays: Number(rule.intervalDays ?? 30) }, baseDate)
    : []
  const items = []
  for (const item of detail.items as Array<Record<string, any>>) {
    const row = (await admin.from("sales_order_items").select("configuration_id,material_id").eq("id", item.id).maybeSingle()).data
    const configuration = row?.configuration_id ? await configurationGet(admin, row.configuration_id).catch(() => null) : null
    const material = row?.material_id ? (await admin.from("materials").select("name,photo_url,product_model").eq("id", row.material_id).maybeSingle()).data : null
    const photo = item.line_type === "Produto" ? await loadPhoto(material?.photo_url) : { dataUrl: null, format: "JPEG", problem: "" }
    items.push({ ...item, product_name: material?.name || item.description, product_model: material?.product_model || "", configuration, photo })
  }
  return {
    company: branding, client: client || { name: order.client_name, document: order.client_document, phone: "", email: "" },
    order: { number: order.order_number, date: order.order_date, deliveryDate: order.delivery_date, status: order.status, quoteNumber: order.quote_number, totalAmount: Number(order.total_amount), itemsTotal: Number(order.items_total), discount: Number(order.discount_amount),
      freight: Number(order.freight_amount || 0), expenses: Number(order.expenses_amount || 0), taxes: Number(order.taxes_amount || 0), paymentCondition: order.payment_condition_name || "", paymentMethod: rule?.paymentMethod || "", warrantyDays: Number(order.warranty_days || 0),
      salesperson: order.salesperson_name || "", notes: order.notes || "" },
    installments, items,
  }
}
