"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { History, Loader2, Lock, Send, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/operations/shared"
import { UploadField } from "@/components/catalog/upload-field"
import { api, dateBr, Field } from "@/components/catalog/catalog-fields"
import { useAuth } from "@/lib/auth-context"
import { docStatusLabel, docStatusTone, documentationActions, finalStageLabels, normalizeVin, releaseLabel, vinProblem } from "@/lib/vehicle-documentation"

type Detail = { documentation: Record<string, any>; attempts: Array<Record<string, any>>; events: Array<Record<string, any>>; files: Array<Record<string, any>>; release: { eligible: boolean; blockers: Array<{ code: string; message: string; waivable: boolean }> } }
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)
const outcomeLabel: Record<string, string> = { sucesso: "Enviado", erro: "Erro", indisponivel: "Serviço indisponível", rejeitado: "Rejeitado", exigencia: "Exigência", aprovado: "Aprovado", processando: "Em processamento", ignorado: "Ignorado" }

/** Dados, ações e histórico de UMA unidade (um veículo). Usado na página de Documentação veicular e no pedido de venda. */
export function DocumentationSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged?: () => void }) {
  const { user } = useAuth()
  const role = user?.role || ""
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [form, setForm] = useState({ vin: "", catNumber: "", brandModelVersionCode: "", productModel: "", responsible: "", notes: "" })
  const [protocol, setProtocol] = useState("")
  const [result, setResult] = useState({ result: "aprovado", message: "", pendencies: "" })
  const [reason, setReason] = useState("")
  const [mode, setMode] = useState<"" | "protocol" | "result" | "cancel">("")
  const keys = useRef({ submit: newKey(), manual: newKey(), result: newKey() })

  const apply = useCallback((next: Detail) => {
    setDetail(next)
    const doc = next.documentation
    setForm({ vin: doc.vin || "", catNumber: doc.cat_number || "", brandModelVersionCode: doc.brand_model_version_code || "", productModel: doc.product_model || "", responsible: doc.responsible || "", notes: doc.notes || "" })
  }, [])
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setNotice("")
    try { apply((await api<{ detail: Detail }>(`/api/documentacao/${id}`)).detail) } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Erro ao carregar.") } finally { setLoading(false) }
  }, [id, apply])
  useEffect(() => { setDetail(null); setMode(""); if (id) void load() }, [id, load])

  async function act(action: string, body: Record<string, unknown> = {}, success = "Ação concluída.", after?: () => void) {
    if (!id) return
    setBusy(action); setNotice("")
    try {
      const data = await api<{ detail: Detail; result: Record<string, any> }>(`/api/documentacao/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) })
      apply(data.detail); setMode(""); setReason(""); after?.()
      const status = (data.result as Record<string, any>)?.status
      setNotice(success + (action === "update" && (data.result as Record<string, any>)?.missing?.length ? ` Falta: ${((data.result as Record<string, any>).missing as string[]).join("; ")}.` : status ? ` Situação: ${docStatusLabel(status)}.` : ""))
      onChanged?.()
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Ação não concluída.") } finally { setBusy("") }
  }

  const doc = detail?.documentation
  const actions = doc ? documentationActions({ status: doc.status, protocol: doc.protocol, channel: doc.channel }, role) : null
  const vinError = form.vin.trim() ? vinProblem(form.vin) : ""
  const pendencies: string[] = [...(doc?.status === "Pendente de dados" ? (doc?.missing as string[]) || [] : []), ...((doc?.pendencies as string[]) || []).filter((item) => typeof item === "string")]

  return (
    <FormSheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()} title={doc ? `Unidade ${doc.unit_number} · ${doc.product_name}` : "Documentação veicular"}
      description={doc ? `Pedido ${doc.order_number} · ${doc.client_name}` : "Carregando..."}>
      {loading && !detail ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
      {doc && detail && actions ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${docStatusTone(doc.status)}`}>{docStatusLabel(doc.status)}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{finalStageLabels[doc.final_stage] || doc.final_stage}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Canal: {doc.channel === "manual" ? "manual" : doc.channel === "simulador" ? "simulador (teste)" : "lote SERPRO"}</span>
            {doc.stale ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Sem retorno há muito tempo</span> : null}
          </div>
          <p className={`flex items-start gap-2 rounded-md border p-3 text-sm ${detail.release.eligible ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            {detail.release.eligible ? null : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}{releaseLabel(detail.release)}
          </p>
          <p className="text-xs text-muted-foreground">Pré-cadastro aprovado libera a fabricação; ele <strong>não é</strong> CRLV, ATPV-e nem emplacamento (esses ficam no estágio de documentação final).</p>
          {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
          {pendencies.length ? <ul className="list-disc space-y-1 rounded-md border border-orange-200 bg-orange-50 p-3 pl-7 text-sm text-orange-900">{pendencies.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
          {doc.last_error ? <p className="flex items-start gap-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{doc.last_error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Chassi / VIN" error={vinError} hint="17 caracteres, sem I, O e Q. Um chassi só pode existir em uma documentação.">
              <Input className="font-mono" value={form.vin} disabled={!actions.edit} onChange={(event) => setForm({ ...form, vin: normalizeVin(event.target.value) })} aria-invalid={Boolean(vinError)} />
            </Field>
            <Field label="Modelo"><Input value={form.productModel} disabled={!actions.edit} onChange={(event) => setForm({ ...form, productModel: event.target.value })} /></Field>
            <Field label="CAT (quando aplicável)"><Input value={form.catNumber} disabled={!actions.edit} onChange={(event) => setForm({ ...form, catNumber: event.target.value })} /></Field>
            <Field label="Código marca/modelo/versão (quando aplicável)"><Input value={form.brandModelVersionCode} disabled={!actions.edit} onChange={(event) => setForm({ ...form, brandModelVersionCode: event.target.value })} /></Field>
            <Field label="Responsável"><Input value={form.responsible} disabled={!actions.edit} onChange={(event) => setForm({ ...form, responsible: event.target.value })} /></Field>
            <Field label="Protocolo"><Input value={doc.protocol || ""} disabled placeholder="Preenchido após o envio" /></Field>
          </div>
          <Field label="Observações"><Textarea rows={2} value={form.notes} disabled={!actions.edit} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div>Portal: {doc.portal}</div><div>Enviado: {dateBr(doc.submitted_at)}</div><div>Última consulta: {dateBr(doc.last_checked_at)}</div>
            <div>Pedido: <Link className="text-primary underline" href={`/vendas/${doc.sales_order_id}`}>{doc.order_number}</Link></div><div>Estrutura: {doc.bom_version ? `v${doc.bom_version}` : "-"}</div><div>Aprovado: {dateBr(doc.approved_at)}</div>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            {actions.edit ? <Button variant="outline" disabled={Boolean(busy) || Boolean(vinError)} onClick={() => void act("update", { vin: form.vin, catNumber: form.catNumber, brandModelVersionCode: form.brandModelVersionCode, productModel: form.productModel, responsible: form.responsible, notes: form.notes }, actions.correct ? "Correção salva: a unidade volta para envio." : "Dados conferidos e salvos.")}>{busy === "update" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{actions.correct ? "Salvar correção" : "Conferir e salvar dados"}</Button> : null}
            {actions.submitAutomatic ? <Button disabled={Boolean(busy)} onClick={() => void act("submit", { requestKey: keys.current.submit }, "Solicitação enviada.", () => { keys.current.submit = newKey() })}>{busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Enviar solicitação</Button> : null}
            {actions.registerManualSubmission ? <Button disabled={Boolean(busy)} onClick={() => setMode("protocol")}><Send className="h-4 w-4" />Registrar envio (protocolo do portal)</Button> : null}
            {actions.consult ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("consult", {}, "Andamento consultado.")}>{busy === "consult" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Consultar andamento</Button> : null}
            {actions.registerResult ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => setMode("result")}>Registrar retorno do portal</Button> : null}
            {actions.cancel ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => setMode("cancel")}>Cancelar documentação</Button> : null}
          </div>
          {doc.channel === "serpro_lote" ? <p className="text-xs text-muted-foreground">O canal de lote SERPRO ainda não está configurado: use o canal manual até a ND Carretas confirmar o credenciamento (veja Configurações do pedido de venda).</p> : null}

          {mode === "protocol" ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <Field label="Protocolo devolvido pelo portal *"><Input className="w-72" value={protocol} onChange={(event) => setProtocol(event.target.value)} /></Field>
              <Button disabled={Boolean(busy) || !protocol.trim()} onClick={() => void act("manual_submit", { protocol, requestKey: keys.current.manual }, "Envio registrado.", () => { keys.current.manual = newKey(); setProtocol("") })}>Registrar</Button>
              <Button variant="outline" onClick={() => setMode("")}>Voltar</Button>
            </div>
          ) : null}
          {mode === "result" ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Confira o portal antes: a aprovação libera a fabricação. Fica registrado quem informou.</p>
              <div className="flex flex-wrap items-end gap-2">
                <select aria-label="Resultado" className="h-9 rounded-md border bg-background px-2 text-sm" value={result.result} onChange={(event) => setResult({ ...result, result: event.target.value })}>
                  <option value="aprovado">Aprovado</option><option value="exigencia">Exigência</option><option value="rejeitado">Rejeitado</option><option value="processando">Ainda em processamento</option>
                </select>
                <Input className="w-64" placeholder="Mensagem do portal" value={result.message} onChange={(event) => setResult({ ...result, message: event.target.value })} />
              </div>
              {["exigencia", "rejeitado"].includes(result.result) ? <Textarea rows={2} placeholder="Pendências, uma por linha" value={result.pendencies} onChange={(event) => setResult({ ...result, pendencies: event.target.value })} /> : null}
              <div className="flex gap-2">
                <Button disabled={Boolean(busy)} onClick={() => void act("manual_result", { result: result.result, message: result.message, pendencies: result.pendencies.split("\n").map((line) => line.trim()).filter(Boolean), requestKey: keys.current.result }, "Retorno registrado.", () => { keys.current.result = newKey(); setResult({ result: "aprovado", message: "", pendencies: "" }) })}>Registrar retorno</Button>
                <Button variant="outline" onClick={() => setMode("")}>Voltar</Button>
              </div>
            </div>
          ) : null}
          {mode === "cancel" ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <Field label="Motivo do cancelamento *"><Input className="w-72" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
              <Button variant="destructive" disabled={Boolean(busy) || !reason.trim()} onClick={() => void act("cancel", { reason }, "Documentação cancelada. O chassi fica livre.")}>Confirmar</Button>
              <Button variant="outline" onClick={() => setMode("")}>Voltar</Button>
            </div>
          ) : null}

          {actions.finalStage ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <Field label="Documentação final (CRLV, ATPV-e, emplacamento)">
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={doc.final_stage} onChange={(event) => void act("final_stage", { stage: event.target.value, note: doc.final_stage_note || "" }, "Estágio final atualizado.")}>
                  {Object.entries(finalStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <p className="text-xs text-muted-foreground">Etapa posterior à fabricação: não altera a liberação da produção.</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4" />Tentativas e retornos ({detail.attempts.length})</h4>
            {detail.attempts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma tentativa ainda.</p> : (
              <ul className="divide-y rounded-md border text-sm">
                {detail.attempts.map((attempt) => <li key={attempt.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span>#{attempt.attempt_number} · {attempt.kind}{attempt.protocol ? ` · ${attempt.protocol}` : ""} — {outcomeLabel[attempt.outcome] || "em andamento"}{attempt.message ? `: ${attempt.message}` : ""}</span><span className="text-xs text-muted-foreground">{dateBr(attempt.created_at)} · {attempt.actor || "-"}</span></li>)}
              </ul>
            )}
            <h4 className="pt-2 text-sm font-medium">Histórico</h4>
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
              {detail.events.map((event, index) => <li key={index} className="flex flex-wrap justify-between gap-2 px-3 py-1.5"><span>{event.event}: {event.description}</span><span className="text-xs text-muted-foreground">{dateBr(event.created_at)} · {event.actor || "-"}</span></li>)}
            </ul>
            <h4 className="pt-2 text-sm font-medium">Comprovantes e documentos ({detail.files.length})</h4>
            <ul className="space-y-1 text-sm">{detail.files.map((file) => <li key={file.id}><a className="text-primary underline" href={file.file_path} target="_blank" rel="noreferrer">{file.name}</a> <span className="text-xs text-muted-foreground">· {file.kind} · {dateBr(file.created_at)}</span></li>)}</ul>
            <UploadField label="Anexar comprovante ou retorno do portal" value="" accept="application/pdf,image/jpeg,image/png" onChange={(url) => { if (url) void act("attach", { path: url, name: url.split("/").pop() || "Comprovante", kind: "Comprovante" }, "Arquivo anexado.") }} />
          </div>
        </div>
      ) : null}
    </FormSheet>
  )
}
