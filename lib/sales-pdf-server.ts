import { createHash, randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"
import { buildInstallments } from "@/lib/quotes"
import { companyBranding } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"
import { configurationGet } from "@/lib/engineering-server"
import { photoForDocument } from "@/lib/product-photos-server"
import { salesOrderDetail } from "@/lib/sales-server"

type Admin = ReturnType<typeof createAdminClient>
export const SALES_DOC_BUCKET = "sales-documents"
const MAX_PDF = 25 * 1024 * 1024
const PDF_PHOTO_SIDE = 1600

type PhotoOut = { dataUrl: string | null; format: "JPEG" | "PNG" | "WEBP"; width?: number; height?: number; problem: string; photoId?: string | null; path?: string | null }

/** Fotografia do produto para o PDF: a escolhida ou a principal do cadastro (lida do armazenamento, nunca de uma URL guardada), reduzida sem distorcer. */
async function loadPhoto(admin: Admin, materialId: string | null | undefined, photoId?: string | null): Promise<PhotoOut> {
  if (!materialId) return { dataUrl: null, format: "JPEG", problem: "Item sem produto." }
  const found = await photoForDocument(admin, materialId, photoId)
  if (!found.bytes) return { dataUrl: null, format: "JPEG", problem: found.problem, photoId: found.ref?.id || null, path: found.ref?.path || null }
  try {
    const sharp = (await import("sharp")).default
    const png = found.type === "image/png"
    const pipeline = sharp(found.bytes).rotate().resize(PDF_PHOTO_SIDE, PDF_PHOTO_SIDE, { fit: "inside", withoutEnlargement: true })
    const { data, info } = await (png ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 86, mozjpeg: true })).toBuffer({ resolveWithObject: true })
    return { dataUrl: `data:${png ? "image/png" : "image/jpeg"};base64,${data.toString("base64")}`, format: png ? "PNG" : "JPEG", width: info.width, height: info.height, problem: "", photoId: found.ref?.id, path: found.ref?.path }
  } catch {
    return { dataUrl: null, format: "JPEG", problem: "A fotografia cadastrada não pôde ser lida como imagem: substitua-a no cadastro do produto.", photoId: found.ref?.id, path: found.ref?.path }
  }
}

const addressOf = (client: Record<string, any> | null) => (client ? [[client.street, client.number].filter(Boolean).join(", "), client.complement, client.district, [client.city, client.state].filter(Boolean).join("/"), client.zip_code && `CEP ${client.zip_code}`].filter(Boolean).join(" - ") : "")

/**
 * Dados do PDF do pedido de venda. Tudo vem do PEDIDO e da configuração CONGELADA da venda: nunca das medidas atuais do cadastro.
 * Parcelas e vencimentos usam a condição de pagamento negociada, com a mesma regra do orçamento (30 dias = mês a mês).
 * `photoChoices` permite usar, num item, uma fotografia específica (de configuração) em vez da principal.
 */
export async function salesOrderPdfData(admin: Admin, id: string, photoChoices: Record<string, string> = {}) {
  const detail = await salesOrderDetail(admin, id)
  const order = detail.order as Record<string, any>
  const company = await getSelectedSystemCompany()
  const branding = await companyBranding(admin, company.id)
  const { data: client } = await admin.from("clients").select("name,document,phone,mobile,email,zip_code,street,number,complement,district,city,state").eq("id", order.client_id).maybeSingle()
  const rule = order.payment_condition_snapshot as { installments?: number; firstDueDays?: number; intervalDays?: number; paymentMethod?: string } | null
  const baseDate = String(order.order_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const installments = rule && Number(order.total_amount) > 0
    ? buildInstallments(Number(order.total_amount), { installments: Number(rule.installments || 1), firstDueDays: Number(rule.firstDueDays || 0), intervalDays: Number(rule.intervalDays ?? 30) }, baseDate)
    : []
  const items = []
  for (const item of detail.items as Array<Record<string, any>>) {
    const row = (await admin.from("sales_order_items").select("configuration_id,material_id").eq("id", item.id).maybeSingle()).data
    const configuration = row?.configuration_id ? await configurationGet(admin, row.configuration_id).catch(() => null) : null
    const material = row?.material_id ? (await admin.from("materials").select("name,description,product_model,internal_code").eq("id", row.material_id).maybeSingle()).data : null
    const photo = item.line_type === "Produto" ? await loadPhoto(admin, row?.material_id, photoChoices[item.id]) : { dataUrl: null, format: "JPEG" as const, problem: "" }
    items.push({ ...item, product_name: material?.name || item.description, product_model: material?.product_model || "", sku: material?.internal_code || item.product_sku, commercial_description: material?.description || "", configuration, photo, material_id: row?.material_id || null })
  }
  const { data: documents } = await admin.rpc("sales_order_document_list", { p_order: id })
  const version = (((documents as Array<{ version: number }> | null) || [])[0]?.version || 0) + 1
  return {
    company: branding, client: client ? { name: client.name, document: client.document || "", phone: client.phone || client.mobile || "", email: client.email || "", address: addressOf(client) } : { name: order.client_name, document: order.client_document || "", phone: "", email: "" },
    order: { number: order.order_number, date: order.order_date, deliveryDate: order.delivery_date, status: order.status, quoteNumber: order.quote_number, totalAmount: Number(order.total_amount), itemsTotal: Number(order.items_total), discount: Number(order.discount_amount),
      freight: Number(order.freight_amount || 0), expenses: Number(order.expenses_amount || 0), taxes: Number(order.taxes_amount || 0), paymentCondition: order.payment_condition_name || "", paymentMethod: rule?.paymentMethod || "", warrantyDays: Number(order.warranty_days || 0),
      salesperson: order.salesperson_name || "", notes: order.notes || "", version },
    installments, items,
  }
}

export async function salesOrderDocuments(admin: Admin, id: string) {
  const { data, error } = await admin.rpc("sales_order_document_list", { p_order: id })
  if (error) throw error
  return (data || []) as Array<Record<string, any>>
}

/**
 * Guarda o PDF montado no navegador: confere que é mesmo um PDF, grava no armazenamento privado, CONFIRMA que o arquivo existe e só então registra a versão.
 * A versão é imutável; emitir de novo cria a versão seguinte (exige motivo) e nunca substitui as anteriores.
 */
export async function storeSalesOrderPdf(admin: Admin, orderId: string, file: File, meta: { source: string; reason: string; photoRefs: unknown; configurationRefs: unknown; summary: unknown }, user: string) {
  if (file.size < 1000 || file.size > MAX_PDF) throw new Error("O PDF recebido está vazio ou passa de 25 MB.")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("O arquivo enviado não é um PDF.")
  const { data: bucket } = await admin.storage.getBucket(SALES_DOC_BUCKET)
  if (!bucket) {
    const { error } = await admin.storage.createBucket(SALES_DOC_BUCKET, { public: false, fileSizeLimit: MAX_PDF, allowedMimeTypes: ["application/pdf"] })
    if (error && !/already exists/i.test(error.message)) throw new Error(`Armazenamento dos pedidos indisponível: ${error.message}`)
  }
  const path = `${orderId}/${randomUUID()}.pdf`
  const { error: uploadError } = await admin.storage.from(SALES_DOC_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false })
  if (uploadError) throw new Error(`O PDF não foi gravado: ${uploadError.message}`)
  const { data: listed } = await admin.storage.from(SALES_DOC_BUCKET).list(orderId, { limit: 200 })
  if (!listed?.some((entry) => `${orderId}/${entry.name}` === path)) throw new Error("A gravação do PDF não pôde ser confirmada no armazenamento: tente novamente.")
  const { data, error } = await admin.rpc("sales_order_document_register", {
    p_order: orderId, p_user: user,
    p: { trigger_source: meta.source, reason: meta.reason, file_bucket: SALES_DOC_BUCKET, file_path: path, file_name: file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "pedido.pdf", size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      photo_refs: meta.photoRefs, configuration_refs: meta.configurationRefs, summary: meta.summary },
  })
  if (error) {
    await admin.storage.from(SALES_DOC_BUCKET).remove([path]).catch(() => undefined)
    throw error
  }
  if (data?.duplicate) await admin.storage.from(SALES_DOC_BUCKET).remove([path]).catch(() => undefined)
  return data as { id: string; version: number; duplicate: boolean }
}

/** Bytes de uma versão já emitida (visualização/baixa). */
export async function readSalesOrderPdf(admin: Admin, orderId: string, version?: number) {
  const { data: doc, error } = await admin.rpc("sales_order_document_get", { p_order: orderId, p_version: version ?? null })
  if (error) throw error
  if (!doc) throw new Error("Pedido sem PDF emitido: emita a primeira versão.")
  const { data, error: downloadError } = await admin.storage.from(doc.file_bucket).download(doc.file_path)
  if (downloadError || !data) throw new Error("O arquivo do PDF não está no armazenamento.")
  return { bytes: Buffer.from(await data.arrayBuffer()), document: doc as Record<string, any> }
}
