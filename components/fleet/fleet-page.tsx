"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { ConfirmInline, DataTable, FormSheet, MetricCard, PageShell, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { useAuth } from "@/lib/auth-context"
import { cnhCategories, downtimeHours, fleetAlerts, fuelConsumption, fuelTotal, fuelTypes, tirePositions, tripResult, typeInfo, vehicleStatusLabels, vehicleStatuses, vehicleTypes } from "@/lib/fleet"
import { AlertTriangle, Fuel, Truck, Wrench } from "lucide-react"

type Row = Record<string, any>
type Unit = { id: string; name: string; cnpj: string }
type Data = { vehicles: Row[]; drivers: Row[]; maintenance: Row[]; fuel: Row[]; documents: Row[]; tires: Row[]; trips: Row[] }
const emptyData: Data = { vehicles: [], drivers: [], maintenance: [], fuel: [], documents: [], tires: [], trips: [] }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const today = () => new Date().toISOString().slice(0, 10)
const none = "nenhum"
const tireConditions = ["Novo", "3/4 vida", "Meia vida", "1/4 vida", "Solicitar troca"]
const docTypes = ["CRLV", "Apólice de seguro", "Laudo / inspeção", "ANTT / RNTRC", "Nota fiscal de compra", "Contrato de financiamento", "Foto", "Outro"]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

async function upload(file: File, folder: string) {
  const body = new FormData()
  body.set("file", file)
  body.set("folder", folder)
  return api<{ path: string; name: string }>("/api/frota/file", { method: "POST", body })
}

const fileLink = (path?: string, label = "Abrir") => (path ? <a className="text-primary underline" href={`/api/frota/file?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer">{label}</a> : "-")

const emptyVehicle = (): Row => ({
  id: "", vehicleType: "Caminhao", fleetNumber: "", plate: "", renavam: "", chassis: "", brand: "", model: "", manufactureYear: "", modelYear: "", color: "", ownerName: "", ownerDocument: "", unitCompanyId: "",
  bodyType: "", loadCapacityKg: "", tareKg: "", axles: "", currentKm: "", currentHours: "", driverId: "", status: "Disponivel", acquisitionDate: "", acquisitionValue: "", licensingDueDate: "",
  insurer: "", policyNumber: "", policyExpiry: "", coupledVehicleId: "", photoPath: "", notes: "",
})
const emptyDriver = (): Row => ({ id: "", name: "", cpf: "", phone: "", cnhNumber: "", cnhCategory: "E", cnhExpiry: "", status: "Ativo", notes: "" })
const emptyMaintenance = (): Row => ({ id: "", vehicleId: "", maintenanceType: "Preventiva", startDate: today(), endDate: "", odometer: "", hours: "", serviceDescription: "", serviceOrderId: "", partsReplaced: "", workshop: "", partsCost: "", laborCost: "", nextDate: "", nextKm: "", nextHours: "", stoppedAt: "", releasedAt: "", releasedBy: "", status: "Programada" })
const emptyFuel = (): Row => ({ id: "", vehicleId: "", driverId: "", fuelDate: today(), station: "", fuelType: "Diesel S10", liters: "", pricePerLiter: "", odometer: "", receiptPath: "", receiptName: "", notes: "" })
const emptyDocument = (): Row => ({ id: "", vehicleId: "", docType: "CRLV", description: "", expiryDate: "", filePath: "", fileName: "" })
const emptyTrip = (): Row => ({ id: "", vehicleId: "", trailerId: "", driverId: "", origin: "", destination: "", startDate: today(), endDate: "", startKm: "", endKm: "", freightAmount: "", tollsAmount: "", allowanceAmount: "", otherCosts: "", status: "Planejada", notes: "" })

function Opts({ label, value, onChange, items, placeholder = "Selecione" }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string }) {
  return <SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} />
}

export function FleetPage() {
  const { toast } = useCrudFeedback()
  const { user } = useAuth()
  const canConfigure = user?.role === "admin" || user?.role === "manager"
  const [data, setData] = useState<Data>(emptyData)
  const [roadTransport, setRoadTransport] = useState(false)
  const [units, setUnits] = useState<Unit[]>([])
  const [orders, setOrders] = useState<Array<{ id: string; number: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [form, setForm] = useState<{ entity: keyof Data | ""; item: Row }>({ entity: "", item: {} })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settings, vehicles, drivers, maintenance, fuel, documents, tires, trips] = await Promise.all([
        api<{ roadTransport: boolean; units: Unit[]; orders: Array<{ id: string; number: string }> }>("/api/frota/settings"),
        ...(["vehicles", "drivers", "maintenance", "fuel", "documents", "tires", "trips"] as const).map((entity) => api<{ items: Row[] }>(`/api/frota/${entity}`)),
      ])
      setRoadTransport(settings.roadTransport)
      setUnits(settings.units)
      setOrders(settings.orders)
      setData({ vehicles: vehicles.items, drivers: drivers.items, maintenance: maintenance.items, fuel: fuel.items, documents: documents.items, tires: tires.items, trips: trips.items })
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar a frota.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const vehicleLabel = useCallback((id?: string) => {
    const vehicle = data.vehicles.find((row) => row.id === id)
    return vehicle ? `${vehicle.fleetNumber} · ${vehicle.plate || vehicle.model || vehicle.internalCode}` : "-"
  }, [data.vehicles])
  const driverName = (id?: string) => data.drivers.find((row) => row.id === id)?.name || "-"
  const unitName = (id?: string) => units.find((row) => row.id === id)?.name || "-"
  const activeVehicles = data.vehicles.filter((row) => !["Vendido", "Inativo"].includes(row.status))
  const vehicleItems = activeVehicles.map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))
  const driverItems = data.drivers.filter((row) => row.status === "Ativo").map((row) => ({ value: row.id, label: row.name }))

  const alerts = useMemo(() => fleetAlerts({
    vehicles: data.vehicles.map((row) => ({ id: row.id, label: vehicleLabel(row.id), licensingDueDate: row.licensingDueDate, policyExpiry: row.policyExpiry, currentKm: row.currentKm, currentHours: row.currentHours, status: row.status })),
    drivers: data.drivers.map((row) => ({ name: row.name, cnhExpiry: row.cnhExpiry, status: row.status })),
    documents: data.documents.map((row) => ({ vehicleId: row.vehicleId, docType: row.docType, expiryDate: row.expiryDate })),
    maintenance: data.maintenance.filter((row) => row.status !== "Realizada" || row.nextKm || row.nextDate || row.nextHours).map((row) => ({ vehicleId: row.vehicleId, description: row.serviceDescription, nextDate: row.nextDate, nextKm: row.nextKm, nextHours: row.nextHours })),
  }), [data, vehicleLabel])

  const open = (entity: keyof Data, item: Row) => setForm({ entity, item })
  const close = () => setForm({ entity: "", item: {} })
  const set = (patch: Row) => setForm((current) => ({ ...current, item: { ...current.item, ...patch } }))

  async function save(entity?: keyof Data, item?: Row) {
    const target = entity || form.entity
    const payload = item || form.item
    if (!target) return
    setSaving(true)
    try {
      await api(`/api/frota/${target}`, { method: "POST", body: JSON.stringify({ item: payload }) })
      toast({ title: "Salvo" })
      close()
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "Erro ao salvar.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function remove(entity: "documents" | "tires", id: string) {
    try {
      await api(`/api/frota/${entity}?id=${id}`, { method: "DELETE" })
      await load()
    } catch (reason) {
      toast({ title: "Erro ao excluir", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>, folder: string, apply: (file: { path: string; name: string }) => void) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      apply(await upload(file, folder))
    } catch (reason) {
      toast({ title: "Falha no envio", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function toggleRoad(value: boolean) {
    try {
      await api("/api/frota/settings", { method: "PUT", body: JSON.stringify({ roadTransport: value }) })
      setRoadTransport(value)
    } catch (reason) {
      toast({ title: "Erro", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  const needle = query.trim().toLowerCase()
  const shownVehicles = data.vehicles.filter((row) => !needle || [row.fleetNumber, row.plate, row.model, row.brand, row.chassis, row.internalCode].some((value) => String(value || "").toLowerCase().includes(needle)))
  const info = typeInfo(String(form.item.vehicleType || ""))
  const overdue = alerts.filter((alert) => alert.overdue).length
  const monthFuel = data.fuel.filter((row) => row.fuelDate?.slice(0, 7) === today().slice(0, 7)).reduce((sum, row) => sum + row.totalAmount, 0)
  const openMaintenance = data.maintenance.filter((row) => ["Programada", "Em andamento"].includes(row.status)).length
  const vehicleEntries = (id: string) => data.fuel.filter((row) => row.vehicleId === id).map((row) => ({ vehicleId: id, fuelDate: row.fuelDate, liters: row.liters, pricePerLiter: row.pricePerLiter, odometer: row.odometer }))
  const roadVehicles = activeVehicles.filter((row) => typeInfo(row.vehicleType)?.road)
  const tractors = roadVehicles.filter((row) => ["Cavalo mecanico", "Caminhao"].includes(row.vehicleType))
  const trailers = roadVehicles.filter((row) => ["Semirreboque", "Reboque"].includes(row.vehicleType))
  const [tireVehicle, setTireVehicle] = useState("")
  const tireTarget = data.vehicles.find((row) => row.id === tireVehicle)

  return (
    <PageShell
      title="Frota"
      description="Caminhões, cavalos mecânicos, carretas, implementos e demais veículos: cadastro, manutenção, abastecimento e vencimentos."
      actions={<><Button onClick={() => open("vehicles", emptyVehicle())}><Plus className="h-4 w-4" />Novo veículo</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Atualizar</Button></>}
    >
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="Veículos ativos" value={activeVehicles.length} note={`${data.vehicles.filter((row) => row.status === "Em manutencao").length} em manutenção`} icon={Truck} />
        <MetricCard title="Vencimentos" value={alerts.length} note={overdue ? `${overdue} vencido(s)` : "Nada vencido"} icon={AlertTriangle} />
        <MetricCard title="Manutenções abertas" value={openMaintenance} note="Programadas ou em andamento" icon={Wrench} />
        <MetricCard title="Combustível no mês" value={brl(monthFuel)} note="Abastecimentos lançados" icon={Fuel} />
      </div>
      <Tabs defaultValue="veiculos">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="veiculos">Veículos</TabsTrigger>
          <TabsTrigger value="motoristas">Motoristas</TabsTrigger>
          <TabsTrigger value="manutencao">Manutenção</TabsTrigger>
          <TabsTrigger value="abastecimento">Abastecimento</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="alertas">Alertas{alerts.length ? ` (${alerts.length})` : ""}</TabsTrigger>
          {roadTransport && <TabsTrigger value="pneus">Pneus</TabsTrigger>}
          {roadTransport && <TabsTrigger value="viagens">Viagens</TabsTrigger>}
          {canConfigure && <TabsTrigger value="config">Configuração</TabsTrigger>}
        </TabsList>

        <TabsContent value="veiculos">
          <SectionCard title="Veículos e implementos">
            <div className="mb-3 max-w-sm"><TextField label="Buscar" placeholder="Frota, placa, modelo ou chassi" value={query} onChange={setQuery} /></div>
            <DataTable headers={["Frota", "Tipo", "Placa", "Marca / modelo", "Km / horas", "Motorista", "Engatado a", "Unidade", "Status", "Ações"]} empty={!shownVehicles.length}>
              {shownVehicles.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.fleetNumber}<div className="text-xs text-muted-foreground">{row.internalCode}</div></TableCell>
                  <TableCell>{typeInfo(row.vehicleType)?.label || row.vehicleType}</TableCell>
                  <TableCell>{row.plate || "-"}</TableCell>
                  <TableCell>{row.brand} {row.model}</TableCell>
                  <TableCell>{typeInfo(row.vehicleType)?.motor === "horimetro" ? `${row.currentHours} h` : typeInfo(row.vehicleType)?.motor ? `${Number(row.currentKm).toLocaleString("pt-BR")} km` : "-"}</TableCell>
                  <TableCell>{driverName(row.driverId)}</TableCell>
                  <TableCell>{row.coupledVehicleId ? vehicleLabel(row.coupledVehicleId) : "-"}</TableCell>
                  <TableCell>{unitName(row.unitCompanyId)}</TableCell>
                  <TableCell><StatusBadge status={vehicleStatusLabels[row.status] || row.status} /></TableCell>
                  <TableCell><div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => open("vehicles", { ...emptyVehicle(), ...row })}>Editar</Button>
                    {!["Inativo", "Vendido"].includes(row.status) && <ConfirmInline label="Inativar" onConfirm={() => void save("vehicles", { ...row, status: "Inativo" })} />}
                  </div></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="motoristas">
          <SectionCard title="Motoristas" description="CNH e validade. A categoria é conferida ao vincular o motorista a um veículo, abastecimento ou viagem.">
            <Button className="mb-3" onClick={() => open("drivers", emptyDriver())}><Plus className="h-4 w-4" />Novo motorista</Button>
            <DataTable headers={["Nome", "CPF", "CNH", "Categoria", "Validade", "Telefone", "Status", "Ações"]} empty={!data.drivers.length}>
              {data.drivers.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell><TableCell>{row.cpf}</TableCell><TableCell>{row.cnhNumber}</TableCell><TableCell>{row.cnhCategory}</TableCell>
                  <TableCell className={row.cnhExpiry && row.cnhExpiry < today() ? "font-medium text-destructive" : ""}>{day(row.cnhExpiry)}</TableCell>
                  <TableCell>{row.phone || "-"}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => open("drivers", { ...emptyDriver(), ...row })}>Editar</Button></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="manutencao">
          <SectionCard title="Manutenções" description="Preventivas e corretivas, com custo, tempo parado e liberação.">
            <Button className="mb-3" onClick={() => open("maintenance", emptyMaintenance())}><Plus className="h-4 w-4" />Registrar manutenção</Button>
            <DataTable headers={["Veículo", "Tipo", "Data", "Serviço", "OS", "Oficina", "Peças", "Mão de obra", "Parado (h)", "Próxima", "Status", "Ações"]} empty={!data.maintenance.length}>
              {data.maintenance.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{vehicleLabel(row.vehicleId)}</TableCell><TableCell>{row.maintenanceType}</TableCell><TableCell>{day(row.startDate)}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={row.serviceDescription}>{row.serviceDescription}</TableCell>
                  <TableCell>{orders.find((order) => order.id === row.serviceOrderId)?.number || "-"}</TableCell><TableCell>{row.workshop || "-"}</TableCell>
                  <TableCell>{brl(row.partsCost)}</TableCell><TableCell>{brl(row.laborCost)}</TableCell><TableCell>{row.downtimeHours ?? "-"}</TableCell>
                  <TableCell>{[row.nextDate && day(row.nextDate), row.nextKm && `${row.nextKm} km`, row.nextHours && `${row.nextHours} h`].filter(Boolean).join(" / ") || "-"}</TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => open("maintenance", { ...emptyMaintenance(), ...row, stoppedAt: String(row.stoppedAt || "").slice(0, 16), releasedAt: String(row.releasedAt || "").slice(0, 16) })}>Editar</Button></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="abastecimento">
          <SectionCard title="Abastecimentos">
            <Button className="mb-3" onClick={() => open("fuel", emptyFuel())}><Plus className="h-4 w-4" />Novo abastecimento</Button>
            <DataTable headers={["Data", "Veículo", "Motorista", "Posto", "Combustível", "Litros", "R$/L", "Total", "Km", "Consumo médio", "Comprovante", "Ações"]} empty={!data.fuel.length}>
              {data.fuel.map((row) => {
                const consumption = fuelConsumption(vehicleEntries(row.vehicleId))
                return (
                  <TableRow key={row.id}>
                    <TableCell>{day(row.fuelDate)}</TableCell><TableCell>{vehicleLabel(row.vehicleId)}</TableCell><TableCell>{driverName(row.driverId)}</TableCell><TableCell>{row.station || "-"}</TableCell>
                    <TableCell>{row.fuelType}</TableCell><TableCell>{row.liters.toLocaleString("pt-BR")}</TableCell><TableCell>{row.pricePerLiter.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{brl(row.totalAmount)}</TableCell><TableCell>{row.odometer ? row.odometer.toLocaleString("pt-BR") : "-"}</TableCell>
                    <TableCell>{consumption ? `${consumption.toLocaleString("pt-BR")} km/L` : "-"}</TableCell><TableCell>{fileLink(row.receiptPath, row.receiptName || "Abrir")}</TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => open("fuel", { ...emptyFuel(), ...row })}>Editar</Button></TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="documentos">
          <SectionCard title="Documentos e fotos" description="CRLV, apólices, laudos e fotos dos veículos, com vencimento.">
            <Button className="mb-3" onClick={() => open("documents", emptyDocument())}><Plus className="h-4 w-4" />Novo documento</Button>
            <DataTable headers={["Veículo", "Tipo", "Descrição", "Vencimento", "Arquivo", "Ações"]} empty={!data.documents.length}>
              {data.documents.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{vehicleLabel(row.vehicleId)}</TableCell><TableCell>{row.docType}</TableCell><TableCell>{row.description || "-"}</TableCell>
                  <TableCell className={row.expiryDate && row.expiryDate < today() ? "font-medium text-destructive" : ""}>{day(row.expiryDate)}</TableCell>
                  <TableCell>{fileLink(row.filePath, row.fileName || "Abrir")}</TableCell>
                  <TableCell><ConfirmInline label="Excluir" onConfirm={() => void remove("documents", row.id)} /></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="alertas">
          <SectionCard title="Vencimentos e manutenções próximas" description="Licenciamento, seguro, CNH, documentos (próximos 30 dias) e manutenções por data, km ou horas.">
            <DataTable headers={["Tipo", "Veículo / motorista", "Descrição", "Vencimento", "Situação"]} empty={!alerts.length}>
              {alerts.map((alert, index) => (
                <TableRow key={index}>
                  <TableCell>{alert.kind}</TableCell><TableCell>{alert.vehicleOrDriver}</TableCell><TableCell>{alert.description}</TableCell><TableCell>{day(alert.dueDate)}</TableCell>
                  <TableCell><StatusBadge status={alert.overdue ? "Vencido" : "A vencer"} /></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        {roadTransport && (
          <TabsContent value="pneus">
            <SectionCard title="Pneus por posição" description="Posições pelo número de eixos do veículo (E/D = esquerda/direita; I/E = interno/externo).">
              <div className="mb-3 max-w-sm"><Opts label="Veículo" value={tireVehicle} onChange={setTireVehicle} items={roadVehicles.filter((row) => row.axles > 0).map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))} /></div>
              {tireTarget ? (
                <DataTable headers={["Posição", "Série", "Marca", "Medida", "Montado em", "Km na montagem", "Condição", "Ações"]}>
                  {tirePositions(tireTarget.axles).map((position) => {
                    const tire = data.tires.find((row) => row.vehicleId === tireTarget.id && row.position === position)
                    return (
                      <TableRow key={position}>
                        <TableCell>{position}</TableCell><TableCell>{tire?.serialNumber || "-"}</TableCell><TableCell>{tire?.brand || "-"}</TableCell><TableCell>{tire?.size || "-"}</TableCell>
                        <TableCell>{day(tire?.fittedDate)}</TableCell><TableCell>{tire?.fittedKm || "-"}</TableCell><TableCell>{tire ? <StatusBadge status={tire.condition} /> : "-"}</TableCell>
                        <TableCell><div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => open("tires", { id: tire?.id || "", vehicleId: tireTarget.id, position, serialNumber: "", brand: "", size: "", fittedDate: "", fittedKm: "", condition: "Novo", notes: "", ...tire })}>{tire ? "Editar" : "Lançar"}</Button>
                          {tire && <ConfirmInline label="Remover" onConfirm={() => void remove("tires", tire.id)} />}
                        </div></TableCell>
                      </TableRow>
                    )
                  })}
                </DataTable>
              ) : <p className="text-sm text-muted-foreground">Selecione um veículo com eixos informados no cadastro.</p>}
            </SectionCard>
          </TabsContent>
        )}

        {roadTransport && (
          <TabsContent value="viagens">
            <SectionCard title="Viagens" description="Cavalo mecânico x semirreboque, motorista e custos por viagem.">
              <Button className="mb-3" onClick={() => open("trips", emptyTrip())}><Plus className="h-4 w-4" />Nova viagem</Button>
              <DataTable headers={["Saída", "Veículo", "Semirreboque", "Motorista", "Rota", "Km", "Frete", "Custo", "Resultado", "R$/km", "Status", "Ações"]} empty={!data.trips.length}>
                {data.trips.map((row) => {
                  const fuelCost = data.fuel.filter((entry) => entry.vehicleId === row.vehicleId && entry.fuelDate >= row.startDate && (!row.endDate || entry.fuelDate <= row.endDate)).reduce((sum, entry) => sum + entry.totalAmount, 0)
                  const result = tripResult(row as any, fuelCost)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{day(row.startDate)}</TableCell><TableCell>{vehicleLabel(row.vehicleId)}</TableCell><TableCell>{vehicleLabel(row.trailerId)}</TableCell><TableCell>{driverName(row.driverId)}</TableCell>
                      <TableCell>{row.origin || "-"} → {row.destination || "-"}</TableCell><TableCell>{result.distance}</TableCell><TableCell>{brl(row.freightAmount)}</TableCell>
                      <TableCell>{brl(result.cost)}</TableCell><TableCell className={result.result < 0 ? "text-destructive" : ""}>{brl(result.result)}</TableCell><TableCell>{result.costPerKm == null ? "-" : brl(result.costPerKm)}</TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => open("trips", { ...emptyTrip(), ...row })}>Editar</Button></TableCell>
                    </TableRow>
                  )
                })}
              </DataTable>
            </SectionCard>
          </TabsContent>
        )}

        {canConfigure && (
          <TabsContent value="config">
            <SectionCard title="Configuração da frota" description="Pneus por posição, engate e viagens só fazem sentido se a empresa opera transporte rodoviário.">
              <div className="flex items-center gap-2">
                <Checkbox id="road" checked={roadTransport} onCheckedChange={(value) => void toggleRoad(value === true)} />
                <Label htmlFor="road">A empresa opera transporte rodoviário (habilita Pneus e Viagens)</Label>
              </div>
            </SectionCard>
          </TabsContent>
        )}
      </Tabs>

      <FormSheet open={form.entity === "vehicles"} onOpenChange={(value) => !value && close()} title={form.item.id ? "Editar veículo" : "Novo veículo"} description="Obrigatórios variam com o tipo: veículos de estrada exigem placa, RENAVAM, chassi e licenciamento." footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Opts label="Tipo *" value={form.item.vehicleType} onChange={(value) => set({ vehicleType: value })} items={vehicleTypes.map((item) => ({ value: item.value, label: item.label }))} />
          <TextField label="Número da frota *" value={form.item.fleetNumber ?? ""} onChange={(value) => set({ fleetNumber: value })} />
          <TextField label={`Placa${info?.road ? " *" : ""}`} value={form.item.plate ?? ""} onChange={(value) => set({ plate: value.toUpperCase() })} />
          <TextField label={`RENAVAM${info?.road ? " *" : ""}`} value={form.item.renavam ?? ""} onChange={(value) => set({ renavam: value })} />
          <TextField label={`Chassi (VIN)${info?.road ? " *" : ""}`} value={form.item.chassis ?? ""} onChange={(value) => set({ chassis: value.toUpperCase() })} />
          <TextField label="Cor" value={form.item.color ?? ""} onChange={(value) => set({ color: value })} />
          <TextField label="Marca *" value={form.item.brand ?? ""} onChange={(value) => set({ brand: value })} />
          <TextField label="Modelo *" value={form.item.model ?? ""} onChange={(value) => set({ model: value })} />
          <TextField label="Ano de fabricação" type="number" value={form.item.manufactureYear ?? ""} onChange={(value) => set({ manufactureYear: value })} />
          <TextField label="Ano-modelo" type="number" value={form.item.modelYear ?? ""} onChange={(value) => set({ modelYear: value })} />
          <TextField label="Proprietário *" value={form.item.ownerName ?? ""} onChange={(value) => set({ ownerName: value })} />
          <TextField label="CPF/CNPJ do proprietário" value={form.item.ownerDocument ?? ""} onChange={(value) => set({ ownerDocument: value })} />
          <Opts label="Unidade / filial *" value={form.item.unitCompanyId} onChange={(value) => set({ unitCompanyId: value })} items={units.map((unit) => ({ value: unit.id, label: unit.name }))} />
          <Opts label="Status operacional *" value={form.item.status} onChange={(value) => set({ status: value })} items={vehicleStatuses.map((value) => ({ value, label: vehicleStatusLabels[value] }))} />
          <TextField label="Carroceria / implemento" value={form.item.bodyType ?? ""} onChange={(value) => set({ bodyType: value })} />
          <TextField label="Capacidade de carga (kg)" type="number" value={form.item.loadCapacityKg ?? ""} onChange={(value) => set({ loadCapacityKg: value })} />
          <TextField label="Peso / tara (kg)" type="number" value={form.item.tareKg ?? ""} onChange={(value) => set({ tareKg: value })} />
          <TextField label="Eixos" type="number" value={form.item.axles ?? ""} onChange={(value) => set({ axles: value })} />
          {info?.motor === "km" && <TextField label="Quilometragem *" type="number" value={form.item.currentKm ?? ""} onChange={(value) => set({ currentKm: value })} />}
          {info?.motor === "horimetro" && <TextField label="Horímetro *" type="number" value={form.item.currentHours ?? ""} onChange={(value) => set({ currentHours: value })} />}
          <Opts label="Motorista" value={form.item.driverId} onChange={(value) => set({ driverId: value })} items={driverItems} />
          {roadTransport && <Opts label="Engatado a (cavalo x semirreboque)" value={form.item.coupledVehicleId} onChange={(value) => set({ coupledVehicleId: value })} items={roadVehicles.filter((row) => row.id !== form.item.id).map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))} />}
          <TextField label="Data de aquisição" type="date" value={form.item.acquisitionDate ?? ""} onChange={(value) => set({ acquisitionDate: value })} />
          <TextField label="Valor de aquisição" type="number" value={form.item.acquisitionValue ?? ""} onChange={(value) => set({ acquisitionValue: value })} />
          <TextField label={`Vencimento do licenciamento${info?.road ? " *" : ""}`} type="date" value={form.item.licensingDueDate ?? ""} onChange={(value) => set({ licensingDueDate: value })} />
          <TextField label="Seguradora" value={form.item.insurer ?? ""} onChange={(value) => set({ insurer: value })} />
          <TextField label="Nº da apólice" value={form.item.policyNumber ?? ""} onChange={(value) => set({ policyNumber: value })} />
          <TextField label="Vencimento da apólice" type="date" value={form.item.policyExpiry ?? ""} onChange={(value) => set({ policyExpiry: value })} />
        </div>
        <div className="space-y-1">
          <Label>Foto do veículo</Label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void pickFile(event, "veiculos", (file) => set({ photoPath: file.path }))} />
          {form.item.photoPath && <div className="text-sm">{fileLink(form.item.photoPath, "Ver foto atual")}</div>}
        </div>
        <TextAreaField label="Observações" value={form.item.notes ?? ""} onChange={(value) => set({ notes: value })} />
      </FormSheet>

      <FormSheet open={form.entity === "drivers"} onOpenChange={(value) => !value && close()} title={form.item.id ? "Editar motorista" : "Novo motorista"} footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Nome *" value={form.item.name ?? ""} onChange={(value) => set({ name: value })} />
          <TextField label="CPF *" value={form.item.cpf ?? ""} onChange={(value) => set({ cpf: value })} />
          <TextField label="Telefone" value={form.item.phone ?? ""} onChange={(value) => set({ phone: value })} />
          <TextField label="Nº da CNH *" value={form.item.cnhNumber ?? ""} onChange={(value) => set({ cnhNumber: value })} />
          <Opts label="Categoria da CNH *" value={form.item.cnhCategory} onChange={(value) => set({ cnhCategory: value })} items={cnhCategories.map((value) => ({ value, label: value }))} />
          <TextField label="Validade da CNH *" type="date" value={form.item.cnhExpiry ?? ""} onChange={(value) => set({ cnhExpiry: value })} />
          <Opts label="Status" value={form.item.status} onChange={(value) => set({ status: value })} items={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observações" value={form.item.notes ?? ""} onChange={(value) => set({ notes: value })} />
      </FormSheet>

      <FormSheet open={form.entity === "maintenance"} onOpenChange={(value) => !value && close()} title={form.item.id ? "Editar manutenção" : "Registrar manutenção"} footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <SearchableSelectField label="Veículo *" value={form.item.vehicleId} onChange={(value) => set({ vehicleId: value })} options={vehicleItems} />
          <Opts label="Tipo *" value={form.item.maintenanceType} onChange={(value) => set({ maintenanceType: value })} items={["Preventiva", "Corretiva"].map((value) => ({ value, label: value }))} />
          <TextField label="Data *" type="date" value={form.item.startDate ?? ""} onChange={(value) => set({ startDate: value })} />
          <TextField label="Término" type="date" value={form.item.endDate ?? ""} onChange={(value) => set({ endDate: value })} />
          <TextField label="Km no serviço" type="number" value={form.item.odometer ?? ""} onChange={(value) => set({ odometer: value })} />
          <TextField label="Horímetro" type="number" value={form.item.hours ?? ""} onChange={(value) => set({ hours: value })} />
          <Opts label="OS relacionada" value={form.item.serviceOrderId} onChange={(value) => set({ serviceOrderId: value })} items={orders.map((order) => ({ value: order.id, label: order.number }))} placeholder="Nenhuma" />
          <TextField label="Fornecedor / oficina" value={form.item.workshop ?? ""} onChange={(value) => set({ workshop: value })} />
          <TextField label="Custo de peças" type="number" value={form.item.partsCost ?? ""} onChange={(value) => set({ partsCost: value })} />
          <TextField label="Custo de mão de obra" type="number" value={form.item.laborCost ?? ""} onChange={(value) => set({ laborCost: value })} />
          <TextField label="Próxima por data" type="date" value={form.item.nextDate ?? ""} onChange={(value) => set({ nextDate: value })} />
          <TextField label="Próxima por km" type="number" value={form.item.nextKm ?? ""} onChange={(value) => set({ nextKm: value })} />
          <TextField label="Próxima por horas" type="number" value={form.item.nextHours ?? ""} onChange={(value) => set({ nextHours: value })} />
          <Opts label="Situação" value={form.item.status} onChange={(value) => set({ status: value })} items={["Programada", "Em andamento", "Realizada", "Cancelada"].map((value) => ({ value, label: value }))} />
          <TextField label="Veículo parado em" type="datetime-local" value={form.item.stoppedAt ?? ""} onChange={(value) => set({ stoppedAt: value })} />
          <TextField label="Veículo liberado em" type="datetime-local" value={form.item.releasedAt ?? ""} onChange={(value) => set({ releasedAt: value })} />
          <TextField label="Responsável pela liberação" value={form.item.releasedBy ?? ""} onChange={(value) => set({ releasedBy: value })} />
          <div className="text-sm text-muted-foreground self-end">
            Tempo parado: {form.item.stoppedAt && form.item.releasedAt ? `${downtimeHours(new Date(form.item.stoppedAt).toISOString(), new Date(form.item.releasedAt).toISOString()) ?? "-"} h` : "-"}
          </div>
        </div>
        <TextAreaField label="Serviço executado *" value={form.item.serviceDescription ?? ""} onChange={(value) => set({ serviceDescription: value })} />
        <TextAreaField label="Peças substituídas" value={form.item.partsReplaced ?? ""} onChange={(value) => set({ partsReplaced: value })} />
      </FormSheet>

      <FormSheet open={form.entity === "fuel"} onOpenChange={(value) => !value && close()} title={form.item.id ? "Editar abastecimento" : "Novo abastecimento"} footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <SearchableSelectField label="Veículo *" value={form.item.vehicleId} onChange={(value) => set({ vehicleId: value })} options={vehicleItems} />
          <Opts label="Motorista" value={form.item.driverId} onChange={(value) => set({ driverId: value })} items={driverItems} />
          <TextField label="Data *" type="date" value={form.item.fuelDate ?? ""} onChange={(value) => set({ fuelDate: value })} />
          <TextField label="Posto" value={form.item.station ?? ""} onChange={(value) => set({ station: value })} />
          <Opts label="Combustível *" value={form.item.fuelType} onChange={(value) => set({ fuelType: value })} items={fuelTypes.map((value) => ({ value, label: value }))} />
          <TextField label="Litros *" type="number" value={form.item.liters ?? ""} onChange={(value) => set({ liters: value })} />
          <TextField label="Preço por litro *" type="number" value={form.item.pricePerLiter ?? ""} onChange={(value) => set({ pricePerLiter: value })} />
          <TextField label="Km / horímetro" type="number" value={form.item.odometer ?? ""} onChange={(value) => set({ odometer: value })} />
          <div className="text-sm self-end">Total: <strong>{brl(fuelTotal({ liters: Number(form.item.liters) || 0, pricePerLiter: Number(form.item.pricePerLiter) || 0 }))}</strong></div>
        </div>
        <div className="space-y-1">
          <Label>Comprovante (JPG, PNG, WEBP ou PDF)</Label>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void pickFile(event, "abastecimento", (file) => set({ receiptPath: file.path, receiptName: file.name }))} />
          {form.item.receiptPath && <div className="text-sm">{fileLink(form.item.receiptPath, form.item.receiptName || "Ver comprovante")}</div>}
        </div>
        <TextAreaField label="Observações" value={form.item.notes ?? ""} onChange={(value) => set({ notes: value })} />
      </FormSheet>

      <FormSheet open={form.entity === "documents"} onOpenChange={(value) => !value && close()} title="Documento do veículo" footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <SearchableSelectField label="Veículo *" value={form.item.vehicleId} onChange={(value) => set({ vehicleId: value })} options={data.vehicles.map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))} />
          <Opts label="Tipo *" value={form.item.docType} onChange={(value) => set({ docType: value })} items={docTypes.map((value) => ({ value, label: value }))} />
          <TextField label="Descrição" value={form.item.description ?? ""} onChange={(value) => set({ description: value })} />
          <TextField label="Vencimento" type="date" value={form.item.expiryDate ?? ""} onChange={(value) => set({ expiryDate: value })} />
        </div>
        <div className="space-y-1">
          <Label>Arquivo (JPG, PNG, WEBP ou PDF)</Label>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void pickFile(event, "documentos", (file) => set({ filePath: file.path, fileName: file.name }))} />
          {form.item.filePath && <div className="text-sm">{fileLink(form.item.filePath, form.item.fileName || "Ver arquivo")}</div>}
        </div>
      </FormSheet>

      <FormSheet open={form.entity === "tires"} onOpenChange={(value) => !value && close()} title={`Pneu ${form.item.position || ""}`} description={vehicleLabel(form.item.vehicleId)} footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Nº de série / fogo" value={form.item.serialNumber ?? ""} onChange={(value) => set({ serialNumber: value })} />
          <TextField label="Marca" value={form.item.brand ?? ""} onChange={(value) => set({ brand: value })} />
          <TextField label="Medida" value={form.item.size ?? ""} onChange={(value) => set({ size: value })} />
          <Opts label="Condição" value={form.item.condition} onChange={(value) => set({ condition: value })} items={tireConditions.map((value) => ({ value, label: value }))} />
          <TextField label="Montado em" type="date" value={form.item.fittedDate ?? ""} onChange={(value) => set({ fittedDate: value })} />
          <TextField label="Km na montagem" type="number" value={form.item.fittedKm ?? ""} onChange={(value) => set({ fittedKm: value })} />
        </div>
        <TextAreaField label="Observações" value={form.item.notes ?? ""} onChange={(value) => set({ notes: value })} />
      </FormSheet>

      <FormSheet open={form.entity === "trips"} onOpenChange={(value) => !value && close()} title={form.item.id ? "Editar viagem" : "Nova viagem"} footer={<SaveButton onClick={() => void save()} disabled={saving}>Salvar</SaveButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Opts label="Cavalo mecânico / caminhão *" value={form.item.vehicleId} onChange={(value) => set({ vehicleId: value })} items={tractors.map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))} />
          <Opts label="Semirreboque" value={form.item.trailerId} onChange={(value) => set({ trailerId: value })} items={trailers.map((row) => ({ value: row.id, label: vehicleLabel(row.id) }))} placeholder="Nenhum" />
          <Opts label="Motorista" value={form.item.driverId} onChange={(value) => set({ driverId: value })} items={driverItems} />
          <Opts label="Situação" value={form.item.status} onChange={(value) => set({ status: value })} items={["Planejada", "Em andamento", "Concluída", "Cancelada"].map((value) => ({ value, label: value }))} />
          <TextField label="Origem" value={form.item.origin ?? ""} onChange={(value) => set({ origin: value })} />
          <TextField label="Destino" value={form.item.destination ?? ""} onChange={(value) => set({ destination: value })} />
          <TextField label="Saída *" type="date" value={form.item.startDate ?? ""} onChange={(value) => set({ startDate: value })} />
          <TextField label="Chegada" type="date" value={form.item.endDate ?? ""} onChange={(value) => set({ endDate: value })} />
          <TextField label="Km inicial" type="number" value={form.item.startKm ?? ""} onChange={(value) => set({ startKm: value })} />
          <TextField label="Km final" type="number" value={form.item.endKm ?? ""} onChange={(value) => set({ endKm: value })} />
          <TextField label="Frete" type="number" value={form.item.freightAmount ?? ""} onChange={(value) => set({ freightAmount: value })} />
          <TextField label="Pedágios" type="number" value={form.item.tollsAmount ?? ""} onChange={(value) => set({ tollsAmount: value })} />
          <TextField label="Diárias / adiantamentos" type="number" value={form.item.allowanceAmount ?? ""} onChange={(value) => set({ allowanceAmount: value })} />
          <TextField label="Outros custos" type="number" value={form.item.otherCosts ?? ""} onChange={(value) => set({ otherCosts: value })} />
        </div>
        <p className="text-xs text-muted-foreground">O combustível da viagem é somado dos abastecimentos do veículo no período.</p>
        <TextAreaField label="Observações" value={form.item.notes ?? ""} onChange={(value) => set({ notes: value })} />
      </FormSheet>
    </PageShell>
  )
}
