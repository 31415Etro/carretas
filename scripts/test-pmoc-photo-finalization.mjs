import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const orderId = randomUUID()

async function saveEvent(stepName, status, notes = "", finishedAt = "") {
  const response = await fetch(`${baseUrl}/api/ordens-servico/${orderId}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { id: randomUUID(), stepName, status, eventDatetime: new Date().toISOString(), notes }, status, finishedAt }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  console.log(`PASS: PMOC ${stepName}`)
  return body
}

try {
  const sourceResult = await supabase.from("service_orders").select("*").eq("order_type", "pmoc").not("client_equipment_id", "is", null).limit(1).single()
  if (sourceResult.error) throw sourceResult.error
  const source = sourceResult.data
  const now = new Date().toISOString()
  const inserted = await supabase.from("service_orders").insert({
    ...source,
    id: orderId,
    order_number: `OS-TEST-PMOC-${Date.now()}`,
    status: "Agendada",
    notes: `Selecoes OS JSON: ${JSON.stringify({ clientEquipmentIds: [source.client_equipment_id] })}`,
    total_amount: 0,
    finished_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  })
  if (inserted.error) throw inserted.error

  const photoRows = ["Foto Inicial", "Foto Final"].map((category) => ({
    id: randomUUID(), service_order_id: orderId, category, file_url: `https://example.com/${category}.jpg`,
    file_name: `${category}.jpg`, file_type: "image/jpeg", notes: `equipment:${source.client_equipment_id}`,
  }))
  const photos = await supabase.from("service_order_files").insert(photoRows)
  if (photos.error) throw photos.error

  await saveEvent("Iniciar servico", "Em execucao")
  const finished = await saveEvent("Finalizar servico", "Finalizada", "PMOC finalizado com fotos inicial e final.", new Date().toISOString())
  assert.equal(finished.order.status, "Finalizada")
  console.log(JSON.stringify({ ok: true, pmocEquipmentScope: source.client_equipment_id, initialPhoto: true, finalPhoto: true, finalized: true }))
} finally {
  for (const table of ["service_order_events", "service_order_files", "accounts_receivable"]) await supabase.from(table).delete().eq("service_order_id", orderId)
  await supabase.from("service_orders").delete().eq("id", orderId)
  const remaining = await supabase.from("service_orders").select("id", { count: "exact", head: true }).eq("id", orderId)
  assert.equal(remaining.count, 0)
  console.log("CLEANUP: OS PMOC temporaria removida")
}
