"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Camera, Factory, Plus, Printer, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, PageShell, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField } from "@/components/operations/shared"
import { SignaturePad } from "@/components/os/signature-pad"
import { useToast } from "@/hooks/use-toast"
import { nextStatuses, osKinds, osPriorities, osTotals } from "@/lib/os-workflow"

type Options = {
  clients: Array<{ id: string; name: string; document: string }>
  services: Array<{ id: string; name: string; code: string; unit: string; price: number; warrantyDays: number }>
  providers: Array<{ id: string; name: string }>
  materials: Array<{ id: string; name: string; code: string; unit: string; price: number; cost: number; stock: number; reserved: number; controlsStock: boolean }>
  vehicles: Array<{ id: string; name: string }>
}
type Asset = { id: string; clientId: string; assetType: string; identification: string; plate: string; chassis: string }
type ChecklistRow = { item: string; ok: boolean | null; notes?: string }
type ServiceRow = { key: string; serviceTypeId: string; description: string; quantity: string; unit: string; unitPrice: string; executed: boolean }
type MaterialRow = { key: string; materialId: string; itemName: string; quantity: string; unit: string; unitPrice: string; reserved?: number; consumed?: boolean }
type Detail = any

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-"
const num = (value: string | number) => Number(String(value ?? "").replace(",", ".")) || 0
const key = () => Math.random().toString(36).slice(2)
const productionKinds = new Set(["Fabricação", "Montagem"])
const locked = new Set(["Concluída", "Entregue", "Cancelada", "Finalizada"])
const reasonRequired = new Set(["Cancelada", "Suspensa"])
const defaultChecklist = ["Pneus e rodas", "Freios", "Sistema elétrico e iluminação", "Suspensão e eixos", "Estrutura / chassi", "Assoalho", "Carroceria / lona", "Engate / pino rei", "Documentação"]
const assetTypes = ["Carreta", "Semirreboque", "Reboque", "Caminhão", "Cavalo mecânico", "Veículo", "Equipamento"]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyHeader = { orderKind: "Manutenção corretiva", clientId: "", customerAssetId: "", vehicleId: "", serviceTypeId: "", description: "", priority: "Media", technicianId: "", teamProviderIds: [] as string[], plannedStart: "", dueDate: "", servicesSummary: "", discountAmount: "0", discountAuthorizedBy: "", warrantyDays: "0", technicalNotes: "", paymentMethod: "", paymentDueDate: "", productionProductId: "", productionQuantity: "1", productionSerial: "" }

export function OsDetailPage({ id }: { id: string }) {
  const isNew = id === "nova"
  const router = useRouter()
  const { toast } = useToast()
  const [options, setOptions] = useState<Options>({ clients: [], services: [], providers: [], materials: [], vehicles: [] })
  const [assets, setAssets] = useState<Asset[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [header, setHeader] = useState(emptyHeader)
  const [checklist, setChecklist] = useState<ChecklistRow[]>(defaultChecklist.map((item) => ({ item, ok: null })))
  const [services, setServices] = useState<ServiceRow[]>([])
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [statusDialog, setStatusDialog] = useState<{ to: string; reason: string } | null>(null)
  const [assetDialog, setAssetDialog] = useState(false)
  const [assetForm, setAssetForm] = useState({ assetType: "Carreta", identification: "", plate: "", chassis: "", brand: "", model: "", manufactureYear: "", axles: "" })
  const [time, setTime] = useState({ providerId: "", workDate: new Date().toISOString().slice(0, 10), hours: "", hourlyCost: "", notes: "" })
  const [acceptance, setAcceptance] = useState({ name: "", document: "", signature: "", notes: "" })

  const load = useCallback(async () => {
    if (isNew) return
    try {
      const payload = await api<{ order: Detail }>(`/api/os/${id}`)
      const order = payload.order
      setDetail(order)
      setHeader({ ...emptyHeader, ...Object.fromEntries(Object.keys(emptyHeader).map((field) => [field, Array.isArray(order[field]) ? order[field] : String(order[field] ?? "")])) } as typeof emptyHeader)
      setChecklist(order.entryChecklist.length ? order.entryChecklist : defaultChecklist.map((item) => ({ item, ok: null })))
      setServices(order.services.map((item: any) => ({ key: key(), ...item, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })))
      setMaterials(order.materials.map((item: any) => ({ key: key(), ...item, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })))
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar OS.")
    }
  }, [id, isNew])

  useEffect(() => {
    void load()
    api<Options>("/api/os/options").then(setOptions).catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar listas."))
  }, [load])

  useEffect(() => {
    if (!header.clientId) return setAssets([])
    api<{ assets: Asset[] }>(`/api/os/assets?clientId=${header.clientId}`).then((payload) => setAssets(payload.assets)).catch(() => setAssets([]))
  }, [header.clientId])

  const readOnly = Boolean(detail && locked.has(detail.status))
  const set = (field: keyof typeof emptyHeader) => (value: string) => setHeader((current) => ({ ...current, [field]: value }))
  const materialInfo = (materialId: string) => options.materials.find((item) => item.id === materialId)
  const live = useMemo(() => osTotals(
    services.map((item) => ({ quantity: num(item.quantity), unitPrice: num(item.unitPrice) })),
    materials.map((item) => ({ quantity: num(item.quantity), unitPrice: num(item.unitPrice), unitCost: materialInfo(item.materialId)?.cost || 0 })),
    (detail?.timeEntries || []).map((item: any) => ({ hours: item.hours, hourlyCost: item.hourlyCost })),
    num(header.discountAmount),
  ), [services, materials, detail, header.discountAmount, options.materials])

  async function save() {
    setSaving(true)
    try {
      const payload = await api<{ id: string; orderNumber: string; warnings: string[] }>("/api/os", {
        method: "POST",
        body: JSON.stringify({ order: {
          ...header, id: isNew ? undefined : id,
          discountAmount: num(header.discountAmount), warrantyDays: num(header.warrantyDays), productionQuantity: num(header.productionQuantity),
          entryChecklist: checklist,
          services: services.map((item) => ({ serviceTypeId: item.serviceTypeId, description: item.description, quantity: num(item.quantity), unit: item.unit, unitPrice: num(item.unitPrice), executed: item.executed })),
          materials: materials.filter((item) => item.materialId).map((item) => ({ materialId: item.materialId, itemName: item.itemName, quantity: num(item.quantity), unit: item.unit, unitPrice: num(item.unitPrice) })),
        } }),
      })
      toast({ title: isNew ? `OS ${payload.orderNumber} aberta` : "OS salva", description: payload.warnings.length ? `Estoque: ${payload.warnings.join(" ")}` : "Peças reservadas no estoque." })
      if (isNew) router.replace(`/ordens-servico/${payload.id}`)
      else void load()
    } catch (reason) {
      toast({ title: "OS não salva", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(to: string, reason = "") {
    try {
      const payload = await api<{ warnings: string[]; produced?: boolean }>(`/api/os/${id}/status`, { method: "POST", body: JSON.stringify({ status: to, reason }) })
      toast({ title: `OS ${to.toLowerCase()}`, description: [payload.produced ? "Carreta fabricada e lançada no estoque." : "", payload.warnings.length ? `Estoque: ${payload.warnings.join(" ")}` : ""].filter(Boolean).join(" ") || undefined })
      setStatusDialog(null)
      void load()
    } catch (reason) {
      toast({ title: "Situação não alterada", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  function requestStatus(to: string) {
    const reopen = detail?.status === "Concluída" && to !== "Entregue"
    if (reasonRequired.has(to) || reopen) return setStatusDialog({ to, reason: "" })
    if (to === "Concluída" && !window.confirm(`Concluir a OS?${header.productionProductId ? " A carreta será fabricada: os componentes saem do estoque e o produto entra." : ""} As peças serão baixadas do estoque e a conta a receber será gerada.`)) return
    void changeStatus(to)
  }

  async function saveAsset() {
    try {
      const payload = await api<{ asset: Asset }>("/api/os/assets", { method: "POST", body: JSON.stringify({ asset: { ...assetForm, clientId: header.clientId } }) })
      setAssets((current) => [...current, payload.asset])
      setHeader((current) => ({ ...current, customerAssetId: payload.asset.id }))
      setAssetDialog(false)
    } catch (reason) {
      toast({ title: "Carreta não cadastrada", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  async function addTime() {
    try {
      await api(`/api/os/${id}/time`, { method: "POST", body: JSON.stringify({ ...time, hours: num(time.hours), hourlyCost: num(time.hourlyCost) }) })
      setTime({ ...time, hours: "", notes: "" })
      void load()
    } catch (reason) {
      toast({ title: "Horas não apontadas", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    }
  }

  async function removeTime(entryId: string) {
    if (!window.confirm("Remover este apontamento?")) return
    try {
      await api(`/api/os/${id}/time?entryId=${entryId}`, { method: "DELETE" })
      void load()
    } catch (reason) {
      toast({ title: "Não removido", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function uploadPhoto(category: string, file?: File | null) {
    if (!file) return
    const body = new FormData()
    body.append("file", file)
    body.append("serviceOrderId", id)
    body.append("category", category)
    body.append("keepPrevious", "true")
    try {
      await api("/api/operational-files/upload", { method: "POST", body })
      void load()
    } catch (reason) {
      toast({ title: "Foto não enviada", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function saveAcceptance() {
    try {
      await api(`/api/os/${id}/acceptance`, { method: "POST", body: JSON.stringify(acceptance) })
      toast({ title: "Aceite registrado", description: acceptance.name })
      void load()
    } catch (reason) {
      toast({ title: "Aceite não registrado", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  // Com fabricação registrada, o custo salvo já inclui componentes + mão de obra da montagem.
  const cost = detail?.productionRecordId ? Math.max(detail.costAmount || 0, live.cost) : live.cost
  const marginPercent = live.total > 0 ? Math.round(((live.total - cost) / live.total) * 1000) / 10 : null
  const statusButtons = detail ? nextStatuses(detail.status, detail.suspendedFrom) : []
  const productOptions = options.materials.map((item) => ({ value: item.id, label: `${item.code ? `${item.code} - ` : ""}${item.name}` }))

  return (
    <PageShell
      title={isNew ? "Nova ordem de serviço" : `OS ${detail?.orderNumber || ""}`}
      description={detail ? `Aberta em ${day(detail.openedAt)} por ${detail.openedBy || "-"}${detail.finishedAt ? ` · concluída em ${day(detail.finishedAt)}` : ""}${detail.deliveredAt ? ` · entregue em ${day(detail.deliveredAt)}` : ""}${detail.warrantyUntil ? ` · garantia até ${day(detail.warrantyUntil)}` : ""}` : "Preencha os dados da solicitação. Número e data de abertura são gerados ao salvar."}
      actions={<>
        <Button variant="outline" asChild><Link href="/ordens-servico"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button>
        {detail ? <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</Button> : null}
        {!readOnly ? <Button onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? "Salvando..." : isNew ? "Abrir OS" : "Salvar"}</Button> : null}
      </>}
    >
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {detail ? <SectionCard title="Situação">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={detail.status} />
          {detail.statusReason ? <span className="text-sm text-muted-foreground">Motivo: {detail.statusReason}</span> : null}
          <div className="flex flex-wrap gap-2">
            {statusButtons.map((to) => <Button key={to} size="sm" variant={to === "Cancelada" ? "destructive" : to === "Suspensa" ? "outline" : "secondary"} onClick={() => requestStatus(to)}>{to}</Button>)}
          </div>
        </div>
        {readOnly && detail.status === "Concluída" ? <p className="mt-2 text-xs text-muted-foreground">OS concluída: para alterar serviços ou peças, reabra para execução ou conferência (exige motivo).</p> : null}
      </SectionCard> : null}

      <fieldset disabled={readOnly} className="space-y-6">
        <SectionCard title="Solicitação">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SelectField label="Tipo de OS" value={header.orderKind} onChange={set("orderKind")} options={osKinds.map((item) => ({ value: item, label: item }))} />
            <SearchableSelectField label="Cliente" value={header.clientId || "nenhum"} onChange={(value) => setHeader({ ...header, clientId: value === "nenhum" ? "" : value, customerAssetId: "" })} options={[{ value: "nenhum", label: "Selecione" }, ...options.clients.map((item) => ({ value: item.id, label: item.document ? `${item.name} - ${item.document}` : item.name }))]} />
            <div className="space-y-2">
              <SelectField label="Carreta / veículo / equipamento do cliente" value={header.customerAssetId || "nenhum"} onChange={(value) => setHeader({ ...header, customerAssetId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: header.clientId ? "Nenhum" : "Escolha o cliente" }, ...assets.map((item) => ({ value: item.id, label: [item.assetType, item.identification, item.plate, item.chassis].filter(Boolean).join(" · ") }))]} />
              {header.clientId && !readOnly ? <Button type="button" size="sm" variant="outline" onClick={() => setAssetDialog(true)}><Plus className="h-4 w-4" />Cadastrar carreta do cliente</Button> : null}
            </div>
            <SelectField label="Veículo da frota própria (opcional)" value={header.vehicleId || "nenhum"} onChange={(value) => setHeader({ ...header, vehicleId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Nenhum" }, ...options.vehicles.map((item) => ({ value: item.id, label: item.name }))]} />
            <SearchableSelectField label="Serviço solicitado" value={header.serviceTypeId || "nenhum"} onChange={(value) => {
              const picked = options.services.find((item) => item.id === value)
              setHeader({ ...header, serviceTypeId: value === "nenhum" ? "" : value, warrantyDays: header.warrantyDays !== "0" ? header.warrantyDays : String(picked?.warrantyDays || 0) })
              if (picked && !services.length) setServices([{ key: key(), serviceTypeId: picked.id, description: picked.name, quantity: "1", unit: picked.unit, unitPrice: String(picked.price), executed: false }])
            }} options={[{ value: "nenhum", label: "Selecione" }, ...options.services.map((item) => ({ value: item.id, label: item.code ? `${item.code} - ${item.name}` : item.name }))]} />
            <SelectField label="Prioridade" value={header.priority} onChange={set("priority")} options={osPriorities.map((item) => ({ value: item, label: item === "Media" ? "Média" : item }))} />
            <SearchableSelectField label="Responsável técnico" value={header.technicianId || "nenhum"} onChange={(value) => setHeader({ ...header, technicianId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...options.providers.map((item) => ({ value: item.id, label: item.name }))]} />
            <TextField label="Início previsto" type="date" value={header.plannedStart} onChange={set("plannedStart")} />
            <TextField label="Prazo de conclusão" type="date" value={header.dueDate} onChange={set("dueDate")} />
            <TextField label="Garantia (dias)" type="number" value={header.warrantyDays} onChange={set("warrantyDays")} />
          </div>
          <div className="mt-4 space-y-2">
            <Label>Equipe executora</Label>
            <div className="flex flex-wrap gap-3 rounded-md border p-3">
              {options.providers.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm"><Checkbox checked={header.teamProviderIds.includes(item.id)} onCheckedChange={(checked) => setHeader({ ...header, teamProviderIds: checked === true ? [...header.teamProviderIds, item.id] : header.teamProviderIds.filter((value) => value !== item.id) })} />{item.name}</label>)}
              {!options.providers.length ? <span className="text-sm text-muted-foreground">Nenhum técnico cadastrado.</span> : null}
            </div>
          </div>
          <div className="mt-4"><TextAreaField label="Descrição do problema ou solicitação" value={header.description} onChange={set("description")} rows={3} /></div>
          {productionKinds.has(header.orderKind) ? <div className="mt-4 grid gap-4 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
            <div className="md:col-span-3 flex items-center gap-2 text-sm font-medium"><Factory className="h-4 w-4" />Fabricação: ao concluir, baixa os componentes da composição ativa e dá entrada do produto no estoque.</div>
            <SearchableSelectField label="Carreta / produto fabricado" value={header.productionProductId || "nenhum"} onChange={(value) => setHeader({ ...header, productionProductId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...productOptions]} />
            <TextField label="Quantidade" type="number" value={header.productionQuantity} onChange={set("productionQuantity")} />
            <TextField label="Nº de série / chassi" value={header.productionSerial} onChange={set("productionSerial")} />
            {detail?.productionRecordId ? <p className="md:col-span-3 text-sm text-emerald-700">Fabricação registrada no estoque.</p> : null}
          </div> : null}
        </SectionCard>

        <SectionCard title="Checklist de entrada">
          <div className="space-y-2">
            {checklist.map((row, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)_auto] md:items-center">
                <Input value={row.item} onChange={(event) => setChecklist(checklist.map((item, position) => position === index ? { ...item, item: event.target.value } : item))} />
                <div className="flex gap-1">{[{ value: true, label: "OK" }, { value: false, label: "Avaria" }, { value: null, label: "N/A" }].map((choice) => <Button key={choice.label} type="button" size="sm" variant={row.ok === choice.value ? (choice.value === false ? "destructive" : "default") : "outline"} onClick={() => setChecklist(checklist.map((item, position) => position === index ? { ...item, ok: choice.value } : item))}>{choice.label}</Button>)}</div>
                <Input placeholder="Observação" value={row.notes || ""} onChange={(event) => setChecklist(checklist.map((item, position) => position === index ? { ...item, notes: event.target.value } : item))} />
                <Button type="button" size="icon" variant="ghost" onClick={() => setChecklist(checklist.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setChecklist([...checklist, { item: "", ok: null }])}><Plus className="h-4 w-4" />Item</Button>
          </div>
        </SectionCard>

        <SectionCard title="Serviços executados" description="Obrigatório para concluir: marque os serviços executados ou descreva no resumo.">
          <div className="space-y-2">
            {services.map((row) => {
              const update = (patch: Partial<ServiceRow>) => setServices(services.map((item) => item.key === row.key ? { ...item, ...patch } : item))
              return <div key={row.key} className="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_90px_120px_110px_auto_auto] md:items-end">
                <SearchableSelectField label="Serviço do catálogo" value={row.serviceTypeId || "nenhum"} onChange={(value) => { const picked = options.services.find((item) => item.id === value); update({ serviceTypeId: value === "nenhum" ? "" : value, description: picked?.name || row.description, unit: picked?.unit || row.unit, unitPrice: picked ? String(picked.price) : row.unitPrice }) }} options={[{ value: "nenhum", label: "Avulso" }, ...options.services.map((item) => ({ value: item.id, label: item.name }))]} />
                <TextField label="Descrição" value={row.description} onChange={(value) => update({ description: value })} />
                <TextField label="Qtd." type="number" value={row.quantity} onChange={(value) => update({ quantity: value })} />
                <TextField label="Valor unit." type="number" value={row.unitPrice} onChange={(value) => update({ unitPrice: value })} />
                <div className="space-y-2"><Label>Total</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-2 text-sm">{brl(num(row.quantity) * num(row.unitPrice))}</div></div>
                <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={row.executed} onCheckedChange={(checked) => update({ executed: checked === true })} />Executado</label>
                <Button type="button" size="icon" variant="ghost" onClick={() => setServices(services.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            })}
            <Button type="button" size="sm" variant="outline" onClick={() => setServices([...services, { key: key(), serviceTypeId: "", description: "", quantity: "1", unit: "Servico", unitPrice: "0", executed: false }])}><Plus className="h-4 w-4" />Serviço</Button>
            <TextAreaField label="Resumo dos serviços executados" value={header.servicesSummary} onChange={set("servicesSummary")} />
          </div>
        </SectionCard>

        <SectionCard title="Peças e materiais" description="As peças são reservadas no estoque ao salvar e baixadas automaticamente quando a OS é concluída.">
          <div className="space-y-2">
            {materials.map((row) => {
              const info = materialInfo(row.materialId)
              const update = (patch: Partial<MaterialRow>) => setMaterials(materials.map((item) => item.key === row.key ? { ...item, ...patch } : item))
              const available = info ? info.stock - info.reserved + (row.reserved || 0) : 0
              return <div key={row.key} className="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,2fr)_90px_120px_110px_minmax(0,1fr)_auto] md:items-end">
                <SearchableSelectField label="Peça / material" value={row.materialId || "nenhum"} onChange={(value) => { const picked = materialInfo(value); update({ materialId: value === "nenhum" ? "" : value, itemName: picked?.name || "", unit: picked?.unit || "UN", unitPrice: String(picked?.price || 0) }) }} options={[{ value: "nenhum", label: "Selecione" }, ...productOptions]} />
                <TextField label={`Qtd. (${row.unit})`} type="number" value={row.quantity} onChange={(value) => update({ quantity: value })} />
                <TextField label="Valor unit." type="number" value={row.unitPrice} onChange={(value) => update({ unitPrice: value })} />
                <div className="space-y-2"><Label>Total</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-2 text-sm">{brl(num(row.quantity) * num(row.unitPrice))}</div></div>
                <p className={`pb-2 text-xs ${info?.controlsStock && num(row.quantity) > available ? "text-destructive" : "text-muted-foreground"}`}>{info ? info.controlsStock ? `Disponível ${available.toLocaleString("pt-BR")} ${info.unit}${row.consumed ? " · baixado" : row.reserved ? ` · reservado ${row.reserved}` : ""}` : "Sem controle de estoque" : ""}</p>
                <Button type="button" size="icon" variant="ghost" onClick={() => setMaterials(materials.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            })}
            <Button type="button" size="sm" variant="outline" onClick={() => setMaterials([...materials, { key: key(), materialId: "", itemName: "", quantity: "1", unit: "UN", unitPrice: "0" }])}><Plus className="h-4 w-4" />Peça / material</Button>
          </div>
        </SectionCard>

        <SectionCard title="Valores e margem">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <ValueBox label="Mão de obra" value={brl(live.labor)} />
            <ValueBox label="Materiais" value={brl(live.materials)} />
            <TextField label="Desconto (R$)" type="number" value={header.discountAmount} onChange={set("discountAmount")} />
            <TextField label="Desconto autorizado por" value={header.discountAuthorizedBy} onChange={set("discountAuthorizedBy")} />
            <ValueBox label="Total da OS" value={brl(live.total)} strong />
            <ValueBox label="Custo / margem" value={`${brl(cost)} · ${marginPercent === null ? "-" : `${marginPercent.toLocaleString("pt-BR")}%`}`} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Custo = peças pelo custo médio + horas apontadas x custo/hora{detail?.productionRecordId ? " + custo real da fabricação" : ""}. {live.hours ? `${live.hours} h apontadas.` : ""}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <TextField label="Forma de pagamento" value={header.paymentMethod} onChange={set("paymentMethod")} placeholder="Pix, boleto..." />
            <TextField label="Vencimento da cobrança" type="date" value={header.paymentDueDate} onChange={set("paymentDueDate")} />
            {detail?.receivable ? <ValueBox label="Conta a receber" value={`${brl(detail.receivable.amount)} · ${detail.receivable.status} · vence ${day(detail.receivable.dueDate)}`} /> : <ValueBox label="Conta a receber" value="Gerada ao concluir a OS" />}
          </div>
        </SectionCard>

        <SectionCard title="Observações técnicas"><TextAreaField label="Observações" value={header.technicalNotes} onChange={set("technicalNotes")} rows={3} /></SectionCard>
      </fieldset>

      {detail ? <>
        <SectionCard title="Apontamento de horas">
          {!["Entregue", "Cancelada"].includes(detail.status) ? <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_150px_100px_130px_minmax(0,1fr)_auto] md:items-end">
            <SelectField label="Técnico" value={time.providerId || "nenhum"} onChange={(value) => setTime({ ...time, providerId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...options.providers.map((item) => ({ value: item.id, label: item.name }))]} />
            <TextField label="Data" type="date" value={time.workDate} onChange={(value) => setTime({ ...time, workDate: value })} />
            <TextField label="Horas" type="number" value={time.hours} onChange={(value) => setTime({ ...time, hours: value })} />
            <TextField label="Custo/hora (R$)" type="number" value={time.hourlyCost} onChange={(value) => setTime({ ...time, hourlyCost: value })} />
            <TextField label="Atividade" value={time.notes} onChange={(value) => setTime({ ...time, notes: value })} />
            <Button onClick={addTime}><Plus className="h-4 w-4" />Apontar</Button>
          </div> : null}
          <DataTable headers={["Data", "Técnico", "Horas", "Custo/hora", "Custo", "Atividade", ""]} empty={!detail.timeEntries.length}>
            {detail.timeEntries.map((item: any) => <TableRow key={item.id}><TableCell>{day(item.workDate)}</TableCell><TableCell>{options.providers.find((provider) => provider.id === item.providerId)?.name || "-"}</TableCell><TableCell>{item.hours}</TableCell><TableCell>{brl(item.hourlyCost)}</TableCell><TableCell>{brl(item.hours * item.hourlyCost)}</TableCell><TableCell>{item.notes || "-"}</TableCell><TableCell>{!["Entregue", "Cancelada"].includes(detail.status) ? <Button size="icon" variant="ghost" onClick={() => void removeTime(item.id)}><Trash2 className="h-4 w-4" /></Button> : null}</TableCell></TableRow>)}
          </DataTable>
        </SectionCard>

        <SectionCard title="Fotos antes e depois">
          <div className="grid gap-4 md:grid-cols-2">
            {[{ category: "Foto Inicial", label: "Antes" }, { category: "Foto Final", label: "Depois" }].map((group) => (
              <div key={group.category} className="space-y-2">
                <div className="flex items-center justify-between"><Label>{group.label}</Label>{detail.status !== "Cancelada" ? <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm"><Camera className="h-4 w-4" />Adicionar<Input className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void uploadPhoto(group.category, event.target.files?.[0])} /></label> : null}</div>
                <div className="flex flex-wrap gap-2">
                  {detail.photos.filter((photo: any) => photo.category === group.category).map((photo: any) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.name} className="h-24 w-24 rounded-md border object-cover" /></a>)}
                  {!detail.photos.some((photo: any) => photo.category === group.category) ? <span className="text-sm text-muted-foreground">Sem fotos.</span> : null}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Aceite do cliente">
          {detail.acceptance ? <div className="space-y-2 text-sm">
            <p>Aceito por <b>{detail.acceptance.name}</b>{detail.acceptance.document ? ` (${detail.acceptance.document})` : ""} em {new Date(detail.acceptance.at).toLocaleString("pt-BR")}.</p>
            {detail.acceptance.signature ? <img src={detail.acceptance.signature} alt="Assinatura" className="h-24 rounded-md border bg-white" /> : null}
            {detail.acceptance.notes ? <p>Observação do cliente: {detail.acceptance.notes}</p> : null}
          </div> : detail.status !== "Cancelada" ? <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Nome de quem recebe" value={acceptance.name} onChange={(value) => setAcceptance({ ...acceptance, name: value })} />
            <TextField label="CPF / documento" value={acceptance.document} onChange={(value) => setAcceptance({ ...acceptance, document: value })} />
            <div className="md:col-span-2"><Label>Assinatura</Label><SignaturePad onChange={(signature) => setAcceptance({ ...acceptance, signature })} /></div>
            <div className="md:col-span-2"><TextAreaField label="Observação do cliente" value={acceptance.notes} onChange={(value) => setAcceptance({ ...acceptance, notes: value })} /></div>
            <Button className="w-fit" onClick={saveAcceptance}>Registrar aceite</Button>
          </div> : <p className="text-sm text-muted-foreground">OS cancelada.</p>}
        </SectionCard>

        <SectionCard title="Histórico de situações">
          <DataTable headers={["Data", "De", "Para", "Motivo", "Por"]} empty={!detail.history.length}>
            {detail.history.map((item: any, index: number) => <TableRow key={index}><TableCell>{new Date(item.changedAt).toLocaleString("pt-BR")}</TableCell><TableCell>{item.from || "-"}</TableCell><TableCell>{item.to}</TableCell><TableCell>{item.reason || "-"}</TableCell><TableCell>{item.changedBy || "-"}</TableCell></TableRow>)}
          </DataTable>
        </SectionCard>
      </> : null}

      <Dialog open={Boolean(statusDialog)} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mudar para {statusDialog?.to}</DialogTitle><DialogDescription>Informe o motivo. Ele fica registrado no histórico da OS.</DialogDescription></DialogHeader>
          <Textarea value={statusDialog?.reason || ""} onChange={(event) => setStatusDialog((current) => current ? { ...current, reason: event.target.value } : current)} rows={3} />
          <DialogFooter><Button variant="outline" onClick={() => setStatusDialog(null)}>Voltar</Button><Button disabled={!statusDialog?.reason.trim()} onClick={() => statusDialog && void changeStatus(statusDialog.to, statusDialog.reason)}>Confirmar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assetDialog} onOpenChange={setAssetDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Carreta / veículo do cliente</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label="Tipo" value={assetForm.assetType} onChange={(value) => setAssetForm({ ...assetForm, assetType: value })} options={assetTypes.map((item) => ({ value: item, label: item }))} />
            <TextField label="Identificação" value={assetForm.identification} onChange={(value) => setAssetForm({ ...assetForm, identification: value })} placeholder="Ex.: Graneleira 3 eixos" />
            <TextField label="Placa" value={assetForm.plate} onChange={(value) => setAssetForm({ ...assetForm, plate: value })} />
            <TextField label="Chassi (VIN)" value={assetForm.chassis} onChange={(value) => setAssetForm({ ...assetForm, chassis: value })} />
            <TextField label="Marca" value={assetForm.brand} onChange={(value) => setAssetForm({ ...assetForm, brand: value })} />
            <TextField label="Modelo" value={assetForm.model} onChange={(value) => setAssetForm({ ...assetForm, model: value })} />
            <TextField label="Ano" type="number" value={assetForm.manufactureYear} onChange={(value) => setAssetForm({ ...assetForm, manufactureYear: value })} />
            <TextField label="Eixos" type="number" value={assetForm.axles} onChange={(value) => setAssetForm({ ...assetForm, axles: value })} />
          </div>
          <DialogFooter><Button onClick={saveAsset}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

function ValueBox({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="space-y-2"><Label>{label}</Label><div className={`flex min-h-10 items-center rounded-md border bg-muted/40 px-3 text-sm ${strong ? "font-semibold" : ""}`}>{value}</div></div>
}
