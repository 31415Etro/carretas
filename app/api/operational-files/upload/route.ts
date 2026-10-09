import { NextResponse } from "next/server"
import { createAdminClient, createAdminClientForServiceOrder, createServerClient } from "@/lib/supabase/server"

const BUCKET = "service-order-files"
const MAX_FILE_SIZE = 30 * 1024 * 1024
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
const PHOTO_CATEGORIES = ["Foto Inicial", "Foto Final", "Foto Adicional 1", "Foto Adicional 2", "Foto Adicional 3"]

class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function safeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo"
}

async function authorizedAdmin(serviceOrderId: string, write = false) {
  const session = await createServerClient()
  const { data: { user } } = await session.auth.getUser()
  const resolved = await createAdminClientForServiceOrder(serviceOrderId)
  const admin = resolved.client
  const { data: order, error: orderError } = await admin.from("service_orders").select("id,client_id").eq("id", serviceOrderId).maybeSingle()
  if (orderError) throw orderError
  if (!resolved.exists || !order) throw new RequestError("OS nao encontrada no banco de dados.", 404)
  if (!user) throw new RequestError("Nao autenticado.", 401)

  const { data: profile, error: profileError } = await admin.from("profiles").select("role,client_id,active").eq("id", user.id).maybeSingle()
  if (profileError) throw profileError
  if (!profile || profile.active === false) throw new RequestError("Usuario inativo ou sem perfil.", 403)
  if (profile.role === "client") {
    if (!profile.client_id || profile.client_id !== order.client_id) throw new RequestError("Acesso negado a esta OS.", 403)
    if (write) throw new RequestError("Usuarios clientes podem consultar, mas nao alterar as fotos da OS.", 403)
  }
  return admin
}

function normalizeImageType(fileName: string, fileType: string) {
  const normalized = fileType.toLowerCase()
  if (IMAGE_TYPES.includes(normalized)) return normalized
  const extension = fileName.split(".").pop()?.toLowerCase()
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  if (extension === "heic") return "image/heic"
  if (extension === "heif") return "image/heif"
  return normalized
}

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET)
  const options = {
    public: true,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: IMAGE_TYPES,
  }
  const { error } = data
    ? await supabase.storage.updateBucket(BUCKET, options)
    : await supabase.storage.createBucket(BUCKET, options)
  if (error && !String(error.message || "").toLowerCase().includes("already exists")) throw error
}

function fileResponse(data: any) {
  return {
    id: data.id,
    serviceOrderId: data.service_order_id,
    category: data.category,
    fileName: data.file_name || "",
    fileUrl: data.file_url || "",
    fileType: data.file_type || "image",
    uploadedBy: data.uploaded_by || "",
    notes: data.notes || "",
    createdAt: data.created_at,
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const serviceOrderId = String(url.searchParams.get("serviceOrderId") || "")
    const category = String(url.searchParams.get("category") || "")
    if (!isUuid(serviceOrderId)) return NextResponse.json({ error: "OS invalida." }, { status: 400 })
    if (category && !PHOTO_CATEGORIES.includes(category)) return NextResponse.json({ error: "Categoria de foto invalida." }, { status: 400 })

    const supabase = await authorizedAdmin(serviceOrderId)
    if (!category) {
      const { data, error } = await supabase
        .from("service_order_files")
        .select("*")
        .eq("service_order_id", serviceOrderId)
        .in("category", PHOTO_CATEGORIES)
        .order("created_at", { ascending: false })
      if (error) throw error
      return NextResponse.json({ files: (data || []).map(fileResponse) })
    }

    let query = supabase
      .from("service_order_files")
      .select("*")
      .eq("service_order_id", serviceOrderId)
      .eq("category", category)
      .order("created_at", { ascending: false })
      .limit(1)
    query = query.or("notes.is.null,notes.eq.")
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return NextResponse.json({ file: data ? fileResponse(data) : null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao consultar foto."
    return NextResponse.json({ error: message }, { status: error instanceof RequestError ? error.status : 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const input = await request.json()
      const action = String(input.action || "")
      const serviceOrderId = String(input.serviceOrderId || "")
      const category = String(input.category || "")
      const uploadedBy = String(input.uploadedBy || "")
      const keepPrevious = input.keepPrevious === true
      const notes = ""
      const fileName = safeName(String(input.fileName || "foto"))
      const fileType = normalizeImageType(fileName, String(input.fileType || ""))
      const fileSize = Number(input.fileSize || 0)

      if (!isUuid(serviceOrderId)) return NextResponse.json({ error: "OS invalida." }, { status: 400 })
      if (!PHOTO_CATEGORIES.includes(category)) return NextResponse.json({ error: "Categoria de foto invalida." }, { status: 400 })

      const supabase = await authorizedAdmin(serviceOrderId, true)

      if (action === "prepare") {
        if (!IMAGE_TYPES.includes(fileType)) return NextResponse.json({ error: "Envie uma imagem JPG, PNG, WEBP, HEIC ou HEIF." }, { status: 400 })
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
          return NextResponse.json({ error: "A foto deve ter no maximo 30 MB." }, { status: 400 })
        }
        await ensureBucket(supabase)
        const id = crypto.randomUUID()
        const storagePath = `${serviceOrderId}/${id}-${fileName}`
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath)
        if (error || !data?.token) throw error || new Error("Nao foi possivel autorizar o envio da foto.")
        return NextResponse.json({ upload: { id, storagePath, fileName, fileType, token: data.token } })
      }

      if (action === "finalize") {
        const id = String(input.id || "")
        const storagePath = String(input.storagePath || "")
        const expectedPath = `${serviceOrderId}/${id}-${fileName}`
        if (!isUuid(id) || storagePath !== expectedPath || !IMAGE_TYPES.includes(fileType)) {
          return NextResponse.json({ error: "Dados do upload da foto sao invalidos." }, { status: 400 })
        }
        let storageConfirmed = false
        for (const delay of [0, 250, 600, 1200]) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
          const { data: storedFiles, error: listError } = await supabase.storage.from(BUCKET).list(serviceOrderId, {
            search: `${id}-${fileName}`,
            limit: 10,
          })
          if (listError) throw listError
          storageConfirmed = (storedFiles || []).some((file) => file.name === `${id}-${fileName}`)
          if (storageConfirmed) break
        }
        if (!storageConfirmed) return NextResponse.json({ error: "A foto nao foi encontrada no Storage. Envie novamente." }, { status: 409 })

        const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
        const row = {
          id,
          service_order_id: serviceOrderId,
          category,
          file_url: publicUrlData.publicUrl,
          file_name: fileName,
          file_type: fileType,
          uploaded_by: isUuid(uploadedBy) ? uploadedBy : null,
          notes,
        }
        const { data, error } = await supabase.from("service_order_files").insert(row).select("*").single()
        if (error) throw error

        if (!keepPrevious) {
          const { data: previousFiles, error: previousError } = await supabase
            .from("service_order_files")
            .select("id,file_url")
            .eq("service_order_id", serviceOrderId)
            .eq("category", category)
            .eq("notes", notes)
            .neq("id", id)
          if (previousError) throw previousError
          if (previousFiles?.length) {
            const previousIds = previousFiles.map((file) => file.id)
            const { error: deleteError } = await supabase.from("service_order_files").delete().in("id", previousIds)
            if (deleteError) throw deleteError
            const storagePrefix = `/storage/v1/object/public/${BUCKET}/`
            const previousPaths = previousFiles
              .map((file) => {
                const value = String(file.file_url || "")
                const index = value.indexOf(storagePrefix)
                return index >= 0 ? decodeURIComponent(value.slice(index + storagePrefix.length)) : ""
              })
              .filter(Boolean)
            if (previousPaths.length) await supabase.storage.from(BUCKET).remove(previousPaths)
          }
        }

        return NextResponse.json({ file: fileResponse(data) })
      }

      return NextResponse.json({ error: "Acao de upload invalida." }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const serviceOrderId = String(formData.get("serviceOrderId") || "")
    const category = String(formData.get("category") || "")
    const uploadedBy = String(formData.get("uploadedBy") || "")
    const keepPrevious = String(formData.get("keepPrevious") || "") === "true"
    const notes = ""

    if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo nao informado." }, { status: 400 })
    if (!serviceOrderId) return NextResponse.json({ error: "OS nao informada." }, { status: 400 })
    if (!PHOTO_CATEGORIES.includes(category)) return NextResponse.json({ error: "Categoria de foto invalida." }, { status: 400 })

    const fileName = safeName(file.name)
    const fileType = normalizeImageType(fileName, file.type || "")
    if (!IMAGE_TYPES.includes(fileType)) return NextResponse.json({ error: "Envie uma imagem JPG, PNG, WEBP, HEIC ou HEIF." }, { status: 400 })
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "A foto deve ter no maximo 30 MB." }, { status: 400 })

    const supabase = await authorizedAdmin(serviceOrderId, true)
    await ensureBucket(supabase)

    const id = crypto.randomUUID()
    const path = `${serviceOrderId}/${id}-${fileName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: fileType,
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const fileUrl = publicUrlData.publicUrl

    if (!keepPrevious) {
      await supabase
        .from("service_order_files")
        .delete()
        .eq("service_order_id", serviceOrderId)
        .eq("category", category)
        .eq("notes", notes)
    }

    const row = {
      id,
      service_order_id: serviceOrderId,
      category,
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      uploaded_by: isUuid(uploadedBy) ? uploadedBy : null,
      notes,
    }

    const { data, error } = await supabase.from("service_order_files").insert(row).select("*").single()
    if (error) {
      const message = String(error.message || "")
      if (message.includes("idx_service_order_files_one_per_os") || message.includes("service_order_files_category_final_check")) {
        return NextResponse.json({
          error: "O banco ainda esta com a regra antiga de fotos. Atualize a estrutura de service_order_files para permitir Foto Inicial e Foto Final por OS.",
        }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({
      file: {
        id: data.id,
        serviceOrderId: data.service_order_id,
        category: data.category,
        fileName: data.file_name || fileName,
        fileUrl: data.file_url || fileUrl,
        fileType: data.file_type || fileType,
        uploadedBy: data.uploaded_by || "",
        notes: data.notes || "",
        createdAt: data.created_at,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar arquivo."
    return NextResponse.json({ error: message }, { status: error instanceof RequestError ? error.status : 500 })
  }
}
