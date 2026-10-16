"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, FileUp, Loader2, TriangleAlert, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, PageShell, SectionCard, StatusBadge, useCrudFeedback } from "@/components/operations/shared"

type Party = { document: string; personType: string; name: string; tradeName: string; stateRegistration: string; email: string; phone: string; zipCode: string; street: string; number: string; complement: string; district: string; city: string; state: string }
type Found = { id: string; code: string; name: string; partyId: string } | null
type Preview = {
  invoice: { kind: string; accessKey: string; number: string; series: string; issuedAt: string; nature: string; total: number; issuer: Party | null; recipient: Party | null; items: Array<{ code: string; description: string; ncm: string; cfop: string; unit: string; quantity: number; unitPrice: number; total: number }>; installments: Array<{ number: string; dueDate: string; amount: number }> }
  counterpart: Party
  existing: { client: Found; supplier: Found }
  similar?: { client: { id: string; code: string; name: string } | null; supplier: { id: string; code: string; name: string } | null }
  duplicate: { id: string; created_at: string; created_by: string } | null
  warnings: string[]
}
type Imported = { id: string; kind: string; number: string; series: string; issued_at: string; total_amount: number; my_role: string; issuer_name: string; recipient_name: string; counterpart_name: string; counterpart_document: string; counterpart_kind: string | null; created_at: string }
type Role = "remetente" | "destinatario"
type RegisterAs = "" | "cliente" | "fornecedor"

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? new Date(value).toLocaleDateString("pt-BR") : "-")
const address = (party: Party) => [[party.street, party.number, party.complement].filter(Boolean).join(", "), party.district, [party.city, party.state].filter(Boolean).join("/"), party.zipCode].filter(Boolean).join(" · ")

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

function PartyBox({ title, party, highlight }: { title: string; party: Party | null; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 text-sm ${highlight ? "border-primary bg-primary/5" : ""}`}>
      <div className="mb-1 flex items-center justify-between gap-2"><span className="font-semibold">{title}</span>{highlight ? <span className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">Parte contrária</span> : null}</div>
      {party ? <>
        <div>{party.name || "(nome não informado na nota)"}</div>
        <div className="text-muted-foreground">{party.document || "-"}{party.stateRegistration ? ` · IE ${party.stateRegistration}` : ""}</div>
        <div className="text-muted-foreground">{address(party) || "Sem endereço na nota"}</div>
      </> : <div className="text-muted-foreground">Não informado na nota.</div>}
    </div>
  )
}

export function NfImportPage() {
  const { toast } = useCrudFeedback()
  const [role, setRole] = useState<Role | "">("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [registerAs, setRegisterAs] = useState<RegisterAs>("")
  const [busy, setBusy] = useState<"" | "ler" | "importar">("")
  const [launch, setLaunch] = useState(true)
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const [history, setHistory] = useState<Imported[]>([])
  const input = useRef<HTMLInputElement>(null)

  const loadHistory = useCallback(async () => {
    try { setHistory((await send<{ items: Imported[] }>("/api/financeiro/nf")).items) } catch (reason) { setError(reason instanceof Error ? reason.message : "") }
  }, [])
  useEffect(() => { void loadHistory() }, [loadHistory])

  function body(action: string) {
    const form = new FormData()
    form.set("file", file as File)
    form.set("role", role)
    form.set("action", action)
    form.set("registerAs", registerAs)
    form.set("launch", launch ? "1" : "0")
    return form
  }

  async function read() {
    if (!file || !role) return
    setBusy("ler"); setError(""); setDone(""); setPreview(null); setRegisterAs("")
    try {
      setPreview(await send<Preview>("/api/financeiro/nf", { method: "POST", body: body("ler") }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler a nota.")
    } finally {
      setBusy("")
    }
  }

  async function importNf() {
    if (!file || !role || !preview) return
    setBusy("importar"); setError("")
    try {
      const { result } = await send<{ result: { registered: string | null; created: boolean; counterpartName: string; titles: { kind: "pagar" | "receber"; count: number; total: number } | null; titlesNote: string } }>("/api/financeiro/nf", { method: "POST", body: body("importar") })
      const text = result.registered ? (result.created ? `${result.counterpartName || "Parte contrária"} cadastrado como ${result.registered.toLowerCase()}.` : `${result.registered} já estava cadastrado; vinculado à nota.`) : "Parte contrária não foi cadastrada."
      const titleText = result.titles ? ` Lançada em Contas a ${result.titles.kind === "pagar" ? "Pagar" : "Receber"}: ${result.titles.count} parcela(s), ${brl(result.titles.total)}.` : result.titlesNote ? ` ${result.titlesNote}` : ""
      setDone(`NF importada. ${text}${titleText}`)
      toast({ title: "NF importada", description: text })
      setPreview(null); setFile(null); setRegisterAs("")
      if (input.current) input.current.value = ""
      await loadHistory()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível importar a nota.")
    } finally {
      setBusy("")
    }
  }

  const roleButton = (value: Role, title: string, hint: string) => (
    <button type="button" onClick={() => { setRole(value); setPreview(null); setRegisterAs("") }} className={`rounded-md border p-4 text-left transition ${role === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
      <div className="font-semibold">{title}</div><div className="text-sm text-muted-foreground">{hint}</div>
    </button>
  )

  const other = preview?.counterpart
  const exists = preview?.existing
  const options: Array<{ value: RegisterAs; label: string; note?: string; disabled?: boolean }> = [
    { value: "cliente", label: "Cadastrar como cliente", note: exists?.client ? `Já é cliente: ${exists.client.code} · ${exists.client.name}` : undefined },
    { value: "fornecedor", label: "Cadastrar como fornecedor", note: exists?.supplier ? `Já é fornecedor: ${exists.supplier.code} · ${exists.supplier.name}` : undefined },
    { value: "", label: "Não cadastrar" },
  ]

  return (
    <PageShell title="Importar NF" description="Leia o XML (ou PDF) de uma nota fiscal, informe se você é o remetente ou o destinatário e escolha se a parte contrária deve ser cadastrada."
      actions={<Button variant="outline" asChild><Link href="/financeiro"><ArrowLeft className="h-4 w-4" />Voltar ao Financeiro</Link></Button>}>
      <SectionCard title="1. Nota fiscal" description="XML de NF-e, NFC-e ou NFS-e (recomendado). Também aceita PDF do DANFE e FOTO ou escaneamento da nota (JPG, PNG, PDF de scanner/CamScanner): nesses casos o sistema lê por OCR e você confere os dados antes de importar.">
        <div className="grid gap-3 md:grid-cols-2">
          {roleButton("remetente", "Sou o remetente", "Eu emiti a nota (venda/serviço). A parte contrária é o destinatário, meu possível cliente.")}
          {roleButton("destinatario", "Sou o destinatário", "Eu recebi a nota (compra). A parte contrária é o emitente, meu possível fornecedor.")}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-2"><Label>Arquivo da nota</Label>
            <input ref={input} type="file" accept=".xml,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,image/*,application/xml,text/xml,application/pdf" className="block w-full max-w-md text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setDone("") }} /></div>
          <Button onClick={() => void read()} disabled={!file || !role || busy !== ""}>{busy === "ler" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Ler nota</Button>
        </div>
        {busy === "ler" && file && !/\.xml$/i.test(file.name) ? <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lendo a foto/PDF por OCR: pode levar até 1 minuto.</p> : null}
        {!role ? <p className="mt-2 text-sm text-muted-foreground">Escolha primeiro se você é remetente ou destinatário.</p> : null}
        {error ? <p className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />{error}</p> : null}
        {done ? <p className="mt-3 flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0" />{done} <Link href="/clientes" className="underline">Ver Clientes & Fornecedores</Link></p> : null}
      </SectionCard>

      {preview && other ? <>
        {preview.duplicate ? <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />Esta nota já foi importada em {day(preview.duplicate.created_at)}{preview.duplicate.created_by ? ` por ${preview.duplicate.created_by}` : ""}. Não é possível importar duas vezes.</p> : null}
        {preview.warnings.map((warning) => <p key={warning} className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><TriangleAlert className="h-4 w-4 shrink-0" />{warning}</p>)}

        <SectionCard title="2. Dados da nota">
          <dl className="grid gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-muted-foreground">Tipo</dt><dd>{preview.invoice.kind}</dd></div>
            <div><dt className="text-muted-foreground">Número / série</dt><dd>{preview.invoice.number || "-"}{preview.invoice.series ? ` / ${preview.invoice.series}` : ""}</dd></div>
            <div><dt className="text-muted-foreground">Emissão</dt><dd>{day(preview.invoice.issuedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Valor total</dt><dd className="font-semibold">{preview.invoice.total ? brl(preview.invoice.total) : "-"}</dd></div>
            {preview.invoice.nature ? <div className="md:col-span-2"><dt className="text-muted-foreground">Natureza</dt><dd>{preview.invoice.nature}</dd></div> : null}
            {preview.invoice.accessKey ? <div className="md:col-span-2"><dt className="text-muted-foreground">Chave de acesso</dt><dd className="break-all font-mono text-xs">{preview.invoice.accessKey}</dd></div> : null}
          </dl>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <PartyBox title="Emitente (remetente)" party={role === "destinatario" ? other : preview.invoice.issuer} highlight={role === "destinatario"} />
            <PartyBox title="Destinatário" party={role === "remetente" ? other : preview.invoice.recipient} highlight={role === "remetente"} />
          </div>
          {preview.invoice.items.length ? <div className="mt-4"><DataTable headers={["Código", "Descrição", "NCM", "CFOP", "Qtd.", "Unitário", "Total"]}>
            {preview.invoice.items.map((item, index) => <TableRow key={index}><TableCell>{item.code}</TableCell><TableCell>{item.description}</TableCell><TableCell>{item.ncm}</TableCell><TableCell>{item.cfop}</TableCell><TableCell>{item.quantity} {item.unit}</TableCell><TableCell>{brl(item.unitPrice)}</TableCell><TableCell>{brl(item.total)}</TableCell></TableRow>)}
          </DataTable></div> : null}
          {preview.invoice.installments.length ? <div className="mt-4"><DataTable headers={["Duplicata", "Vencimento", "Valor"]}>
            {preview.invoice.installments.map((item, index) => <TableRow key={index}><TableCell>{item.number}</TableCell><TableCell>{item.dueDate ? item.dueDate.split("-").reverse().join("/") : "-"}</TableCell><TableCell>{brl(item.amount)}</TableCell></TableRow>)}
          </DataTable></div> : null}
        </SectionCard>

        <SectionCard title="3. Parte contrária" description={`Os dados de ${other.name || other.document} vêm da própria nota (e da Receita Federal, quando faltam).`}>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {exists?.client ? <StatusBadge status="Já é cliente" /> : null}
            {exists?.supplier ? <StatusBadge status="Já é fornecedor" /> : null}
            {!exists?.client && !exists?.supplier ? <span className="text-muted-foreground">Ainda não cadastrada.</span> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {options.map((option) => (
              <button key={option.label} type="button" onClick={() => setRegisterAs(option.value)} className={`rounded-md border p-3 text-left transition ${registerAs === option.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
                <div className="flex items-center gap-2 font-medium">{option.value ? <UserPlus className="h-4 w-4" /> : null}{option.label}</div>
                {option.note ? <div className="mt-1 text-xs text-muted-foreground">{option.note}. Será só vinculada à nota.</div> : null}
              </button>
            ))}
          </div>
          {registerAs && !exists?.[registerAs === "cliente" ? "client" : "supplier"] && preview.similar?.[registerAs === "cliente" ? "client" : "supplier"] ? <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Já existe o cadastro “{preview.similar[registerAs === "cliente" ? "client" : "supplier"]!.name}” ({preview.similar[registerAs === "cliente" ? "client" : "supplier"]!.code}) sem CNPJ: ele será completado com o CNPJ e os dados desta nota, sem criar outro.</p> : null}
          {registerAs && exists?.[registerAs === "cliente" ? "supplier" : "client"] && !exists?.[registerAs === "cliente" ? "client" : "supplier"] ? <p className="mt-3 text-sm text-muted-foreground">Esta empresa já é {registerAs === "cliente" ? "fornecedora" : "cliente"}: o novo cadastro será vinculado ao existente, sem duplicar a empresa.</p> : null}
          {registerAs ? <p className="mt-3 text-sm text-muted-foreground">O cadastro entra como Ativo, com os dados da nota. Telefone e demais campos podem ser completados depois em Clientes & Fornecedores.</p> : null}
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={launch} onChange={(event) => setLaunch(event.target.checked)} />Lançar também em {role === "destinatario" ? "Contas a Pagar" : "Contas a Receber"} ({preview.invoice.installments.length ? `${preview.invoice.installments.length} duplicata(s) da nota` : preview.invoice.total ? `1 parcela de ${brl(preview.invoice.total)} vencendo na emissão` : "sem valor na nota: não será lançado"})</label>
          <div className="mt-4"><Button onClick={() => void importNf()} disabled={busy !== "" || Boolean(preview.duplicate)}>{busy === "importar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Importar NF{registerAs ? ` e cadastrar ${registerAs}` : ""}</Button></div>
        </SectionCard>
      </> : null}

      <SectionCard title="Notas importadas">
        <DataTable headers={["Importada em", "Tipo", "NF", "Emissão", "Meu papel", "Parte contrária", "Cadastro", "Valor"]} empty={!history.length}>
          {history.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{day(row.created_at)}</TableCell><TableCell>{row.kind}</TableCell><TableCell>{row.number || "-"}{row.series ? `/${row.series}` : ""}</TableCell><TableCell>{day(row.issued_at)}</TableCell>
              <TableCell>{row.my_role}</TableCell>
              <TableCell>{row.counterpart_name || "-"}<div className="text-xs text-muted-foreground">{row.counterpart_document}</div></TableCell>
              <TableCell>{row.counterpart_kind || "Não cadastrada"}</TableCell><TableCell>{brl(row.total_amount)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </PageShell>
  )
}
