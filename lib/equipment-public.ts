const selectionMarker = "Selecoes OS JSON:"

export function equipmentCode(equipment: { id: string }) {
  return `EQ-${equipment.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

export function orderIncludesEquipment(
  order: { client_equipment_id?: string | null; notes?: string | null },
  equipmentId: string,
) {
  if (order.client_equipment_id === equipmentId) return true
  const line = String(order.notes || "")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(selectionMarker))
  if (!line) return false

  try {
    const parsed = JSON.parse(line.slice(line.indexOf(selectionMarker) + selectionMarker.length).trim())
    return Array.isArray(parsed.clientEquipmentIds) && parsed.clientEquipmentIds.includes(equipmentId)
  } catch {
    return false
  }
}

export function isCompletedOrder(status?: string | null) {
  const normalized = String(status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  return normalized.includes("finaliz") || normalized.includes("conclu")
}
