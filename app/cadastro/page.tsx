"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { PageLayout } from "@/components/page-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Trash2, Frame, Ruler, ImageIcon, Plus, Database } from "lucide-react"
import {
  type FrameCatalogItem,
  type SizeCatalogItem,
  type CanvasCatalogItem,
  formatCurrency,
  getCatalogState,
  makeCatalogId,
  saveCatalogState,
} from "@/lib/catalog-storage"

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function CadastroPage() {
  const [frames, setFrames] = useState<FrameCatalogItem[]>([])
  const [sizes, setSizes] = useState<SizeCatalogItem[]>([])
  const [canvases, setCanvases] = useState<CanvasCatalogItem[]>([])

  const [frameForm, setFrameForm] = useState({
    name: "",
    description: "",
    price: "",
    imageUrl: "",
  })

  const [sizeForm, setSizeForm] = useState({
    name: "",
    height: "",
    width: "",
    price: "",
  })

  const [canvasForm, setCanvasForm] = useState({
    name: "",
    description: "",
    price: "",
  })

  useEffect(() => {
    const state = getCatalogState()
    setFrames(state.frames)
    setSizes(state.sizes)
    setCanvases(state.canvases)
  }, [])

  const persistState = (
    nextFrames: FrameCatalogItem[] = frames,
    nextSizes: SizeCatalogItem[] = sizes,
    nextCanvases: CanvasCatalogItem[] = canvases,
  ) => {
    setFrames(nextFrames)
    setSizes(nextSizes)
    setCanvases(nextCanvases)
    saveCatalogState({
      frames: nextFrames,
      sizes: nextSizes,
      canvases: nextCanvases,
    })
  }

  const totalItems = useMemo(() => frames.length + sizes.length + canvases.length, [frames.length, sizes.length, canvases.length])

  const handleFrameImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const imageUrl = await readFileAsDataUrl(file)
    setFrameForm((prev) => ({ ...prev, imageUrl }))
  }

  const createFrame = () => {
    if (!frameForm.name.trim() || !frameForm.price) return

    const nextFrames = [
      {
        id: makeCatalogId("frame"),
        name: frameForm.name.trim(),
        description: frameForm.description.trim(),
        price: Number(frameForm.price) || 0,
        imageUrl: frameForm.imageUrl,
        createdAt: new Date().toISOString(),
      },
      ...frames,
    ]

    persistState(nextFrames, sizes, canvases)
    setFrameForm({ name: "", description: "", price: "", imageUrl: "" })
  }

  const createSize = () => {
    if (!sizeForm.name.trim() || !sizeForm.height || !sizeForm.width || !sizeForm.price) return

    const nextSizes = [
      {
        id: makeCatalogId("size"),
        name: sizeForm.name.trim(),
        height: Number(sizeForm.height) || 0,
        width: Number(sizeForm.width) || 0,
        price: Number(sizeForm.price) || 0,
        createdAt: new Date().toISOString(),
      },
      ...sizes,
    ]

    persistState(frames, nextSizes, canvases)
    setSizeForm({ name: "", height: "", width: "", price: "" })
  }

  const createCanvas = () => {
    if (!canvasForm.name.trim() || !canvasForm.price) return

    const nextCanvases = [
      {
        id: makeCatalogId("canvas"),
        name: canvasForm.name.trim(),
        description: canvasForm.description.trim(),
        price: Number(canvasForm.price) || 0,
        createdAt: new Date().toISOString(),
      },
      ...canvases,
    ]

    persistState(frames, sizes, nextCanvases)
    setCanvasForm({ name: "", description: "", price: "" })
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cadastro</h1>
            <p className="mt-1 text-muted-foreground">
              Cadastre molduras, tamanhos e telas para montar os produtos com base no que já existe no sistema.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="min-w-[180px]">
              <CardContent className="flex items-center gap-3 p-4">
                <Frame className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Molduras</p>
                  <p className="text-xl font-semibold">{frames.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="min-w-[180px]">
              <CardContent className="flex items-center gap-3 p-4">
                <Ruler className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Tamanhos</p>
                  <p className="text-xl font-semibold">{sizes.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="min-w-[180px]">
              <CardContent className="flex items-center gap-3 p-4">
                <Database className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Itens salvos</p>
                  <p className="text-xl font-semibold">{totalItems}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Tabs defaultValue="molduras" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="molduras">Cadastro de Molduras</TabsTrigger>
            <TabsTrigger value="tamanhos">Cadastro de Altura e Largura</TabsTrigger>
            <TabsTrigger value="telas">Cadastro de Telas</TabsTrigger>
          </TabsList>

          <TabsContent value="molduras" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Novo Tipo de Moldura</CardTitle>
                <CardDescription>Essa estrutura pode virar a tabela `frames` no Supabase depois.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="frameName">Nome da Moldura</Label>
                  <Input id="frameName" value={frameForm.name} onChange={(e) => setFrameForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Madeira Freijó" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="framePrice">Valor</Label>
                  <Input id="framePrice" type="number" value={frameForm.price} onChange={(e) => setFrameForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="0,00" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="frameDescription">Descrição</Label>
                  <Textarea id="frameDescription" value={frameForm.description} onChange={(e) => setFrameForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Acabamento, material, observações..." rows={3} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="frameImage">Foto da Moldura</Label>
                  <Input id="frameImage" type="file" accept="image/*" onChange={handleFrameImage} />
                </div>
                {frameForm.imageUrl ? (
                  <div className="md:col-span-2 overflow-hidden rounded-xl border bg-muted/30 p-3">
                    <div className="relative h-44 w-full overflow-hidden rounded-lg">
                      <Image src={frameForm.imageUrl} alt="Prévia da moldura" fill className="object-cover" unoptimized />
                    </div>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <Button onClick={createFrame} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Salvar Moldura
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {frames.map((item) => (
                <Card key={item.id}>
                  <CardContent className="space-y-4 p-4">
                    {item.imageUrl ? (
                      <div className="relative h-40 overflow-hidden rounded-lg border">
                        <Image src={item.imageUrl} alt={item.name} fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
                        Sem foto
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-sm text-muted-foreground">{item.description || "Sem descrição"}</p>
                      </div>
                      <Badge>{formatCurrency(item.price)}</Badge>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-destructive"
                      onClick={() => persistState(frames.filter((frame) => frame.id !== item.id), sizes, canvases)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="tamanhos" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Novo Tamanho Cadastrado</CardTitle>
                <CardDescription>Essa estrutura pode virar a tabela `sizes` no Supabase depois.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="sizeName">Nome do Tamanho</Label>
                  <Input id="sizeName" value={sizeForm.name} onChange={(e) => setSizeForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Quadro 80x120" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sizeHeight">Altura</Label>
                  <Input id="sizeHeight" type="number" value={sizeForm.height} onChange={(e) => setSizeForm((prev) => ({ ...prev, height: e.target.value }))} placeholder="120" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sizeWidth">Largura</Label>
                  <Input id="sizeWidth" type="number" value={sizeForm.width} onChange={(e) => setSizeForm((prev) => ({ ...prev, width: e.target.value }))} placeholder="80" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="sizePrice">Valor</Label>
                  <Input id="sizePrice" type="number" value={sizeForm.price} onChange={(e) => setSizeForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="0,00" />
                </div>
                <div className="md:col-span-2">
                  <Button onClick={createSize} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Salvar Tamanho
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sizes.map((item) => (
                <Card key={item.id}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.height} x {item.width}
                        </p>
                      </div>
                      <Badge>{formatCurrency(item.price)}</Badge>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-destructive"
                      onClick={() => persistState(frames, sizes.filter((size) => size.id !== item.id), canvases)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="telas" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Novo Tipo de Tela</CardTitle>
                <CardDescription>Essa estrutura pode virar a tabela `canvases` no Supabase depois.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="canvasName">Nome da Tela</Label>
                  <Input id="canvasName" value={canvasForm.name} onChange={(e) => setCanvasForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ex: Canvas Premium Fosco" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="canvasPrice">Valor</Label>
                  <Input id="canvasPrice" type="number" value={canvasForm.price} onChange={(e) => setCanvasForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="0,00" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="canvasDescription">Descrição</Label>
                  <Textarea id="canvasDescription" value={canvasForm.description} onChange={(e) => setCanvasForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Material, acabamento, textura..." rows={3} />
                </div>
                <div className="md:col-span-2">
                  <Button onClick={createCanvas} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Salvar Tela
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {canvases.map((item) => (
                <Card key={item.id}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-sm text-muted-foreground">{item.description || "Sem descrição"}</p>
                      </div>
                      <Badge>{formatCurrency(item.price)}</Badge>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-destructive"
                      onClick={() => persistState(frames, sizes, canvases.filter((canvas) => canvas.id !== item.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  )
}
