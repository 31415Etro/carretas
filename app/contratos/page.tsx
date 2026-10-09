"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, FileText, Loader2, Plus, Trash2 } from "lucide-react"
import { PageShell, SectionCard, useOperationalStore } from "@/components/operations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { Client } from "@/lib/operational-storage"

type Contract = {
  id: string
  number: string
  client: string
  work: string
  title: string
  startDate: string
  endDate: string
  value: number
  status: string
  notes: string
  createdAt: string
}

type TemplateField = {
  key: string
  label: string
  placeholders: string[]
  source?: "name" | "document" | "address" | "zipCode" | "phone" | "cityState" | "currentDate"
  input?: "text" | "textarea"
  defaultValue?: string
  required?: boolean
}

type DocumentTemplate = {
  id: string
  name: string
  description: string
  fields: TemplateField[]
}

type IssuerCompany = {
  id: string
  name: string
  cnpj: string
  address: string
  phone: string
  email: string
}

const issuerCompanies: IssuerCompany[] = [
  {
    id: "mc",
    name: "M&C CLIMATIZAÇÃO LTDA",
    cnpj: "19.826.201/0001-70",
    address: "Rua Genésio Tavares nº 180, Bairro São Vicente, Itajaí – SC",
    phone: "(47) 3083-0207",
    email: "contato@climatizacaomc.com.br",
  },
  {
    id: "maicon",
    name: "MAICON VENANCIO COMERCIO E SERVIÇOS DE CLIMATIZAÇÃO",
    cnpj: "28.027.790/0001-18",
    address: "Rua Genésio Tavares nº 180, Bairro São Vicente, Itajaí – SC",
    phone: "(47) 3083-0207",
    email: "contato@climatizacaomc.com.br",
  },
  {
    id: "mm",
    name: "M&M INDÚSTRIA E COMÉRCIO LTDA",
    cnpj: "67.088.81/0001-67",
    address: "Rua Genésio Tavares nº 180, Lote 0904, Bairro São Vicente, Itajaí – SC",
    phone: "(47) 3083-0207",
    email: "contato@climatizacaomc.com.br",
  },
]

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `contract-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0)
}

function currentDateText() {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())
}

function clientAddress(client: Client) {
  return [
    [client.street, client.number].filter(Boolean).join(", "),
    client.complement,
    client.district,
  ].filter(Boolean).join(", ")
}

function clientValue(client: Client, source?: TemplateField["source"]) {
  if (!source) return ""
  if (source === "name") return client.corporateName || client.name || client.tradeName || ""
  if (source === "document") return client.document || ""
  if (source === "address") return clientAddress(client)
  if (source === "zipCode") return client.zipCode || ""
  if (source === "phone") return client.phone || client.mobile || ""
  if (source === "cityState") return [client.city, client.state].filter(Boolean).join("/")
  if (source === "currentDate") return currentDateText()
  return ""
}

function numericValue(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")
  return Number(normalized) || 0
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function downloadDocxAsPdf(blob: Blob, fileName: string) {
  const [{ renderAsync }, { default: html2canvas }, { jsPDF }] = await Promise.all([
    import("docx-preview"),
    import("html2canvas"),
    import("jspdf"),
  ])
  const container = document.createElement("div")
  const styleContainer = document.createElement("div")
  container.style.cssText = "position:fixed;left:-100000px;top:0;background:#fff;z-index:-1;"
  styleContainer.style.cssText = "position:fixed;left:-100000px;top:0;"
  document.body.append(styleContainer, container)

  try {
    await renderAsync(blob, container, styleContainer, {
      breakPages: true,
      ignoreHeight: false,
      ignoreWidth: false,
      inWrapper: true,
    })
    await document.fonts?.ready
    const pages = Array.from(container.querySelectorAll<HTMLElement>(".docx-wrapper > section.docx"))
    if (!pages.length) throw new Error("Não foi possível montar as páginas do PDF.")

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true })
    for (const [index, page] of pages.entries()) {
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        logging: false,
        scale: 1.5,
        useCORS: true,
      })
      if (index > 0) pdf.addPage("a4", "portrait")
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
      const width = canvas.width * ratio
      const height = canvas.height * ratio
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", (pageWidth - width) / 2, 0, width, height, undefined, "FAST")
    }
    pdf.save(fileName.replace(/\.docx$/i, ".pdf"))
  } finally {
    container.remove()
    styleContainer.remove()
  }
}

function joinCompanyNames(names: string[]) {
  if (names.length <= 1) return names[0] || ""
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`
}

function issuerDocumentValues(ids: string[], values: Record<string, string>) {
  const selected = issuerCompanies.filter((company) => ids.includes(company.id))
  const companyBlocks = selected.map((company) => [
    `Razão Social: ${company.name}`,
    `CNPJ: ${company.cnpj}`,
    `Endereço: ${company.address}`,
    `Telefone: ${company.phone}`,
    `E-mail: ${company.email}`,
  ].join("\n")).join("\n\n")
  const qualification = selected.map((company, index) => {
    const ending = index === selected.length - 1
      ? `, neste ato ${selected.length > 1 ? "denominadas" : "denominada"} de CONTRATADA`
      : ";"
    return `${company.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${company.cnpj}, com sede na ${company.address}${ending}`
  }).join("\n\n")
  const signatures = selected.map((company) => [
    "________________________________________________",
    company.name,
    `CNPJ Nº ${company.cnpj}`,
    "CONTRATADA",
  ].join("\n")).join("\n\n")
  const clientSignature = [
    "________________________________________________",
    values.empresa || values.nomeEmpresa,
    "CONTRATANTE",
  ].join("\n")

  return {
    issuerCompanyBlocks: companyBlocks,
    issuerNames: selected.map((company) => company.name).join("; "),
    issuerDocuments: selected.map((company) => `${company.name}: ${company.cnpj}`).join("\n"),
    issuerAddresses: selected.map((company) => `${company.name}: ${company.address}`).join("\n"),
    issuerPhones: [...new Set(selected.map((company) => company.phone))].join("; "),
    issuerEmails: [...new Set(selected.map((company) => company.email))].join("; "),
    issuerQualification: qualification,
    issuerSignatures: signatures,
    issuerAddendumNames: joinCompanyNames(selected.map((company) => company.name)),
    termSignatureBlock: `${clientSignature}\n\n${signatures}`,
  }
}

function addendumClauseValues(values: Record<string, string>, clauseCount: number) {
  return Object.fromEntries(Array.from({ length: 5 }, (_, index) => {
    const clauseNumber = index + 1
    const clause = index < clauseCount ? String(values[`clause${clauseNumber}`] || "").trim() : ""
    return [`clauseBlock${clauseNumber}`, clause ? `CLÁUSULA ${clauseNumber} – ${clause}` : ""]
  }))
}

export default function ContratosPage() {
  const { state } = useOperationalStore()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplate[]>([])
  const [templateId, setTemplateId] = useState("")
  const [clientId, setClientId] = useState("")
  const [issuerIds, setIssuerIds] = useState<string[]>(["maicon"])
  const [values, setValues] = useState<Record<string, string>>({})
  const [clauseCount, setClauseCount] = useState(1)
  const [outputFormat, setOutputFormat] = useState<"docx" | "pdf">("docx")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  const clients = useMemo(
    () => [...state.clients].filter((client) => client.status !== "Inativo").sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [state.clients],
  )
  const selectedTemplate = documentTemplates.find((template) => template.id === templateId)
  const selectedClient = clients.find((client) => client.id === clientId)

  useEffect(() => {
    Promise.all([
      fetch("/api/budget-contracts", { cache: "no-store" }).then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Erro ao carregar contratos.")
        return data.contracts || []
      }),
      fetch("/api/contract-documents", { cache: "no-store" }).then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Erro ao carregar modelos de contrato.")
        return data.templates || []
      }),
    ])
      .then(([loadedContracts, loadedTemplates]) => {
        setContracts(loadedContracts)
        setDocumentTemplates(loadedTemplates)
        setTemplateId(loadedTemplates[0]?.id || "")
      })
      .catch((error) => window.alert(error instanceof Error ? error.message : "Erro ao carregar contratos."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedTemplate) return
    const nextValues: Record<string, string> = {}
    for (const field of selectedTemplate.fields) {
      nextValues[field.key] = selectedClient
        ? clientValue(selectedClient, field.source)
        : field.source === "currentDate" ? currentDateText() : field.defaultValue || ""
      if (!nextValues[field.key] && field.defaultValue) nextValues[field.key] = field.defaultValue
    }
    setValues(nextValues)
    setIssuerIds(selectedTemplate.id === "termo-aditivo" ? issuerCompanies.map((company) => company.id) : ["maicon"])
    setClauseCount(selectedTemplate.id === "termo-aditivo" ? 3 : 1)
  }, [selectedTemplate?.id, selectedClient?.id])

  const filteredContracts = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return contracts
    return contracts.filter((contract) => [contract.number, contract.client, contract.work, contract.title, contract.status].join(" ").toLowerCase().includes(term))
  }, [contracts, query])

  function nextNumber() {
    const greatest = contracts.reduce((max, contract) => Math.max(max, Number(contract.number.match(/\d+/)?.[0] || 0)), 0)
    return `CT-${String(greatest + 1).padStart(4, "0")}`
  }

  async function persistGeneratedContract(contract: Contract) {
    setSaving(true)
    try {
      const nextContracts = [contract, ...contracts]
      const response = await fetch("/api/budget-contracts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contracts: nextContracts }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "O documento foi gerado, mas o registro não foi salvo.")
      setContracts(nextContracts)
    } finally {
      setSaving(false)
    }
  }

  async function generateDocument() {
    if (!selectedTemplate) return window.alert("Selecione o tipo de contrato.")
    if (!selectedClient) return window.alert("Selecione um cliente.")
    if (!issuerIds.length) return window.alert("Selecione ao menos uma empresa emitente.")
    const missing = selectedTemplate.fields.filter((field) => field.required !== false && !String(values[field.key] || "").trim())
    if (missing.length) return window.alert(`Preencha os campos: ${missing.map((field) => field.label).join(", ")}.`)

    setGenerating(true)
    try {
      const generatedValues = {
        ...values,
        ...issuerDocumentValues(issuerIds, values),
        ...(selectedTemplate.id === "termo-aditivo" ? addendumClauseValues(values, clauseCount) : {}),
      }
      const response = await fetch("/api/contract-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplate.id, clientName: selectedClient.name, values: generatedValues }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Erro ao gerar o documento.")
      }

      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") || ""
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${selectedTemplate.id}.docx`
      if (outputFormat === "pdf") await downloadDocxAsPdf(blob, fileName)
      else downloadBlob(blob, fileName)

      const generatedContract: Contract = {
        id: createId(),
        number: nextNumber(),
        client: selectedClient.name,
        work: [selectedClient.city, selectedClient.state].filter(Boolean).join("/"),
        title: selectedTemplate.name,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
        value: numericValue(values.valorContrato || ""),
        status: "Em elaboração",
        notes: `Documento gerado pelo modelo ${selectedTemplate.name}.`,
        createdAt: new Date().toISOString(),
      }
      await persistGeneratedContract(generatedContract)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao gerar o documento.")
    } finally {
      setGenerating(false)
    }
  }

  async function updateContractStatus(id: string, status: string) {
    const nextContracts = contracts.map((contract) => contract.id === id ? { ...contract, status } : contract)
    setSaving(true)
    try {
      const response = await fetch("/api/budget-contracts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contracts: nextContracts }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Erro ao atualizar o contrato.")
      setContracts(nextContracts)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao atualizar o contrato.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell
      title="Contratos"
      description="Preencha os modelos oficiais com os dados dos clientes e gere o documento pronto para assinatura."
      actions={<Button onClick={() => document.getElementById("gerar-contrato")?.scrollIntoView({ behavior: "smooth" })}><FileText className="h-4 w-4" />Gerar contrato</Button>}
    >
      <Tabs defaultValue="gerar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="gerar">Gerar documento</TabsTrigger>
          <TabsTrigger value="contratos">Contratos gerados</TabsTrigger>
          <TabsTrigger value="modelos">Modelos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="gerar" id="gerar-contrato">
          <SectionCard title="Novo documento" description="Selecione o modelo e o cliente. Os dados cadastrais são preenchidos automaticamente e podem ser revisados antes do download.">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando modelos...</div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipo de contrato</Label>
                    <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                      <SelectContent sortItems>{documentTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {selectedTemplate ? <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Cliente</Label>
                    <Select value={clientId} onValueChange={setClientId}>
                      <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                      <SelectContent sortItems>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
                    </Select>
                    {selectedClient ? <p className="text-xs text-muted-foreground">{selectedClient.document || "Sem documento cadastrado"} · {[selectedClient.city, selectedClient.state].filter(Boolean).join("/") || "Sem cidade cadastrada"}</p> : null}
                  </div>
                </div>

                <div className="space-y-3 border-t pt-5">
                  <div>
                    <h3 className="text-base font-semibold">Empresa(s) emitente(s)</h3>
                    <p className="text-sm text-muted-foreground">Selecione uma ou mais empresas responsáveis pelo contrato e pelas assinaturas.</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    {issuerCompanies.map((company) => {
                      const checked = issuerIds.includes(company.id)
                      return (
                        <label key={company.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-4 transition hover:border-primary/40">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) => setIssuerIds((current) => nextChecked
                              ? [...current, company.id]
                              : current.filter((id) => id !== company.id))}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{company.name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">CNPJ {company.cnpj}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {selectedTemplate ? (
                  <div className="border-t pt-5">
                    <div className="mb-4">
                      <h3 className="text-base font-semibold">Variáveis do documento</h3>
                      <p className="text-sm text-muted-foreground">Revise os campos abaixo. Eles substituem os marcadores entre parênteses no modelo.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {selectedTemplate.fields.filter((field) => !field.key.startsWith("clause")).map((field) => (
                        <div key={field.key} className={field.input === "textarea" ? "space-y-2 md:col-span-2" : "space-y-2"}>
                          <Label htmlFor={`contract-${field.key}`}>{field.label}{field.required === false ? " (opcional)" : ""}</Label>
                          {field.input === "textarea" ? (
                            <Textarea id={`contract-${field.key}`} value={values[field.key] || ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                          ) : (
                            <Input id={`contract-${field.key}`} value={values[field.key] || ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                          )}
                        </div>
                      ))}
                    </div>
                    {selectedTemplate.id === "termo-aditivo" ? (
                      <div className="mt-6 space-y-4 border-t pt-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold">Cláusulas do aditivo</h3>
                            <p className="text-sm text-muted-foreground">Edite as cláusulas existentes ou adicione até cinco.</p>
                          </div>
                          <div className="flex gap-2">
                            {clauseCount > 1 ? (
                              <Button type="button" variant="outline" onClick={() => setClauseCount((current) => Math.max(1, current - 1))}>
                                <Trash2 className="h-4 w-4" />Remover última
                              </Button>
                            ) : null}
                            <Button type="button" variant="outline" disabled={clauseCount >= 5} onClick={() => setClauseCount((current) => Math.min(5, current + 1))}>
                              <Plus className="h-4 w-4" />Adicionar cláusula
                            </Button>
                          </div>
                        </div>
                        {Array.from({ length: clauseCount }, (_, index) => {
                          const field = selectedTemplate.fields.find((item) => item.key === `clause${index + 1}`)
                          if (!field) return null
                          return (
                            <div key={field.key} className="space-y-2">
                              <Label htmlFor={`contract-${field.key}`}>{field.label}{field.required === false ? " (opcional)" : ""}</Label>
                              <Textarea
                                id={`contract-${field.key}`}
                                rows={4}
                                value={values[field.key] || ""}
                                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                              />
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full space-y-2 sm:w-64">
                    <Label>Formato do arquivo</Label>
                    <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as "docx" | "pdf")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="docx">Microsoft Word (.docx)</SelectItem>
                        <SelectItem value="pdf">PDF (.pdf)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="lg" disabled={generating || saving || !selectedClient || !selectedTemplate} onClick={generateDocument}>
                    {generating || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {generating ? `Gerando ${outputFormat === "pdf" ? "PDF" : "Word"}...` : saving ? "Salvando registro..." : `Gerar e baixar ${outputFormat === "pdf" ? "PDF" : "Word"}`}
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="contratos">
          <SectionCard title="Contratos gerados">
            <div className="mb-4 max-w-md"><Input value={query} placeholder="Buscar por cliente, tipo ou status" onChange={(event) => setQuery(event.target.value)} /></div>
            <Table>
              <TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Data</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredContracts.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum contrato encontrado.</TableCell></TableRow>
                ) : filteredContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.number}</TableCell>
                    <TableCell>{contract.client}</TableCell>
                    <TableCell>{contract.title}</TableCell>
                    <TableCell>{contract.createdAt ? new Date(contract.createdAt).toLocaleDateString("pt-BR") : "-"}</TableCell>
                    <TableCell>{money(contract.value)}</TableCell>
                    <TableCell><Badge variant="outline">{contract.status}</Badge></TableCell>
                    <TableCell><div className="flex flex-wrap gap-2"><Button disabled={saving} size="sm" variant="outline" onClick={() => updateContractStatus(contract.id, "Enviado")}>Enviado</Button><Button disabled={saving} size="sm" variant="outline" onClick={() => updateContractStatus(contract.id, "Assinado")}>Assinado</Button><Button disabled={saving} size="sm" variant="outline" onClick={() => updateContractStatus(contract.id, "Cancelado")}>Cancelar</Button></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        <TabsContent value="modelos">
          <SectionCard title="Modelos disponíveis" description="Os modelos oficiais são preservados em DOCX e preenchidos sem alterar sua estrutura.">
            <div className="grid gap-3 md:grid-cols-2">
              {documentTemplates.map((template) => (
                <div key={template.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{template.name}</h3><p className="mt-1 text-sm text-muted-foreground">{template.description}</p></div><Badge variant="outline">Ativo</Badge></div>
                  <p className="mt-4 text-xs text-muted-foreground">{template.fields.length} campos configurados</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="historico">
          <SectionCard title="Histórico de contratos" description="Documentos gerados e alterações de status.">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Contrato</TableHead><TableHead>Cliente</TableHead><TableHead>Status atual</TableHead></TableRow></TableHeader>
              <TableBody>{contracts.map((contract) => <TableRow key={contract.id}><TableCell>{contract.createdAt ? new Date(contract.createdAt).toLocaleDateString("pt-BR") : "-"}</TableCell><TableCell>{contract.number}</TableCell><TableCell>{contract.client}</TableCell><TableCell>{contract.status}</TableCell></TableRow>)}</TableBody>
            </Table>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
