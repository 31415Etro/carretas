"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"

/** Área para o cliente assinar com o dedo/mouse. Entrega PNG em data URL. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = 2.5
    context.lineCap = "round"
    context.strokeStyle = "#111827"
  }, [])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height }
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    drawing.current = true
    canvasRef.current!.setPointerCapture(event.pointerId)
    const { x, y } = point(event)
    context.beginPath()
    context.moveTo(x, y)
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
    dirty.current = true
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    if (dirty.current) onChange(canvasRef.current!.toDataURL("image/png"))
  }

  function clear() {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    dirty.current = false
    onChange("")
  }

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} width={600} height={180} className="h-[140px] w-full touch-none rounded-md border bg-white" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <Button type="button" size="sm" variant="outline" onClick={clear}>Limpar assinatura</Button>
    </div>
  )
}
