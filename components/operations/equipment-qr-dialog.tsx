"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Download, Printer, QrCode } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { equipmentCode } from "@/lib/equipment-public"
import type { ClientEquipment } from "@/lib/operational-storage"

export function EquipmentQrDialog({ equipment }: { equipment: ClientEquipment }) {
  const [open, setOpen] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [publicUrl, setPublicUrl] = useState("")
  const [copied, setCopied] = useState(false)
  const code = equipmentCode(equipment)

  useEffect(() => {
    if (!open) return
    const url = `${window.location.origin}/equipamento/${equipment.id}`
    setPublicUrl(url)
    void QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: "H", color: { dark: "#111827", light: "#ffffff" } })
      .then(setQrDataUrl)
  }, [equipment.id, open])

  function downloadQr() {
    if (!qrDataUrl) return
    const link = document.createElement("a")
    link.href = qrDataUrl
    link.download = `QR-${code.replace(/[^a-z0-9_-]+/gi, "-")}.png`
    link.click()
  }

  function printQr() {
    if (!qrDataUrl) return
    const printWindow = window.open("", "_blank", "width=560,height=720")
    if (!printWindow) return
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character)
    const details = [equipment.brand, equipment.model, equipment.capacity].filter(Boolean).join(" | ")
    printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR ${escapeHtml(code)}</title><style>body{font-family:Arial,sans-serif;margin:0;padding:32px;text-align:center;color:#111827}img{width:360px;max-width:100%}h1{font-size:24px;margin:16px 0 6px}p{margin:4px 0;color:#4b5563}.code{font-size:20px;font-weight:700;color:#111827}@media print{body{padding:0}}</style></head><body><img src="${qrDataUrl}" alt="QR Code"><h1>${escapeHtml(equipment.name)}</h1><p class="code">${escapeHtml(code)}</p><p>${escapeHtml(details)}</p><script>window.onload=()=>window.print()</script></body></html>`)
    printWindow.document.close()
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" title="QR Code do equipamento"><QrCode className="h-4 w-4" />QR</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>QR Code do equipamento</DialogTitle><DialogDescription>{equipment.name}</DialogDescription></DialogHeader>
        <div className="grid justify-items-center gap-3 py-2 text-center">
          <div className="aspect-square w-full max-w-[300px] border bg-white p-3">
            {qrDataUrl ? <img className="h-full w-full" src={qrDataUrl} alt={`QR Code do equipamento ${code}`} /> : null}
          </div>
          <div><p className="text-xs font-medium uppercase text-muted-foreground">Código do equipamento</p><p className="mt-1 font-mono text-xl font-semibold">{code}</p></div>
          <p className="max-w-full break-all text-xs text-muted-foreground">{publicUrl}</p>
        </div>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={copyLink}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copiado" : "Copiar link"}</Button>
          <Button variant="outline" onClick={downloadQr} disabled={!qrDataUrl}><Download className="h-4 w-4" />Baixar</Button>
          <Button onClick={printQr} disabled={!qrDataUrl}><Printer className="h-4 w-4" />Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
