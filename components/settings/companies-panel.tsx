"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { ConfirmInline, DataTable, SectionCard, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { brStates, cleanDocument } from "@/lib/commercial"
import { fiscalEnvironments, taxRegimes } from "@/lib/config"
import { api, day, Opts, post, type Row } from "@/components/settings/common"

const emptyCompany = (): Row => ({ id: "", legalName: "", tradeName: "", cnpj: "", stateRegistration: "", municipalRegistration: "", taxRegime: "Simples Nacional", cnae: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", phone: "", email: "", fiscalEnvironment: "Homologação", nfeSeries: "", nfeNextNumber: "1", nfseSeries: "", nfseNextNumber: "1", fiscalNotes: "", certificateExpiresAt: "", active: true, isDefault: false })

export function CompaniesPanel() {
  const { toast } = useCrudFeedback()
  const [companies, setCompanies] = useState<Row[]>([])
  const [form, setForm] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [cert, setCert] = useState<{ file?: File; password: string; expiresAt: string }>({ password: "", expiresAt: "" })
  const set = (patch: Row) => setForm((current) => (current ? { ...current, ...patch } : current))

  const load = useCallback(async () => {
    try {
      setCompanies((await api<{ items: Row[] }>("/api/configuracoes/empresas")).items)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar empresas.")
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const expiring = companies.filter((company) => company.active && ["warn", "bad"].includes(company.certificate.status.tone))

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const { item } = await post<{ item: Row }>("empresas", { item: form })
      toast({ title: "Empresa salva" })
      await load()
      setForm((current) => (current ? { ...current, id: item.id } : current))
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function upload(kind: "certificado" | "logo", file: File | undefined) {
    if (!form?.id) return toast({ title: "Salve a empresa antes de enviar arquivos", variant: "destructive" })
    if (!file) return toast({ title: "Selecione o arquivo", variant: "destructive" })
    try {
      const body = new FormData()
      body.set("file", file)
      body.set("kind", kind)
      body.set("companyId", form.id)
      if (kind === "certificado") { body.set("password", cert.password); body.set("expiresAt", cert.expiresAt || form.certificateExpiresAt || "") }
      await api("/api/configuracoes/upload", { method: "POST", body })
      toast({ title: kind === "logo" ? "Logotipo atualizado" : "Certificado guardado", description: kind === "certificado" ? "A senha foi cifrada no servidor e não aparece mais." : undefined })
      setCert({ password: "", expiresAt: "" })
      await load()
    } catch (reason) {
      toast({ title: "Falha no envio", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function lookupCnpj() {
    if (!form) return
    const digits = cleanDocument(form.cnpj)
    if (digits.length !== 14) return toast({ title: "Informe os 14 caracteres do CNPJ", variant: "destructive" })
    try {
      const { company } = await api<{ company: Row }>(`/api/cnpj/${encodeURIComponent(digits)}`)
      set({ legalName: company.legalName || form.legalName, tradeName: company.tradeName || form.tradeName, phone: company.phone || form.phone, email: company.email || form.email, zipCode: company.zipCode || form.zipCode, street: company.street || form.street, number: company.number || form.number, complement: company.complement || form.complement, district: company.district || form.district, city: company.city || form.city, state: company.state || form.state })
      toast({ title: "CNPJ encontrado", description: "Confira os dados e complete as inscrições." })
    } catch (reason) {
      toast({ title: "Consulta de CNPJ indisponível", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  const current = companies.find((company) => company.id === form?.id)

  return (
    <SectionCard title="Empresas" description="Cada CNPJ é uma empresa do sistema; usuários só trabalham nas empresas autorizadas. Dados fiscais e certificado alimentam a emissão de notas.">
      {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {expiring.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <div>{expiring.map((company) => <div key={company.id}>Certificado digital de <strong>{company.tradeName || company.legalName}</strong>: {company.certificate.status.label}.</div>)}</div>
        </div>
      )}
      <Button className="mb-3" onClick={() => { setForm(emptyCompany()); setCert({ password: "", expiresAt: "" }) }}><Plus className="h-4 w-4" />Nova empresa</Button>
      <DataTable headers={["Razão social", "Nome fantasia", "CNPJ", "Regime", "Cidade/UF", "Ambiente fiscal", "Certificado", "Status", "Ações"]} empty={!companies.length}>
        {companies.map((company) => (
          <TableRow key={company.id}>
            <TableCell>{company.legalName}{company.isDefault && <span className="ml-1 rounded bg-muted px-1 text-xs">principal</span>}</TableCell><TableCell>{company.tradeName || "-"}</TableCell><TableCell>{company.cnpj}</TableCell>
            <TableCell>{company.taxRegime || "-"}</TableCell><TableCell>{[company.city, company.state].filter(Boolean).join("/") || "-"}</TableCell><TableCell>{company.fiscalEnvironment}</TableCell>
            <TableCell className={company.certificate.status.tone === "bad" ? "text-destructive" : company.certificate.status.tone === "warn" ? "text-amber-600" : ""}>{company.certificate.status.label}{company.certificate.expiresAt ? ` · ${day(company.certificate.expiresAt)}` : ""}</TableCell>
            <TableCell><StatusBadge status={company.active ? "Ativo" : "Inativo"} /></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => { setForm({ ...emptyCompany(), ...company, nfeNextNumber: String(company.nfeNextNumber || 1), nfseNextNumber: String(company.nfseNextNumber || 1), certificateExpiresAt: company.certificate.expiresAt }); setCert({ password: "", expiresAt: "" }) }}>Editar</Button></TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Sheet open={Boolean(form)} onOpenChange={(value) => !value && setForm(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>{form?.id ? "Editar empresa" : "Nova empresa"}</SheetTitle><SheetDescription>Razão social, CNPJ, regime tributário, endereço e e-mail são obrigatórios. Inscrições são exigidas quando houver série de NF-e / NFS-e.</SheetDescription></SheetHeader>
          {form && (
            <div className="space-y-5 px-4 pb-6">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="Razão social *" value={form.legalName} onChange={(value) => set({ legalName: value })} />
                <TextField label="Nome fantasia" value={form.tradeName} onChange={(value) => set({ tradeName: value })} />
                <div><TextField label="CNPJ *" value={form.cnpj} onChange={(value) => set({ cnpj: value })} /><button type="button" className="mt-1 text-xs text-primary underline" onClick={() => void lookupCnpj()}>Buscar dados pelo CNPJ</button></div>
                <Opts label="Regime tributário *" value={form.taxRegime} onChange={(value) => set({ taxRegime: value })} items={taxRegimes.map((value) => ({ value, label: value }))} />
                <TextField label="Inscrição Estadual" value={form.stateRegistration} onChange={(value) => set({ stateRegistration: value })} />
                <TextField label="Inscrição Municipal" value={form.municipalRegistration} onChange={(value) => set({ municipalRegistration: value })} />
                <TextField label="CNAE principal" value={form.cnae} onChange={(value) => set({ cnae: value })} />
                <TextField label="Telefone" value={form.phone} onChange={(value) => set({ phone: value })} />
                <TextField label="E-mail *" value={form.email} onChange={(value) => set({ email: value })} />
                <TextField label="CEP *" value={form.zipCode} onChange={(value) => set({ zipCode: value })} />
                <TextField label="Logradouro *" value={form.street} onChange={(value) => set({ street: value })} />
                <TextField label="Número *" value={form.number} onChange={(value) => set({ number: value })} />
                <TextField label="Complemento" value={form.complement} onChange={(value) => set({ complement: value })} />
                <TextField label="Bairro *" value={form.district} onChange={(value) => set({ district: value })} />
                <TextField label="Cidade *" value={form.city} onChange={(value) => set({ city: value })} />
                <Opts label="UF *" value={form.state} onChange={(value) => set({ state: value })} items={brStates.map((value) => ({ value, label: value }))} />
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <h3 className="text-sm font-medium">Emissão fiscal</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <Opts label="Ambiente" value={form.fiscalEnvironment} onChange={(value) => set({ fiscalEnvironment: value || "Homologação" })} items={fiscalEnvironments.map((value) => ({ value, label: value }))} />
                  <TextField label="Série da NF-e" value={form.nfeSeries} onChange={(value) => set({ nfeSeries: value })} />
                  <TextField label="Próximo nº da NF-e" type="number" value={form.nfeNextNumber} onChange={(value) => set({ nfeNextNumber: value })} />
                  <TextField label="Série da NFS-e" value={form.nfseSeries} onChange={(value) => set({ nfseSeries: value })} />
                  <TextField label="Próximo nº da NFS-e" type="number" value={form.nfseNextNumber} onChange={(value) => set({ nfseNextNumber: value })} />
                </div>
                <TextAreaField label="Observações fiscais" rows={2} value={form.fiscalNotes} onChange={(value) => set({ fiscalNotes: value })} />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2"><Checkbox id="active" checked={form.active} onCheckedChange={(value) => set({ active: value === true })} /><Label htmlFor="active">Empresa ativa</Label></div>
                <div className="flex items-center gap-2"><Checkbox id="default" checked={form.isDefault} onCheckedChange={(value) => set({ isDefault: value === true })} /><Label htmlFor="default">Empresa principal</Label></div>
              </div>
              <Button onClick={() => void save()} disabled={saving}>Salvar empresa</Button>

              {form.id && (
                <>
                  <div className="space-y-3 rounded-md border p-3">
                    <h3 className="text-sm font-medium">Certificado digital (A1)</h3>
                    <p className="text-xs text-muted-foreground">{current?.certificate.hasFile ? `Arquivo atual: ${current.certificate.name} · ${current.certificate.status.label}${current.certificate.expiresAt ? ` (${day(current.certificate.expiresAt)})` : ""}.` : "Nenhum certificado enviado."} A senha é cifrada no servidor (exige CONFIG_ENCRYPTION_KEY) e nunca é exibida.</p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1"><Label>Arquivo .pfx / .p12</Label><input type="file" accept=".pfx,.p12" onChange={(event) => setCert((previous) => ({ ...previous, file: event.target.files?.[0] }))} /></div>
                      <TextField label="Senha do certificado" type="password" value={cert.password} onChange={(value) => setCert((previous) => ({ ...previous, password: value }))} />
                      <TextField label="Validade" type="date" value={cert.expiresAt} onChange={(value) => setCert((previous) => ({ ...previous, expiresAt: value }))} />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => void upload("certificado", cert.file)}>Guardar certificado</Button>
                      {current?.certificate.hasFile && <ConfirmInline label="Remover certificado" onConfirm={() => void post("empresas", { action: "remove-certificate", companyId: form.id }).then(load).catch((reason) => toast({ title: "Erro", description: String(reason?.message || reason), variant: "destructive" }))} />}
                    </div>
                  </div>
                  <div className="space-y-2 rounded-md border p-3">
                    <h3 className="text-sm font-medium">Logotipo (usado no PDF dos orçamentos)</h3>
                    {current?.hasLogo && <p className="text-xs text-muted-foreground">Logotipo cadastrado. Envie outro para substituir.</p>}
                    <input type="file" accept="image/png,image/jpeg" onChange={(event) => void upload("logo", event.target.files?.[0])} />
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </SectionCard>
  )
}
