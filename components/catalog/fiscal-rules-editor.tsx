"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SelectField, TextField } from "@/components/operations/shared"
import { useToast } from "@/hooks/use-toast"
import { fiscalOperations, taxRegimes, validateFiscalRules, type FiscalRule } from "@/lib/fiscal-rules"

const emptyRule: FiscalRule = { operation: "Venda dentro do estado", taxRegime: "Todos", cfop: "", cstCsosn: "", ibsCbsCst: "", ibsCbsClass: "", validFrom: "", validTo: "", notes: "" }

/** CFOP, CST/CSOSN e IBS/CBS por operação, regime e vigência (salvo separado do cadastro). */
export function FiscalRulesEditor({ materialId }: { materialId: string }) {
  const { toast } = useToast()
  const [rules, setRules] = useState<FiscalRule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch(`/api/catalog/fiscal-rules?materialId=${materialId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
        setRules(payload.rules)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar regras."))
      .finally(() => setLoaded(true))
  }, [materialId])

  function update(index: number, patch: Partial<FiscalRule>) {
    setRules((current) => current.map((rule, position) => position === index ? { ...rule, ...patch } : rule))
    setDirty(true)
  }

  async function save() {
    const invalid = validateFiscalRules(rules)
    if (invalid) return toast({ title: "Revise as regras fiscais", description: invalid, variant: "destructive" })
    setSaving(true)
    try {
      const response = await fetch("/api/catalog/fiscal-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId, rules }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setDirty(false)
      toast({ title: "Regras fiscais salvas", description: `${rules.length} regra(s).` })
    } catch (reason) {
      toast({ title: "Regras não salvas", description: reason instanceof Error ? reason.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Regras fiscais por operação</p>
          <p className="text-xs text-muted-foreground">CFOP e CST/CSOSN variam por operação, destinatário e regime. Cadastre uma regra por situação, com vigência, inclusive IBS/CBS da reforma tributária.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => { setRules((current) => [...current, { ...emptyRule }]); setDirty(true) }}><Plus className="h-4 w-4" />Regra</Button>
      </div>
      {error ? <p className="text-sm text-amber-700">{error}</p> : null}
      {loaded && !rules.length && !error ? <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada.</p> : null}
      {rules.map((rule, index) => (
        <div key={index} className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-4">
          <div className="md:col-span-2"><SelectField label="Operação" value={rule.operation} onChange={(value) => update(index, { operation: value })} options={fiscalOperations.map((item) => ({ value: item.value, label: item.value }))} /></div>
          <SelectField label="Regime tributário" value={rule.taxRegime} onChange={(value) => update(index, { taxRegime: value })} options={taxRegimes.map((value) => ({ value, label: value }))} />
          <TextField label="CFOP" value={rule.cfop} onChange={(value) => update(index, { cfop: value })} placeholder="Ex.: 5102" />
          <TextField label={rule.taxRegime === "Simples Nacional" || rule.taxRegime === "MEI" ? "CSOSN" : "CST ICMS"} value={rule.cstCsosn} onChange={(value) => update(index, { cstCsosn: value })} />
          <TextField label="CST IBS/CBS" value={rule.ibsCbsCst} onChange={(value) => update(index, { ibsCbsCst: value })} placeholder="3 dígitos" />
          <TextField label="Classificação IBS/CBS (cClassTrib)" value={rule.ibsCbsClass} onChange={(value) => update(index, { ibsCbsClass: value })} placeholder="6 dígitos" />
          <div className="flex items-end justify-end"><Button type="button" size="icon" variant="ghost" title="Remover regra" onClick={() => { setRules((current) => current.filter((_, position) => position !== index)); setDirty(true) }}><Trash2 className="h-4 w-4" /></Button></div>
          <TextField label="Vigência a partir de" type="date" value={rule.validFrom} onChange={(value) => update(index, { validFrom: value })} />
          <TextField label="Vigência até" type="date" value={rule.validTo} onChange={(value) => update(index, { validTo: value })} />
          <div className="md:col-span-2"><TextField label="Observação / fundamento" value={rule.notes} onChange={(value) => update(index, { notes: value })} /></div>
        </div>
      ))}
      {dirty ? <Button type="button" size="sm" disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar regras fiscais"}</Button> : null}
    </div>
  )
}
