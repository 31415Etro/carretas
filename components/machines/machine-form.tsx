"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormSheet, SelectField, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { cn } from "@/lib/utils"
import { depreciation, illustrationLibrary, suggestIllustration } from "@/lib/machines"
import { IllustrationThumb } from "@/components/machines/machine-art"
import { brl, fileUrl, mApi, uploadMachineFile, type Caps, type Overview, type Row } from "@/components/machines/machine-data"

const none = "nenhum"
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Erro inesperado.")
const blank = (): Row => ({
  id: "", codeKind: "MAQ", name: "", categoryId: "", equipmentType: "", manufacturer: "", brand: "", model: "", serialNumber: "", manufactureYear: "", description: "", illustrationKey: "generica", photoPath: "",
  unitCompanyId: "", sectorId: "", locationDetail: "", responsibleName: "", usesHourMeter: false,
  acquisitionDate: "", acquisitionValue: "", supplierId: "", supplierName: "", invoiceNumber: "", freightCost: "", installationCost: "", otherCosts: "", residualValue: "", usefulLifeMonths: "", depreciationMethod: "Linear",
  depreciationStartDate: "", depreciationAdjustments: "", marketValue: "", marketValueDate: "", replacementValue: "",
})

export function MachineFormSheet({ open, machine, data, onClose, onSaved }: { open: boolean; machine: Row | null; data: Overview; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast } = useCrudFeedback()
  const caps: Caps = data.caps
  const [form, setForm] = useState<Row>(blank())
  const [manualArt, setManualArt] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = (key: string) => (value: any) => setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    setForm(machine ? { ...blank(), ...machine } : blank()); setManualArt(Boolean(machine)); setPhoto(null); setError("")
  }, [open, machine?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && caps.patrimony) mApi<{ items: Array<{ id: string; name: string }> }>("suppliers").then((result) => setSuppliers(result.items)).catch(() => setSuppliers([]))
  }, [open, caps.patrimony])

  // sugere a ilustração pelo nome/categoria/tipo, mas nunca sobrescreve uma escolha manual
  const category = data.categories.find((item) => item.id === form.categoryId)
  useEffect(() => {
    if (manualArt || !open) return
    const suggestion = category?.illustrationKey && category.illustrationKey !== "generica" ? category.illustrationKey : suggestIllustration(form.name, category?.name, form.equipmentType)
    setForm((current) => (current.illustrationKey === suggestion ? current : { ...current, illustrationKey: suggestion }))
  }, [form.name, form.equipmentType, category?.id, manualArt, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = depreciation({ acquisitionValue: Number(form.acquisitionValue) || 0, freightCost: Number(form.freightCost) || 0, installationCost: Number(form.installationCost) || 0, otherCosts: Number(form.otherCosts) || 0, residualValue: Number(form.residualValue) || 0, usefulLifeMonths: Number(form.usefulLifeMonths) || 0, startDate: form.depreciationStartDate || form.acquisitionDate, method: form.depreciationMethod, adjustments: Number(form.depreciationAdjustments) || 0, asOf: data.today })

  const submit = async () => {
    setError("")
    if (!String(form.name).trim()) return setError("Informe o nome da máquina.")
    setSaving(true)
    try {
      const saved = await mApi<{ item: Row }>("machine", { body: { item: form } })
      if (photo) {
        const uploaded = await uploadMachineFile(photo, saved.item.id)
        await mApi("machine", { body: { item: { id: saved.item.id, name: saved.item.name, photoPath: uploaded.path } } })
      }
      toast({ title: machine ? "Cadastro atualizado" : `Máquina cadastrada: ${saved.item.code}`, description: machine ? undefined : "O QR Code já foi gerado; imprima a etiqueta na ficha da máquina." })
      onSaved(saved.item.id); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }

  return (
    <FormSheet open={open} onOpenChange={(value) => !value && !saving && onClose()} title={machine ? `Editar ${machine.code}` : "Nova máquina ou equipamento"} description={machine ? "O código patrimonial e o QR Code não mudam." : "O código patrimonial (ND-MAQ-000001) é gerado ao salvar."}
      footer={<div className="flex w-full items-center justify-end gap-2">{error ? <p role="alert" className="mr-auto text-sm text-red-700">{error}</p> : null}<Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar</Button></div>}>
      <Tabs defaultValue="ident">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="ident">Identificação</TabsTrigger>
          <TabsTrigger value="local">Local e uso</TabsTrigger>
          {caps.patrimony ? <TabsTrigger value="patr">Patrimônio</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="ident" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nome da máquina" value={form.name} onChange={set("name")} />
            {machine ? <TextField label="Código patrimonial" value={machine.code} onChange={() => undefined} /> : <SelectField label="Tipo de código" value={form.codeKind} onChange={set("codeKind")} options={[{ value: "MAQ", label: "Máquina (ND-MAQ-…)" }, { value: "EQP", label: "Equipamento (ND-EQP-…)" }]} />}
            <SelectField label="Categoria" value={form.categoryId || none} onChange={(value) => set("categoryId")(value === none ? "" : value)} options={[{ value: none, label: "Sem categoria" }, ...data.categories.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))]} />
            <TextField label="Tipo de equipamento" value={form.equipmentType} onChange={set("equipmentType")} />
            <TextField label="Fabricante" value={form.manufacturer} onChange={set("manufacturer")} />
            <TextField label="Marca" value={form.brand} onChange={set("brand")} />
            <TextField label="Modelo" value={form.model} onChange={set("model")} />
            <TextField label="Número de série" value={form.serialNumber} onChange={set("serialNumber")} />
            <TextField label="Ano de fabricação" type="number" value={form.manufactureYear} onChange={set("manufactureYear")} />
          </div>
          <TextAreaField label="Descrição" value={form.description} onChange={set("description")} rows={2} />
          <div className="space-y-2">
            <Label>Representação visual</Label>
            <p className="text-xs text-muted-foreground">Escolha um desenho da biblioteca (sugerido pelo nome) ou envie a foto real. Sem modelo específico, usamos o desenho genérico: nunca uma imagem que possa enganar.</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {illustrationLibrary.map((item) => (
                <button key={item.key} type="button" onClick={() => { setManualArt(true); set("illustrationKey")(item.key) }} aria-pressed={form.illustrationKey === item.key} title={item.label}
                  className={cn("flex flex-col items-center rounded-lg border-2 bg-white p-1 text-[10px] leading-tight", form.illustrationKey === item.key ? "border-primary bg-[var(--brand-softer)]" : "border-slate-200")}>
                  <span className="block h-14 w-full"><IllustrationThumb kind={item.key} /></span>{item.label.split(" ")[0]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} className="text-sm" />
              {form.photoPath && !photo ? <a className="text-sm text-primary underline" href={fileUrl(form.photoPath)} target="_blank" rel="noreferrer">Ver foto atual</a> : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="local" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Setor" value={form.sectorId || none} onChange={(value) => set("sectorId")(value === none ? "" : value)} options={[{ value: none, label: "Sem setor" }, ...data.sectors.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))]} />
            <TextField label="Localização física" value={form.locationDetail} onChange={set("locationDetail")} placeholder="Ex.: galpão 2, baia 4" />
            <SelectField label="Unidade" value={form.unitCompanyId || none} onChange={(value) => set("unitCompanyId")(value === none ? "" : value)} options={[{ value: none, label: "Não informada" }, ...data.units.map((item) => ({ value: item.id, label: item.name }))]} />
            <TextField label="Responsável" value={form.responsibleName} onChange={set("responsibleName")} />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.usesHourMeter} onCheckedChange={(value) => set("usesHourMeter")(value === true)} />Esta máquina tem horímetro (permite planos por horas de operação)</label>
        </TabsContent>

        {caps.patrimony ? (
          <TabsContent value="patr" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Data de aquisição" type="date" value={form.acquisitionDate} onChange={set("acquisitionDate")} />
              <TextField label="Valor de aquisição (R$)" type="number" value={form.acquisitionValue} onChange={set("acquisitionValue")} />
              <SelectField label="Fornecedor" value={form.supplierId || none} onChange={(value) => { set("supplierId")(value === none ? "" : value); set("supplierName")(suppliers.find((item) => item.id === value)?.name || form.supplierName) }} options={[{ value: none, label: "Não vinculado" }, ...suppliers.map((item) => ({ value: item.id, label: item.name }))]} />
              <TextField label="Nota fiscal" value={form.invoiceNumber} onChange={set("invoiceNumber")} />
              <TextField label="Frete (R$)" type="number" value={form.freightCost} onChange={set("freightCost")} />
              <TextField label="Instalação (R$)" type="number" value={form.installationCost} onChange={set("installationCost")} />
              <TextField label="Outros custos atribuíveis (R$)" type="number" value={form.otherCosts} onChange={set("otherCosts")} />
              <TextField label="Valor residual estimado (R$)" type="number" value={form.residualValue} onChange={set("residualValue")} />
              <TextField label="Vida útil estimada (meses)" type="number" value={form.usefulLifeMonths} onChange={set("usefulLifeMonths")} />
              <SelectField label="Método de depreciação" value={form.depreciationMethod} onChange={set("depreciationMethod")} options={[{ value: "Linear", label: "Linear" }, { value: "Nenhum", label: "Não depreciar" }]} />
              <TextField label="Início da depreciação" type="date" value={form.depreciationStartDate} onChange={set("depreciationStartDate")} />
              <TextField label="Ajustes manuais (R$, + ou −)" type="number" value={form.depreciationAdjustments} onChange={set("depreciationAdjustments")} />
              <TextField label="Valor de mercado estimado (R$)" type="number" value={form.marketValue ?? ""} onChange={set("marketValue")} />
              <TextField label="Data da avaliação de mercado" type="date" value={form.marketValueDate} onChange={set("marketValueDate")} />
              <TextField label="Valor estimado de reposição (R$)" type="number" value={form.replacementValue ?? ""} onChange={set("replacementValue")} />
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-medium">Prévia contábil (depreciação linear)</p>
              {preview.applicable ? (
                <p className="mt-1 text-muted-foreground">Custo total {brl(preview.baseValue)} · depreciável {brl(preview.depreciable)} · {brl(preview.monthly)}/mês · acumulada {brl(preview.accumulated)} · <b className="text-foreground">valor contábil {brl(preview.bookValue)}</b></p>
              ) : <p className="mt-1 text-muted-foreground">Informe valor, vida útil e data de início para calcular. O valor contábil não é o valor de mercado: parametrize o método com a contabilidade.</p>}
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
    </FormSheet>
  )
}
