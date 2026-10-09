import test from "node:test"
import assert from "node:assert/strict"
import { equipmentCode, isCompletedOrder, orderIncludesEquipment } from "./equipment-public.ts"

test("gera um codigo unico e estavel, independente da TAG", () => {
  assert.equal(equipmentCode({ id: "12345678-abcd-4000-8000-000000000000" }), "EQ-12345678ABCD")
})

test("localiza equipamento vinculado diretamente ou nas selecoes da OS", () => {
  const id = "12345678-abcd-4000-8000-000000000000"
  assert.equal(orderIncludesEquipment({ client_equipment_id: id }, id), true)
  assert.equal(orderIncludesEquipment({ notes: `Observacao\nSelecoes OS JSON: ${JSON.stringify({ clientEquipmentIds: [id] })}` }, id), true)
  assert.equal(orderIncludesEquipment({ notes: "Selecoes OS JSON: invalido" }, id), false)
})

test("reconhece status finalizados", () => {
  assert.equal(isCompletedOrder("Finalizada"), true)
  assert.equal(isCompletedOrder("Concluída"), true)
  assert.equal(isCompletedOrder("Em execução"), false)
})
