"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { natureKinds, sectionByKey } from "@/lib/config"
import { api, Opts, post, type Row } from "@/components/settings/common"

const toForm = (key: string, values: Row) => {
  const section = sectionByKey(key)!
  return Object.fromEntries(section.fields.map((field) => [field.key, field.type === "list" || field.type === "emails" ? (values[field.key] || []).join("\n") : field.type === "number" ? String(values[field.key] ?? "") : values[field.key] ?? ""]))
}

/** Formulário gerado a partir da definição da seção (lib/config.ts): financeiras, estoque, operacionais, comerciais e notificações. */
export function ParametersPanel({ sectionKey }: { sectionKey: string }) {
  const { toast } = useCrudFeedback()
  const section = sectionByKey(sectionKey)!
  const [values, setValues] = useState<Row>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { settings } = await api<{ settings: Record<string, Row> }>("/api/configuracoes/parametros")
    setValues(toForm(sectionKey, settings[sectionKey]))
    setLoaded(true)
  }, [sectionKey])
  useEffect(() => { setLoaded(false); void load().catch((reason) => toast({ title: "Erro ao carregar parâmetros", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    setSaving(true)
    try {
      await post("parametros", { section: sectionKey, values })
      toast({ title: "Parâmetros salvos", description: "Valem para esta empresa a partir de agora." })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Carregando...</p>
  return (
    <SectionCard title={section.title} description={section.description}>
      <div className="grid gap-3 md:grid-cols-2">
        {section.fields.map((field) => {
          if (field.type === "boolean") return <div key={field.key} className="flex items-center gap-2 py-2"><Checkbox id={field.key} checked={Boolean(values[field.key])} onCheckedChange={(value) => setValues({ ...values, [field.key]: value === true })} /><Label htmlFor={field.key}>{field.label}</Label></div>
          if (field.type === "select") return <Opts key={field.key} label={field.label} value={values[field.key]} onChange={(value) => setValues({ ...values, [field.key]: value })} items={(field.options || []).map((option) => ({ value: option, label: option }))} />
          if (field.type === "textarea" || field.type === "list" || field.type === "emails") return <div key={field.key} className="md:col-span-2"><TextAreaField label={field.label} rows={field.type === "textarea" ? 3 : 5} value={values[field.key] ?? ""} onChange={(value) => setValues({ ...values, [field.key]: value })} />{field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}</div>
          return <div key={field.key} className={field.unavailable ? "pointer-events-none opacity-60" : ""}><TextField label={field.label} type={field.type === "number" ? "number" : "text"} value={values[field.key] ?? ""} onChange={(value) => setValues({ ...values, [field.key]: value })} />{field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}</div>
        })}
      </div>
      <Button className="mt-4" onClick={() => void save()} disabled={saving}>Salvar parâmetros</Button>
    </SectionCard>
  )
}

const emptyNature = (): Row => ({ id: "", name: "", kind: "Venda", defaultCfop: "", notes: "", active: true })

/** Natureza das operações usada na emissão fiscal, mais o resumo dos certificados de todas as empresas. */
export function FiscalPanel() {
  const { toast } = useCrudFeedback()
  const [natures, setNatures] = useState<Row[]>([])
  const [companies, setCompanies] = useState<Row[]>([])
  const [form, setForm] = useState<Row | null>(null)

  const load = useCallback(async () => {
    const [n, c] = await Promise.all([api<{ items: Row[] }>("/api/configuracoes/naturezas"), api<{ items: Row[] }>("/api/configuracoes/empresas")])
    setNatures(n.items)
    setCompanies(c.items)
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    try {
      await post("naturezas", { item: form })
      setForm(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Parâmetros fiscais por empresa" description="Ambiente, séries, numeração, inscrições e certificado são editados no cadastro de cada empresa (aba Empresas).">
        <DataTable headers={["Empresa", "Regime", "Ambiente", "Série NF-e / próximo", "Série NFS-e / próximo", "Certificado"]} empty={!companies.length}>
          {companies.map((company) => (
            <TableRow key={company.id}>
              <TableCell>{company.tradeName || company.legalName}</TableCell><TableCell>{company.taxRegime || "-"}</TableCell><TableCell>{company.fiscalEnvironment}</TableCell>
              <TableCell>{company.nfeSeries ? `${company.nfeSeries} / ${company.nfeNextNumber}` : "-"}</TableCell><TableCell>{company.nfseSeries ? `${company.nfseSeries} / ${company.nfseNextNumber}` : "-"}</TableCell>
              <TableCell className={company.certificate.status.tone === "bad" ? "text-destructive" : company.certificate.status.tone === "warn" ? "text-amber-600" : ""}>{company.certificate.status.label}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        <p className="mt-2 text-xs text-muted-foreground">Regras de CFOP, CST e IBS/CBS por produto continuam no cadastro de Produtos / Serviços; elas são tabelas atualizáveis, sem tratamento fiscal fixo no sistema.</p>
      </SectionCard>

      <SectionCard title="Natureza das operações" description="Lista usada para classificar vendas, serviços, remessas e devoluções na emissão fiscal.">
        <Button className="mb-3" onClick={() => setForm(emptyNature())}><Plus className="h-4 w-4" />Nova natureza</Button>
        <DataTable headers={["Natureza", "Tipo", "CFOP padrão", "Observações", "Status", "Ações"]} empty={!natures.length}>
          {natures.map((nature) => (
            <TableRow key={nature.id}>
              <TableCell>{nature.name}</TableCell><TableCell>{nature.kind}</TableCell><TableCell>{nature.defaultCfop || "-"}</TableCell><TableCell>{nature.notes || "-"}</TableCell><TableCell><StatusBadge status={nature.active ? "Ativo" : "Inativo"} /></TableCell>
              <TableCell><Button size="sm" variant="outline" onClick={() => setForm({ ...nature })}>Editar</Button></TableCell>
            </TableRow>
          ))}
        </DataTable>
        <Sheet open={Boolean(form)} onOpenChange={(value) => !value && setForm(null)}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader><SheetTitle>{form?.id ? "Editar natureza" : "Nova natureza"}</SheetTitle><SheetDescription>CFOP padrão é opcional (4 dígitos).</SheetDescription></SheetHeader>
            {form && (
              <div className="space-y-4 px-4 pb-6">
                <TextField label="Natureza da operação *" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
                <Opts label="Tipo *" value={form.kind} onChange={(value) => setForm({ ...form, kind: value || "Venda" })} items={natureKinds.map((value) => ({ value, label: value }))} />
                <TextField label="CFOP padrão" value={form.defaultCfop} onChange={(value) => setForm({ ...form, defaultCfop: value })} />
                <TextAreaField label="Observações" rows={2} value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
                <div className="flex items-center gap-2"><Checkbox id="nature-active" checked={form.active} onCheckedChange={(value) => setForm({ ...form, active: value === true })} /><Label htmlFor="nature-active">Ativa</Label></div>
                <Button onClick={() => void save()}>Salvar</Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </SectionCard>
    </div>
  )
}
