import type { Material } from "@/lib/operational-storage"

const KIT_TAPE_METERS_PER_METER = 7.75
const KIT_LINE_EXTRA_METERS = 0.4

function normalized(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

function canonicalDiameter(value: string) {
  const compact = normalized(value)
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/\s+/g, "")
  const fraction = compact.match(/(\d+\/\d+)/)?.[1]
  if (fraction) return fraction
  const inches = compact.match(/(\d+(?:[.,]\d+)?)"/)?.[1]
  return inches ? `${inches.replace(",", ".")}"` : ""
}

export function parseKitDefinition(kitName: string, sizeOverride?: unknown) {
  const parts = String(kitName || "").split("|").map((part) => part.trim()).filter(Boolean)
  const nameSize = parts[0]?.match(/\bkit\s*(?:-|:)?\s*(\d+(?:[.,]\d+)?)/i)?.[1]
  const diameters = Array.from(new Set(parts.slice(1).map(canonicalDiameter).filter(Boolean)))
  return {
    sizeMeters: parseKitMeters(sizeOverride) || parseKitMeters(nameSize),
    diameters,
  }
}

export function parseKitMeters(value: unknown) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function kitMaterialRule(materialName: string) {
  const name = normalized(materialName)
  if (name.includes("fita prata")) return "tape" as const
  if (name.includes("linha de pedreiro")) return "line" as const
  if (name.includes("tubo de cobre") || name.includes("isolante") || name.includes("corrugado")) return "size" as const
  return "manual" as const
}

export function kitMaterialRuleLabel(materialName: string) {
  const rule = kitMaterialRule(materialName)
  if (rule === "tape") return "7,75 x tamanho"
  if (rule === "line") return "tamanho + 0,4 m"
  if (rule === "size") return "igual ao tamanho"
  return "manual"
}

export function calculateKitMaterialQuantity(materialName: string, kitMeters: number, fallback = 0) {
  if (!Number.isFinite(kitMeters) || kitMeters <= 0) return Number(fallback || 0)
  const rule = kitMaterialRule(materialName)
  if (rule === "tape") return rounded(kitMeters * KIT_TAPE_METERS_PER_METER)
  if (rule === "line") return rounded(kitMeters + KIT_LINE_EXTRA_METERS)
  if (rule === "size") return rounded(kitMeters)
  return Number(fallback || 0)
}

type KitCompositionMaterial = Pick<Material, "id" | "name" | "status" | "composesKit">

export function calculateKitComposition(
  kitName: string,
  sizeValue: unknown,
  materials: KitCompositionMaterial[],
  currentItems: Array<{ materialId: string; quantity: number }> = [],
) {
  const definition = parseKitDefinition(kitName, sizeValue)
  const available = materials.filter((material) => material.status === "Ativo" && material.composesKit)

  if (!definition.sizeMeters || definition.diameters.length < 2) {
    return {
      ...definition,
      items: currentItems.map((item) => {
        const material = materials.find((row) => row.id === item.materialId)
        return material ? { ...item, quantity: calculateKitMaterialQuantity(material.name, definition.sizeMeters, item.quantity) } : item
      }),
      missingMaterials: [] as string[],
      completeDefinition: false,
    }
  }

  const expected = [
    ...definition.diameters.flatMap((diameter) => [
      { base: "tubo de cobre", diameter, label: `Tubo de cobre ${diameter}` },
      { base: "isolante", diameter, label: `Isolante ${diameter}` },
    ]),
    { base: "linha de pedreiro", diameter: "", label: "Linha de pedreiro" },
    { base: "corrugado", diameter: "", label: "Corrugado" },
    { base: "fita prata", diameter: "", label: "Fita Prata" },
  ]

  const foundItems: Array<{ materialId: string; quantity: number }> = []
  const missingMaterials: string[] = []
  for (const requirement of expected) {
    const material = available.find((candidate) => {
      const name = normalized(candidate.name)
      if (!name.includes(requirement.base)) return false
      return !requirement.diameter || canonicalDiameter(candidate.name) === requirement.diameter
    })
    if (!material) {
      missingMaterials.push(requirement.label)
      continue
    }
    if (!foundItems.some((item) => item.materialId === material.id)) {
      foundItems.push({
        materialId: material.id,
        quantity: calculateKitMaterialQuantity(material.name, definition.sizeMeters),
      })
    }
  }

  const manualItems = currentItems.filter((item) => {
    const material = materials.find((row) => row.id === item.materialId)
    return material && kitMaterialRule(material.name) === "manual" && !foundItems.some((found) => found.materialId === item.materialId)
  })

  return {
    ...definition,
    items: [...foundItems, ...manualItems],
    missingMaterials,
    completeDefinition: true,
  }
}

export function inferKitMeters(
  kitName: string,
  items: Array<{ materialId: string; quantity: number }>,
  materials: Material[],
) {
  const candidates = items.flatMap((item) => {
    const material = materials.find((row) => row.id === item.materialId)
    if (!material) return []
    const quantity = Number(item.quantity || 0)
    const rule = kitMaterialRule(material.name)
    const candidate = rule === "tape" ? quantity / KIT_TAPE_METERS_PER_METER : rule === "line" ? quantity - KIT_LINE_EXTRA_METERS : rule === "size" ? quantity : 0
    return candidate > 1.01 ? [candidate] : []
  }).sort((left, right) => left - right)
  if (candidates.length) return rounded(candidates[Math.floor(candidates.length / 2)])

  return parseKitDefinition(kitName).sizeMeters
}
