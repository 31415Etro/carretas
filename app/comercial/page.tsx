"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Bookmark, Building2, Crosshair, Filter, MapPinned, Search, Send, Upload } from "lucide-react"
import { PageShell, SectionCard, MetricCard, DataTable, StatusBadge } from "@/components/operations/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { decodeOpenLocationCode } from "@/lib/comercial-cno"
import { BantKanban } from "@/components/commercial/bant-kanban"

type CnoPoint = {
  id: string
  cno: string
  name: string
  companyName: string
  zipCode: string
  address: string
  district: string
  city: string
  state: string
  areaTotal: string
  workStatus: string
  locationCode: string
  phone: string
  email: string
  lat: number | null
  lng: number | null
  savedAt?: string | null
  commercialStatus?: "Novo" | "Salvo" | "Enviado"
  sentAt?: string | null
  status: "Código CNO" | "Com coordenadas" | "Sem coordenadas" | "Geocodificado"
}

type AreaFilter = {
  state: string
  city: string
  district: string
}

type LeafletInstance = {
  L: any
  map: any
  layer: any
}

const BRAZIL_CENTER: [number, number] = [-14.235, -51.9253]
const IMPORT_BATCH_SIZE = 700
const TABLE_PAGE_SIZE = 120
const MAP_POINT_LIMIT = 900
const GEOCODE_BATCH_SIZE = 50

declare global {
  interface Window {
    L?: any
  }
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function pick(row: Record<string, unknown>, candidates: string[]) {
  const entries = Object.entries(row)
  const normalized = candidates.map(normalizeKey)
  const found = entries.find(([key]) => normalized.includes(normalizeKey(key)))
  return found?.[1] == null ? "" : String(found[1]).trim()
}

function parseNumber(value: string) {
  if (!value) return null
  const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function buildAddress(row: Record<string, unknown>) {
  const type = pick(row, ["Tipo de endereço", "Tipo de endereco"])
  const street = pick(row, ["Endereço", "Endereco", "Logradouro", "Rua"])
  const number = pick(row, ["Número do endereço", "Numero do endereco", "Número", "Numero"])
  const district = pick(row, ["Bairro"])
  const city = pick(row, ["Cidade", "Município", "Municipio"])
  const state = pick(row, ["Estado", "UF"])
  const zipCode = pick(row, ["CEP"])
  const line = [type, street].filter(Boolean).join(" ")
  return [line, number, district, city, state, zipCode, "Brasil"].filter(Boolean).join(", ")
}

function mapRow(row: Record<string, unknown>, index: number): CnoPoint {
  const locationCode = pick(row, ["Código da localização", "Codigo da localizacao"])
  const decoded = decodeOpenLocationCode(locationCode)
  const lat = parseNumber(pick(row, ["Lat", "Latitude"])) ?? decoded?.lat ?? null
  const lng = parseNumber(pick(row, ["Lng", "Long", "Lon", "Longitude"])) ?? decoded?.lng ?? null
  const city = pick(row, ["Cidade", "Município", "Municipio"])
  const state = pick(row, ["Estado", "UF"])
  const district = pick(row, ["Bairro"])
  const address = buildAddress(row)
  const cno = pick(row, ["CNO", "Cadastro Nacional de Obras", "Cadastro Nacional Obra"]) || `Registro ${index + 1}`
  const name =
    pick(row, ["Razão Social", "Razao Social", "Nome Empresarial", "Nome", "Empresa", "Responsável", "Responsavel"]) ||
    `Registro ${index + 1}`

  return {
    id: `${cno}-${index}`,
    cno,
    name,
    companyName: pick(row, ["Nome Empresarial"]),
    zipCode: pick(row, ["CEP"]),
    address,
    district,
    city,
    state,
    areaTotal: pick(row, ["Área total", "Area total", "Metragem"]),
    workStatus: pick(row, ["Situação da obra", "Situacao da obra"]),
    locationCode: pick(row, ["Código da localização", "Codigo da localizacao"]),
    phone: pick(row, ["Telefone 1", "Telefone"]),
    email: pick(row, ["E-mail", "Email"]),
    lat,
    lng,
    status: lat != null && lng != null ? "Código CNO" : "Sem coordenadas",
  }
}

function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Mapa indisponível no servidor."))
  if (window.L) return Promise.resolve(window.L)

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-leaflet]")
    const existingCss = document.querySelector("link[data-leaflet-css]")
    if (!existingCss) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      link.dataset.leafletCss = "true"
      document.head.appendChild(link)
    }
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.L))
      existingScript.addEventListener("error", () => reject(new Error("Não foi possível carregar o Leaflet.")))
      return
    }
    const script = document.createElement("script")
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    script.async = true
    script.dataset.leaflet = "true"
    script.onload = () => resolve(window.L)
    script.onerror = () => reject(new Error("Não foi possível carregar o Leaflet."))
    document.body.appendChild(script)
  })
}

function LeafletMap({
  points,
  selectedId,
  onSelect,
}: {
  points: CnoPoint[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<LeafletInstance | null>(null)
  const selectedRef = useRef(selectedId)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    let disposed = false
    loadLeaflet().then((L) => {
      if (disposed || !mapRef.current || leafletRef.current) return
      const map = L.map(mapRef.current, { zoomControl: false }).setView(BRAZIL_CENTER, 4)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)
      L.control.zoom({ position: "topright" }).addTo(map)
      leafletRef.current = { L, map, layer: L.layerGroup().addTo(map) }
      setMapReady(true)
    })

    return () => {
      disposed = true
      leafletRef.current?.map?.remove()
      leafletRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const instance = leafletRef.current
    if (!instance) return
    const { L, map, layer } = instance
    const valid = points.filter((point) => point.lat != null && point.lng != null)
    layer.clearLayers()

    const pinIcon = L.divIcon({
      className: "",
      html: '<div style="width:18px;height:18px;border-radius:999px;background:#2563eb;border:3px solid white;box-shadow:0 8px 18px rgba(15,23,42,.35)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    const activeIcon = L.divIcon({
      className: "",
      html: '<div style="width:24px;height:24px;border-radius:999px;background:#ef4444;border:4px solid white;box-shadow:0 10px 22px rgba(15,23,42,.45)"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
    const sentIcon = L.divIcon({
      className: "",
      html: '<div style="width:20px;height:20px;border-radius:999px;background:#dc2626;border:3px solid white;box-shadow:0 8px 18px rgba(15,23,42,.35)"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    })

    valid.forEach((point) => {
      const icon = point.id === selectedRef.current ? activeIcon : point.commercialStatus === "Enviado" ? sentIcon : pinIcon
      const marker = L.marker([point.lat, point.lng], { icon })
      marker.bindTooltip(`${point.cno} - ${point.name}`)
      marker.on("click", () => onSelect(point.id))
      marker.addTo(layer)
    })

    if (valid.length) {
      const bounds = L.latLngBounds(valid.map((point) => [point.lat, point.lng]))
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 })
    } else {
      map.setView(BRAZIL_CENTER, 4)
    }
  }, [points, selectedId, onSelect, mapReady])

  return (
    <div className="overflow-hidden rounded-lg border bg-muted">
      <div ref={mapRef} className="h-[560px] w-full" />
    </div>
  )
}

export default function ComercialPage() {
  const [commercialTab, setCommercialTab] = useState("area")
  const [points, setPoints] = useState<CnoPoint[]>([])
  const [mapPoints, setMapPoints] = useState<CnoPoint[]>([])
  const [stats, setStats] = useState({ total: 0, withCoords: 0, withoutCoords: 0, mostCommonState: "-" })
  const [totalCount, setTotalCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [visibleLimit, setVisibleLimit] = useState(TABLE_PAGE_SIZE)
  const [isImporting, setIsImporting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [importProgress, setImportProgress] = useState({ loaded: 0, total: 0 })
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [isFixingPins, setIsFixingPins] = useState(false)
  const [showSavedOnly, setShowSavedOnly] = useState(false)
  const [areaDraft, setAreaDraft] = useState<AreaFilter>({ state: "", city: "", district: "" })
  const [areaFilter, setAreaFilter] = useState<AreaFilter>({ state: "", city: "", district: "" })
  const [areaOptions, setAreaOptions] = useState({ states: [] as string[], cities: [] as string[], districts: [] as string[] })

  const hasAreaFilter = Boolean(areaFilter.state || areaFilter.city || areaFilter.district)

  const visibleRows = points
  const selected = [...points, ...mapPoints].find((point) => point.id === selectedId) || null
  const withCoords = stats.withCoords
  const withoutCoords = stats.withoutCoords

  const mostCommonState = stats.mostCommonState

  const loadAreaOptions = useCallback(async (optionLevel: "states" | "cities" | "districts", filter: { state?: string; city?: string } = {}) => {
    const params = new URLSearchParams({ optionLevel })
    if (filter.state) params.set("state", filter.state)
    if (filter.city) params.set("city", filter.city)
    const response = await fetch(`/api/comercial-cno?${params.toString()}`, { cache: "no-store" })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || "Erro ao carregar filtros comerciais.")
    setAreaOptions((current) => ({ ...current, [optionLevel]: Array.isArray(payload.options) ? payload.options : [] }))
  }, [])

  useEffect(() => {
    loadAreaOptions("states").catch((error) => console.error("Erro ao carregar UFs", error))
  }, [loadAreaOptions])

  useEffect(() => {
    if (!areaDraft.state) {
      setAreaOptions((current) => ({ ...current, cities: [], districts: [] }))
      return
    }
    loadAreaOptions("cities", { state: areaDraft.state }).catch((error) => console.error("Erro ao carregar cidades", error))
  }, [areaDraft.state, loadAreaOptions])

  useEffect(() => {
    if (!areaDraft.state || !areaDraft.city) {
      setAreaOptions((current) => ({ ...current, districts: [] }))
      return
    }
    loadAreaOptions("districts", { state: areaDraft.state, city: areaDraft.city }).catch((error) => console.error("Erro ao carregar bairros", error))
  }, [areaDraft.city, areaDraft.state, loadAreaOptions])

  const loadFromDatabase = useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams()
    params.set("limit", String(visibleLimit))
    params.set("offset", "0")
    params.set("map", hasAreaFilter || showSavedOnly ? "1" : "0")
    params.set("mapLimit", String(MAP_POINT_LIMIT))
    if (showSavedOnly) params.set("saved", "1")
    if (query.trim()) params.set("query", query.trim())
    if (areaFilter.state.trim()) params.set("state", areaFilter.state.trim())
    if (areaFilter.city.trim()) params.set("city", areaFilter.city.trim())
    if (areaFilter.district.trim()) params.set("district", areaFilter.district.trim())

    try {
      const response = await fetch(`/api/comercial-cno?${params.toString()}`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Erro ao carregar base CNO.")
      setPoints(payload.rows || [])
      setMapPoints(payload.mapRows || [])
      setTotalCount(payload.total || 0)
      setStats(payload.stats || { total: 0, withCoords: 0, withoutCoords: 0, mostCommonState: "-" })
    } catch (error) {
      alert(error instanceof Error ? error.message : "Erro ao carregar base CNO.")
    } finally {
      setIsLoading(false)
    }
  }, [areaFilter.city, areaFilter.district, areaFilter.state, hasAreaFilter, query, showSavedOnly, visibleLimit])

  useEffect(() => {
    loadFromDatabase()
  }, [loadFromDatabase])

  const applyAreaFilter = () => {
    setAreaFilter({
      state: areaDraft.state.trim(),
      city: areaDraft.city.trim(),
      district: areaDraft.district.trim(),
    })
    setVisibleLimit(TABLE_PAGE_SIZE)
    setSelectedId(null)
  }

  const clearAreaFilter = () => {
    setAreaDraft({ state: "", city: "", district: "" })
    setAreaFilter({ state: "", city: "", district: "" })
    setVisibleLimit(TABLE_PAGE_SIZE)
    setSelectedId(null)
  }

  const handleImport = async (file: File | null) => {
    if (!file) return
    setIsImporting(true)
    setPoints([])
    setMapPoints([])
    setSelectedId(null)
    setVisibleLimit(TABLE_PAGE_SIZE)
    setImportProgress({ loaded: 0, total: 0 })

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).filter((row) =>
      Object.values(row).some((value) => String(value ?? "").trim()),
    )
    const total = rows.length
    setImportProgress({ loaded: 0, total })

    for (let index = 0; index < total; index += IMPORT_BATCH_SIZE) {
      const slice = rows.slice(index, index + IMPORT_BATCH_SIZE)
      const mapped = slice.map((row, offset) => mapRow(row, index + offset))
      const response = await fetch("/api/comercial-cno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setIsImporting(false)
        alert(payload.error || "Erro ao salvar lote da base CNO.")
        return
      }
      setImportProgress({ loaded: Math.min(index + IMPORT_BATCH_SIZE, total), total })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
    setImportProgress({ loaded: total, total })
    setIsImporting(false)
    await Promise.all([loadFromDatabase(), loadAreaOptions("states")])
  }

  const geocodeAreaBatch = useCallback(async () => {
    const candidates = points.filter((point) => point.lat == null || point.lng == null).slice(0, GEOCODE_BATCH_SIZE)
    if (!hasAreaFilter) {
      alert("Pesquise uma área primeiro. Isso evita geocodificar a base inteira de uma vez.")
      return
    }
    if (!candidates.length) return
    setIsGeocoding(true)
    const updates = new Map<string, Partial<CnoPoint>>()

    for (const point of candidates) {
      const target = point.address || [point.name, point.city, point.state, point.zipCode, "Brasil"].filter(Boolean).join(", ")
      if (!target.trim()) continue
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(target)}`,
          { headers: { Accept: "application/json" } },
        )
        const result = await response.json()
        const first = Array.isArray(result) ? result[0] : null
        if (first?.lat && first?.lon) {
          updates.set(point.id, { lat: Number(first.lat), lng: Number(first.lon), status: "Geocodificado" })
        }
      } catch {
        // Mantém o registro sem coordenadas para revisão manual.
      }
      await new Promise((resolve) => setTimeout(resolve, 1100))
    }

    const changed = points.map((point) => ({ ...point, ...(updates.get(point.id) || {}) })).filter((point) => updates.has(point.id))
    if (changed.length) {
      await fetch("/api/comercial-cno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: changed }),
      })
      await loadFromDatabase()
    }
    setIsGeocoding(false)
  }, [hasAreaFilter, loadFromDatabase, points])

  const fixPinsFromCnoCode = useCallback(async () => {
    setIsFixingPins(true)
    let totalUpdated = 0
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch("/api/comercial-cno", { method: "PATCH" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Erro ao corrigir pinos CNO.")
        totalUpdated += Number(payload.updated || 0)
        if (Number(payload.scanned || 0) < 1000 || Number(payload.updated || 0) === 0) break
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
      await loadFromDatabase()
      alert(totalUpdated ? `${totalUpdated} pinos corrigidos pelo Código da localização do CNO.` : "Nenhum pino pendente com código CNO válido foi encontrado.")
    } catch (error) {
      alert(error instanceof Error ? error.message : "Erro ao corrigir pinos CNO.")
    } finally {
      setIsFixingPins(false)
    }
  }, [loadFromDatabase])

  const updateCommercialStatus = async (id: string, action: "save" | "sent" | "unsave") => {
    const response = await fetch("/api/comercial-cno", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    })
    const payload = await response.json()
    if (!response.ok) {
      alert(payload.error || "Erro ao atualizar registro comercial.")
      return
    }
    const updated = payload.row as CnoPoint
    setPoints((current) => current.map((point) => (point.id === id ? { ...point, ...updated } : point)))
    setMapPoints((current) => current.map((point) => (point.id === id ? { ...point, ...updated } : point)))
    setSelectedId(updated.id)
  }

  const cnoTableHeaders = [
    "CNO",
    "Responsável",
    "Empresa",
    "Cidade/UF",
    "Bairro",
    "Telefone",
    "E-mail",
    "Área",
    "Situação",
    "Coordenadas",
    "Comercial",
    "Status",
  ]

  return (
    <PageShell
      title="Comercial"
      description={commercialTab === "area" ? "Pesquise a base CNO por area e visualize os registros no mapa." : "Qualifique leads com BANT e acompanhe o funil de prospeccao."}
      actions={
        commercialTab === "area" ? <>
          <Button asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4" />
              Importar base CNO
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => handleImport(event.target.files?.[0] || null)}
              />
            </label>
          </Button>
          <Button variant="secondary" onClick={geocodeAreaBatch} disabled={isGeocoding || !totalCount}>
            <Crosshair className="h-4 w-4" />
            {isGeocoding ? "Geocodificando..." : "Geocodificar área"}
          </Button>
          <Button variant="secondary" onClick={fixPinsFromCnoCode} disabled={isFixingPins || !stats.total}>
            <MapPinned className="h-4 w-4" />
            {isFixingPins ? "Corrigindo pinos..." : "Corrigir pinos CNO"}
          </Button>
          <Button variant={showSavedOnly ? "default" : "secondary"} onClick={() => { setShowSavedOnly((current) => !current); setVisibleLimit(TABLE_PAGE_SIZE); setSelectedId(null) }}>
            <Bookmark className="h-4 w-4" />
            {showSavedOnly ? "Todos os registros" : "Ver salvos"}
          </Button>
        </> : null
      }
    >
      <Tabs value={commercialTab} onValueChange={setCommercialTab} className="space-y-4">
        <TabsList><TabsTrigger value="area">Pesquisa por area</TabsTrigger><TabsTrigger value="bant">Funil BANT</TabsTrigger></TabsList>
        <TabsContent value="area" className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Registros importados" value={stats.total} note={isImporting ? `${importProgress.loaded} de ${importProgress.total}` : "Salvos no Supabase"} icon={Building2} />
        <MetricCard title="Com coordenadas" value={withCoords} note="Prontos para o mapa" icon={MapPinned} />
        <MetricCard title="Sem coordenadas" value={withoutCoords} note="Geocodifique apenas a área pesquisada" icon={Crosshair} />
        <MetricCard title="UF principal" value={mostCommonState} note="Estado mais frequente" icon={Search} />
      </div>

      <SectionCard title="Pesquisar por área" description="A base grande não é jogada inteira no mapa. Pesquise por UF, cidade ou bairro; depois geocodifique só esse recorte.">
        <div className="grid gap-3 lg:grid-cols-[160px_1fr_1fr_auto_auto]">
          <Select
            value={areaDraft.state || "all-states"}
            onValueChange={(value) => setAreaDraft({ state: value === "all-states" ? "" : value, city: "", district: "" })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="Selecione a UF" /></SelectTrigger>
                    <SelectContent className="z-[2000]" sortItems>
              <SelectItem value="all-states">Todas as UFs</SelectItem>
              {areaOptions.states.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            disabled={!areaDraft.state}
            value={areaDraft.city || "all-cities"}
            onValueChange={(value) => setAreaDraft((current) => ({ ...current, city: value === "all-cities" ? "" : value, district: "" }))}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="Selecione a cidade" /></SelectTrigger>
                    <SelectContent className="z-[2000]" sortItems>
              <SelectItem value="all-cities">Todas as cidades</SelectItem>
              {areaOptions.cities.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            disabled={!areaDraft.city}
            value={areaDraft.district || "all-districts"}
            onValueChange={(value) => setAreaDraft((current) => ({ ...current, district: value === "all-districts" ? "" : value }))}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="Selecione o bairro" /></SelectTrigger>
                    <SelectContent className="z-[2000]" sortItems>
              <SelectItem value="all-districts">Todos os bairros</SelectItem>
              {areaOptions.districts.map((district) => <SelectItem key={district} value={district}>{district}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={applyAreaFilter}><Filter className="h-4 w-4" />Pesquisar área</Button>
          <Button variant="secondary" onClick={clearAreaFilter}>Limpar área</Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Resultado atual: <strong>{totalCount}</strong> registros. O mapa exibe até {MAP_POINT_LIMIT} pinos do recorte com coordenadas para manter a tela leve.
        </p>
      </SectionCard>

      <div className="space-y-4">
        <SectionCard
          title="Mapa CNO"
          description={
            hasAreaFilter
              ? "Pinos da área pesquisada. Se não aparecerem pinos, clique em Geocodificar área."
              : "Pesquise uma área para carregar os pinos no mapa sem pesar a página."
          }
        >
          <LeafletMap points={mapPoints} selectedId={selectedId} onSelect={setSelectedId} />
          {hasAreaFilter && totalCount > MAP_POINT_LIMIT ? (
            <p className="mt-2 text-sm text-muted-foreground">Mostrando os primeiros {MAP_POINT_LIMIT} pinos com coordenadas dentro do recorte.</p>
          ) : null}
        </SectionCard>

        <SectionCard title="Registro selecionado" description="Clique em um pino ou em uma linha da tabela para ver o detalhe.">
          {selected ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">CNO</p>
                <p className="font-semibold">{selected.cno}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Responsável / Razão social</p>
                <p className="font-semibold">{selected.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Empresa</p>
                <p className="font-semibold">{selected.companyName || "-"}</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">Telefone do proprietário</p>
                  <p className="font-semibold">{selected.phone || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">E-mail do proprietário</p>
                  <p className="font-semibold break-all">{selected.email || "-"}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Endereço</p>
                <p className="font-semibold">{selected.address || "-"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">Área total</p>
                  <p className="font-semibold">{selected.areaTotal || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Situação</p>
                  <p className="font-semibold">{selected.workStatus || "-"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">Latitude</p>
                  <p className="font-semibold">{selected.lat ?? "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Longitude</p>
                  <p className="font-semibold">{selected.lng ?? "-"}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} />
                <StatusBadge status={selected.commercialStatus || "Novo"} />
              </div>
              <div className="grid gap-2 md:col-span-2 xl:col-span-4 xl:grid-cols-3">
                <Button onClick={() => updateCommercialStatus(selected.id, "save")} disabled={Boolean(selected.savedAt)}>
                  <Bookmark className="h-4 w-4" />
                  {selected.savedAt ? "Registro salvo" : "Salvar registro"}
                </Button>
                <Button variant="secondary" onClick={() => updateCommercialStatus(selected.id, "sent")}>
                  <Send className="h-4 w-4" />
                  Marcar como Enviado
                </Button>
                {selected.savedAt ? (
                  <Button variant="outline" onClick={() => updateCommercialStatus(selected.id, "unsave")}>
                    Remover dos salvos
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Importe a base CNO e selecione uma linha ou pino.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Base CNO importada" description="Tabela paginada para bases grandes. Use o botão Carregar mais para avançar sem travar a tela.">
        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(260px,1fr)_auto]">
          <Input placeholder="Filtrar por CNO, responsável, empresa, endereço, cidade, UF ou situação..." value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(TABLE_PAGE_SIZE) }} />
          <div className="rounded-md border bg-background px-4 py-2 text-sm text-muted-foreground">
            {isLoading ? "Carregando..." : `Mostrando ${visibleRows.length} de ${totalCount}`}
          </div>
        </div>
        <div className="overflow-x-auto">
          <DataTable headers={cnoTableHeaders} empty={!visibleRows.length}>
            {visibleRows.map((point) => (
              <TableRow key={point.id} className="cursor-pointer" onClick={() => setSelectedId(point.id)}>
                <TableCell className="font-medium">{point.cno}</TableCell>
                <TableCell>{point.name}</TableCell>
                <TableCell>{point.companyName || "-"}</TableCell>
                <TableCell>{[point.city, point.state].filter(Boolean).join(" / ") || "-"}</TableCell>
                <TableCell>{point.district || "-"}</TableCell>
                <TableCell>{point.phone || "-"}</TableCell>
                <TableCell>{point.email || "-"}</TableCell>
                <TableCell>{point.areaTotal || "-"}</TableCell>
                <TableCell>{point.workStatus || "-"}</TableCell>
                <TableCell>{point.lat != null && point.lng != null ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "-"}</TableCell>
                <TableCell><StatusBadge status={point.commercialStatus || "Novo"} /></TableCell>
                <TableCell><StatusBadge status={point.status} /></TableCell>
              </TableRow>
            ))}
          </DataTable>
        </div>
        {visibleLimit < totalCount ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={() => setVisibleLimit((current) => current + TABLE_PAGE_SIZE)}>Carregar mais registros</Button>
          </div>
        ) : null}
      </SectionCard>
        </TabsContent>
        <TabsContent value="bant"><BantKanban /></TabsContent>
      </Tabs>
    </PageShell>
  )
}
