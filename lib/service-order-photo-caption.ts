export type ServiceOrderPhotoPoint = {
  id: string
  label: string
  local: string
  floor: string
  final: string
  environment: string
}

export type ServiceOrderPhotoEquipment = {
  id: string
  tag?: string
  name?: string
  model?: string
  serialNumber?: string
}

export type ServiceOrderPhotoCaption = {
  scopeId: string
  title: string
  details: string[]
}

export function serviceOrderPhotoScopeId(notes?: string | null) {
  return String(notes || "").match(/(?:^|\n)equipment:([^\n]+)/)?.[1]?.trim() || ""
}

export function buildServiceOrderPhotoCaption(input: {
  orderType: string
  notes?: string | null
  points: ServiceOrderPhotoPoint[]
  equipment: ServiceOrderPhotoEquipment[]
}): ServiceOrderPhotoCaption {
  const scopeId = serviceOrderPhotoScopeId(input.notes)
  const point = input.points.find((item) => item.id === scopeId)
    || (!scopeId && input.points.length === 1 ? input.points[0] : undefined)

  if (input.orderType === "obra") {
    if (!point) {
      return {
        scopeId,
        title: "Foto geral da OS",
        details: ["Ponto, pavimento e torre nao foram registrados nesta foto antiga."],
      }
    }
    return {
      scopeId,
      title: `Ponto: ${point.label || "Nao informado"}`,
      details: [
        `Pavimento: ${point.floor || "Nao informado"}`,
        `Torre/Local: ${point.local || "Nao informado"}`,
      ],
    }
  }

  if (input.orderType === "pmoc" || input.orderType === "servicos") {
    const equipment = input.equipment.find((item) => item.id === scopeId)
    const equipmentName = [equipment?.tag, equipment?.name || point?.label]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .join(" - ")
    if (!equipmentName) {
      return {
        scopeId,
        title: input.orderType === "pmoc" ? "Equipamento nao identificado" : "Foto geral da OS",
        details: [scopeId ? `Codigo vinculado: ${scopeId}` : "Vinculo nao registrado nesta foto antiga."],
      }
    }
    const identification = [
      equipment?.model ? `Modelo: ${equipment.model}` : "",
      equipment?.serialNumber ? `Serie: ${equipment.serialNumber}` : "",
    ].filter(Boolean).join(" | ")
    return {
      scopeId,
      title: `Equipamento: ${equipmentName}`,
      details: [
        point?.environment && point.environment !== "-" ? `Ambiente: ${point.environment}` : "",
        point?.floor && point.floor !== "-" ? `Pavimento: ${point.floor}` : "",
        identification,
      ].filter(Boolean),
    }
  }

  return { scopeId, title: "Foto geral da OS", details: [] }
}
