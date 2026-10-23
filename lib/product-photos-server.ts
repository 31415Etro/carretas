import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"

type Admin = ReturnType<typeof createAdminClient>
export const PHOTO_BUCKET = "product-photos"
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024
const PHOTO_MAX_SIDE = 2400
export const PHOTO_MIGRATION_HINT = "As fotografias persistentes ainda não estão instaladas no banco. Rode o script 226 no SQL Editor do Supabase (primeiro no staging)."

export class PhotoError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}
export function photoError(error: unknown, fallback = "Erro ao processar a fotografia.") {
  if (error instanceof PhotoError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (/Could not find the function|schema cache|product_photo/i.test(message) && /function|schema cache|relation/i.test(message)) return new PhotoError(PHOTO_MIGRATION_HINT, 503)
  if (/não encontrad/i.test(message)) return new PhotoError(message, 404)
  return new PhotoError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

/** Tipo REAL da imagem pelos primeiros bytes (a extensão e o tipo informado pelo navegador não valem como prova). */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp"
  return null
}

async function ensureBucket(admin: Admin) {
  const { data } = await admin.storage.getBucket(PHOTO_BUCKET)
  if (data) return
  const { error } = await admin.storage.createBucket(PHOTO_BUCKET, { public: false, fileSizeLimit: PHOTO_MAX_BYTES, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] })
  if (error && !/already exists/i.test(error.message)) throw new PhotoError(`Não foi possível preparar o armazenamento das fotografias: ${error.message}`)
}

/** Existe de fato no armazenamento? (consulta a pasta, sem baixar o arquivo) */
async function existsInStorage(admin: Admin, bucket: string, path: string) {
  const slash = path.lastIndexOf("/")
  const folder = slash >= 0 ? path.slice(0, slash) : ""
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 20, search: name })
  if (error) return { ok: false as const, note: `Armazenamento recusou a consulta: ${error.message}` }
  return data?.some((entry) => entry.name === name) ? { ok: true as const, note: "Arquivo encontrado no armazenamento." } : { ok: false as const, note: "O arquivo não existe no armazenamento." }
}

export async function listPhotos(admin: Admin, materialId: string) {
  return rpc<Array<Record<string, any>>>(admin, "product_photo_list", { p_material: materialId })
}

/**
 * Fluxo do envio: valida (tamanho, tipo REAL, decodifica) -> ajusta (orientação e tamanho) -> envia ao armazenamento privado ->
 * CONFIRMA que o arquivo existe -> só então grava o caminho definitivo no cadastro. Se o cadastro falhar, o arquivo enviado é removido.
 */
export async function uploadPhoto(admin: Admin, materialId: string, file: File, options: { purpose?: string; caption?: string; makeMain?: boolean }, user: string) {
  if (file.size === 0) throw new PhotoError("O arquivo está vazio.")
  if (file.size > PHOTO_MAX_BYTES) throw new PhotoError("A fotografia passa de 15 MB.")
  const original = new Uint8Array(await file.arrayBuffer())
  const kind = sniffImage(original)
  if (!kind) throw new PhotoError("O arquivo não é uma imagem JPG, PNG ou WEBP válida.")
  const sharp = (await import("sharp")).default
  let bytes: Buffer
  let mime: string
  try {
    const pipeline = sharp(Buffer.from(original), { failOn: "error" }).rotate().resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    if (kind === "image/png") { bytes = await pipeline.png({ compressionLevel: 9 }).toBuffer(); mime = "image/png" } else { bytes = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer(); mime = "image/jpeg" }
  } catch {
    throw new PhotoError("A imagem está corrompida e não pôde ser lida.")
  }
  await ensureBucket(admin)
  const path = `${materialId}/${randomUUID()}.${mime === "image/png" ? "png" : "jpg"}`
  const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (uploadError) throw new PhotoError(`O envio ao armazenamento falhou: ${uploadError.message}`)
  const check = await existsInStorage(admin, PHOTO_BUCKET, path)
  if (!check.ok) throw new PhotoError("O envio não pôde ser confirmado no armazenamento: tente novamente.")
  try {
    return await rpc<{ id: string; url: string; is_main: boolean }>(admin, "product_photo_add", {
      p: { material_id: materialId, bucket: PHOTO_BUCKET, path, mime_type: mime, size_bytes: bytes.length, original_name: file.name.slice(0, 120), purpose: options.purpose || "comercial", caption: options.caption || null, make_main: Boolean(options.makeMain) },
      p_user: user,
    })
  } catch (error) {
    await admin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined)
    throw error
  }
}

export const setMainPhoto = (admin: Admin, photoId: string, user: string) => rpc(admin, "product_photo_set_main", { p_photo: photoId, p_user: user })
export const reorderPhotos = (admin: Admin, materialId: string, ids: string[]) => rpc(admin, "product_photo_reorder", { p_material: materialId, p_ids: ids })
export const updatePhoto = (admin: Admin, photoId: string, data: { caption?: string; purpose?: string }) => rpc(admin, "product_photo_update", { p_photo: photoId, p: data })
export const removePhoto = (admin: Admin, photoId: string, reason: string, user: string) => rpc(admin, "product_photo_remove", { p_photo: photoId, p_reason: reason, p_user: user })

/** Bytes de uma fotografia pelo registro (nunca por URL guardada): arquivo do armazenamento ou, para registro antigo, o endereço antigo. */
export async function readPhoto(admin: Admin, photoId: string) {
  const { data: row } = await admin.from("product_photos").select("id,bucket,path,legacy_url,mime_type,status").eq("id", photoId).maybeSingle()
  if (!row || row.status === "Removida") throw new PhotoError("Fotografia não encontrada.", 404)
  if (row.path && row.bucket) {
    const { data, error } = await admin.storage.from(row.bucket).download(row.path)
    if (error || !data) throw new PhotoError("O arquivo da fotografia não está no armazenamento.", 404)
    const bytes = Buffer.from(await data.arrayBuffer())
    return { bytes, type: sniffImage(bytes) || row.mime_type || "image/jpeg", row }
  }
  throw new PhotoError("Fotografia sem arquivo no armazenamento: substitua-a.", 404)
}

/** Fotografia que entra num documento do pedido: a escolhida (do mesmo produto) ou a principal. Devolve o motivo quando não há. */
export async function photoForDocument(admin: Admin, materialId: string, photoId?: string | null) {
  const row = await rpc<Record<string, any> | null>(admin, "product_photo_for_document", { p_material: materialId, p_photo: photoId || null }).catch(() => null)
  if (!row) return { ref: null as null | { id: string; bucket: string; path: string }, bytes: null as Buffer | null, type: "image/jpeg", problem: "O produto não tem fotografia principal disponível: cadastre uma em Produtos > Fotografias." }
  try {
    const { data, error } = await admin.storage.from(row.bucket).download(row.path)
    if (error || !data) return { ref: { id: row.id, bucket: row.bucket, path: row.path }, bytes: null, type: "image/jpeg", problem: "O arquivo da fotografia principal não está no armazenamento: substitua-a no cadastro do produto." }
    const bytes = Buffer.from(await data.arrayBuffer())
    return { ref: { id: row.id as string, bucket: row.bucket as string, path: row.path as string }, bytes, type: sniffImage(bytes) || "image/jpeg", problem: "" }
  } catch {
    return { ref: { id: row.id, bucket: row.bucket, path: row.path }, bytes: null, type: "image/jpeg", problem: "Não foi possível ler a fotografia principal." }
  }
}

/**
 * Auditoria das fotografias antigas. "catalogar" cria os registros de auditoria (não muda o cadastro); "verificar" confere cada arquivo no armazenamento e marca
 * Disponível/Indisponível. Nada é apagado e nenhuma imagem é substituída.
 */
export async function auditPhotos(admin: Admin, mode: "catalogar" | "verificar", user: string) {
  const summary: Record<string, any> = { mode }
  if (mode === "catalogar") {
    summary.catalogued = (await rpc<{ catalogued: number }>(admin, "product_photos_backfill_legacy")).catalogued
  }
  const { data: pending } = await admin.from("product_photos").select("id,material_id,bucket,path,legacy_url").eq("status", "Pendente de verificacao").limit(500)
  const results: Array<{ id: string; ok: boolean; note: string }> = []
  if (mode === "verificar") {
    for (const row of pending || []) {
      let check: { ok: boolean; note: string }
      if (row.bucket && row.path) {
        check = await existsInStorage(admin, row.bucket, row.path)
      } else if (row.legacy_url && /^https?:\/\//i.test(row.legacy_url)) {
        try {
          const response = await fetch(row.legacy_url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(8000) })
          const type = (response.headers.get("content-type") || "").split(";")[0]
          check = response.ok && type.startsWith("image/") ? { ok: true, note: "Endereço externo abre como imagem." } : { ok: false, note: `Endereço externo não abre (HTTP ${response.status}).` }
        } catch { check = { ok: false, note: "Endereço externo inacessível." } }
      } else check = { ok: false, note: "Sem arquivo no armazenamento." }
      const stored = Boolean(row.bucket && row.path)
      if (check.ok && !stored) {
        // endereço externo que ainda abre: continua como está (não some da tela); o relatório sugere reenviar para guardá-la no sistema
        results.push({ id: row.id, ok: true, note: `${check.note} Reenvie a fotografia para guardá-la no armazenamento do sistema.` })
        continue
      }
      await rpc(admin, "product_photo_mark", { p_photo: row.id, p_status: check.ok ? "Disponivel" : "Indisponivel", p_note: check.note })
      results.push({ id: row.id, ok: check.ok, note: check.note })
    }
  }
  const { data: all } = await admin.from("product_photos").select("status")
  const counts: Record<string, number> = {}
  for (const row of all || []) counts[row.status] = (counts[row.status] || 0) + 1
  return { ...summary, checked: results.length, available: results.filter((r) => r.ok).length, unavailable: results.filter((r) => !r.ok).length, counts, by: user }
}
