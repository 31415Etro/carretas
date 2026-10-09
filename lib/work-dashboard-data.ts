type Row = Record<string, any>

function normalize(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

export function dashboardWorks(budgets: Row[], operational: Row[], clients: Row[], clientId: string) {
  const byId = new Map<string, Row>(operational.map((work) => [work.id, work]))
  const aliases = new Map<string, Set<string>>()
  for (const client of clients) {
    for (const name of [client.name, client.trade_name, client.corporate_name].filter(Boolean)) {
      const key = normalize(name)
      const ids = aliases.get(key) || new Set<string>()
      ids.add(client.id)
      aliases.set(key, ids)
    }
  }
  for (const budget of budgets) {
    const existing = byId.get(budget.id)
    const matches = aliases.get(normalize(budget.client_name))
    const resolved = existing?.client_id || budget.client_id || (matches?.size === 1 ? [...matches][0] : "")
    byId.set(budget.id, { ...budget, ...existing, name: budget.name || existing?.name, client_id: resolved })
  }
  const budgetIds = new Set(budgets.map((work) => work.id))
  return [...byId.values()].filter((work) => {
    if (budgetIds.has(work.id)) return true
    const type = normalize(work.type)
    if (["pmoc", "servicos diversos", "servicos", "visita tecnica"].includes(type)) return false
    // Older generated locations may have no type, but retain their generated name/code.
    return type || !(/^(pmoc|servicos diversos)\s*-/.test(normalize(work.name)) || /^(PMOC|OS-SD)-/i.test(work.code || ""))
  }).map((work) => ({
    id: String(work.id), clientId: String(work.client_id || ""),
    clientName: work.client_name || "", name: work.name || "Obra",
  })).filter((work) => !clientId || work.clientId === clientId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }))
}

function meta(row: Row, key: string) {
  const prefix = `__budget_${key}:`
  return String(row.notes || "").split(/\r?\n/).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() || ""
}

export function mergeOperationalHierarchy(
  hierarchy: { towers: Row[]; floors: Row[]; finals: Row[]; environments: Row[]; points: Row[] },
  operational: { floors: Row[]; environments: Row[]; points: Row[] },
  workId: string,
) {
  const towers = new Map(hierarchy.towers.map((row) => [row.id, row]))
  const floors = new Map(hierarchy.floors.map((row) => [row.id, row]))
  const finals = new Map(hierarchy.finals.map((row) => [row.id, row]))
  const environments = new Map(hierarchy.environments.map((row) => [row.id, row]))
  const points = new Map(hierarchy.points.map((row) => [row.id, row]))
  const sourceFloors = new Map(operational.floors.map((row) => [row.id, row]))
  for (const environment of operational.environments) {
    if (environments.has(environment.id)) continue
    const sourceFloor = sourceFloors.get(environment.floor_id)
    const towerId = meta(environment, "tower_id") || meta(sourceFloor || {}, "tower_id") || `work:${workId}`
    const floorId = environment.floor_id || `floor:${workId}:${environment.floor || "none"}`
    if (!floors.has(floorId)) {
      if (!towers.has(towerId)) towers.set(towerId, { id: towerId, name: meta(environment, "tower_name") || meta(sourceFloor || {}, "tower_name") || "Obra", description: "" })
      floors.set(floorId, { id: floorId, budget_tower_id: towerId, name: sourceFloor?.name || environment.floor || "Sem pavimento", level: "" })
    }
    const finalId = meta(environment, "type_id") || `final:${floorId}:${environment.final || "none"}`
    if (!finals.has(finalId)) finals.set(finalId, { id: finalId, budget_floor_id: floorId, name: environment.final || "Sem final" })
    environments.set(environment.id, { ...environment, name: environment.environment_name, budget_service_type_id: finalId })
  }
  for (const point of operational.points) {
    if (!points.has(point.id) && environments.has(point.environment_id)) {
      points.set(point.id, { ...point, name: point.point_name, budget_environment_id: point.environment_id })
    }
  }
  return { towers: [...towers.values()], floors: [...floors.values()], finals: [...finals.values()], environments: [...environments.values()], points: [...points.values()] }
}
