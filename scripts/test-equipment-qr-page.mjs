import assert from "node:assert/strict"
import QRCode from "qrcode"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const selectionMarker = "Selecoes OS JSON:"

function selectedEquipmentId(order) {
  if (order.client_equipment_id) return order.client_equipment_id
  const line = String(order.notes || "").split(/\r?\n/).find((item) => item.trim().startsWith(selectionMarker))
  if (!line) return ""
  try {
    const parsed = JSON.parse(line.slice(line.indexOf(selectionMarker) + selectionMarker.length).trim())
    return Array.isArray(parsed.clientEquipmentIds) ? parsed.clientEquipmentIds[0] || "" : ""
  } catch {
    return ""
  }
}

const ordersResult = await supabase.from("service_orders").select("order_number,client_equipment_id,notes,status").order("created_at", { ascending: false }).limit(500)
if (ordersResult.error) throw ordersResult.error
const sourceOrder = (ordersResult.data || []).find((order) => /finaliz|conclu/i.test(String(order.status).normalize("NFD").replace(/[\u0300-\u036f]/g, "")) && selectedEquipmentId(order))
const equipmentId = sourceOrder ? selectedEquipmentId(sourceOrder) : (await supabase.from("client_equipment").select("id").limit(1).single()).data?.id
assert(equipmentId, "Nenhum equipamento disponivel para testar.")

const equipmentResult = await supabase.from("client_equipment").select("id,name,tag").eq("id", equipmentId).single()
if (equipmentResult.error) throw equipmentResult.error
const equipment = equipmentResult.data
const code = `EQ-${equipment.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`
const publicUrl = `${baseUrl}/equipamento/${equipment.id}`
const response = await fetch(publicUrl, { redirect: "manual" })
const html = await response.text()

assert.equal(response.status, 200, `Pagina publica retornou HTTP ${response.status}.`)
assert(!response.headers.get("location")?.includes("/login"), "Pagina publica redirecionou para login.")
assert(html.includes(equipment.name), "Nome do equipamento nao apareceu na pagina publica.")
assert(html.includes(code), "Codigo do equipamento nao apareceu na pagina publica.")
if (sourceOrder) assert(html.includes(sourceOrder.order_number), "A ultima OS do equipamento nao apareceu na pagina publica.")

const qr = await QRCode.toDataURL(publicUrl, { errorCorrectionLevel: "H" })
assert(qr.startsWith("data:image/png;base64,"), "Biblioteca nao gerou uma imagem QR valida.")

console.log(JSON.stringify({ ok: true, equipment: equipment.name, code, publicPage: true, anonymousAccess: true, latestOrder: sourceOrder?.order_number || null, qrPng: true }))
