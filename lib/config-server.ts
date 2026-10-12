import type { createAdminClient } from "@/lib/supabase/server"
import { audit } from "@/lib/audit"
import { asaasConfigurationStatus } from "@/lib/asaas"
import { canSeeDocument, certificateStatus, defaultsFor, normalizeSection, settingSections, validateBranch, validateCompany, validateNature, validatePriceTable, validateQuoteTemplate, validateUserAccess, type CompanyInput } from "@/lib/config"
import { formatCnpj } from "@/lib/system-company"
import { currentUserRole } from "@/lib/server-authorization"
import { encryptSecret, secretsConfigured } from "@/lib/secrets"
import { readAllPages } from "@/lib/supabase-pagination"
import { createAdminClient as makeAdmin } from "@/lib/supabase/server"

type Admin = ReturnType<typeof createAdminClient>

export const CONFIG_MIGRATION_HINT = "Configurações ampliadas ainda não instaladas no banco. Rode scripts/214_configuracoes.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string): never => { throw new Error(message) }
const text = (value: unknown) => String(value ?? "").trim()
const num = (value: unknown) => Number(String(value ?? "").replace(",", ".")) || 0
const today = () => new Date().toISOString().slice(0, 10)

export function configError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: CONFIG_MIGRATION_HINT, status: 503 }
  if (/duplicate key/.test(message)) return { message: /cnpj/i.test(message) ? "Já existe empresa com este CNPJ." : "Já existe um registro com esses dados.", status: 400 }
  if (/violates foreign key/.test(message)) return { message: "Registro em uso por outros dados: inative em vez de excluir.", status: 400 }
  return { message, status: 400 }
}

/** Configurações são exclusivas de administradores (exceto documentos, filtrados por visibilidade). */
export async function configAccess(options: { allowStaff?: boolean } = {}) {
  const { user, role } = await currentUserRole()
  if (!user) return { error: "Nao autenticado.", status: 401 } as const
  if (role !== "admin" && !(options.allowStaff && role !== "client")) {
    await audit({ module: "acesso", action: "Acesso negado", description: "Tentativa de usar as configurações do sistema sem ser administrador.", result: "Negado", actorId: user.id, actorEmail: user.email || "" })
    return { error: "Acesso exclusivo para administradores.", status: 403 } as const
  }
  return { user, role, admin: makeAdmin(), root: makeAdmin({ bypassCompanyScope: true }) } as const
}

// ---------------- Empresas

const companyView = (row: any) => ({
  id: row.id, name: row.name, legalName: row.legal_name || "", tradeName: row.trade_name || "", cnpj: row.cnpj || "", stateRegistration: row.state_registration || "", municipalRegistration: row.municipal_registration || "",
  taxRegime: row.tax_regime || "", cnae: row.cnae || "", zipCode: row.zip_code || "", street: row.street || "", number: row.number || "", complement: row.complement || "", district: row.district || "", city: row.city || "",
  state: row.state || "", phone: row.phone || "", email: row.email || "", hasLogo: Boolean(row.logo_path), fiscalEnvironment: row.fiscal_environment || "Homologação", nfeSeries: row.nfe_series || "",
  nfeNextNumber: Number(row.nfe_next_number || 0), nfseSeries: row.nfse_series || "", nfseNextNumber: Number(row.nfse_next_number || 0), fiscalNotes: row.fiscal_notes || "",
  certificate: { name: row.certificate_name || "", expiresAt: row.certificate_expires_at || "", hasPassword: Boolean(row.certificate_password_enc), hasFile: Boolean(row.certificate_path), status: certificateStatus(row.certificate_expires_at || "", today()) },
  active: row.active !== false, isDefault: row.is_default === true,
})

export async function listCompanies(root: Admin) {
  const { data, error } = await root.from("system_companies").select("*").order("is_default", { ascending: false }).order("name")
  if (error) throw error
  return (data || []).map(companyView)
}

export async function saveCompany(root: Admin, input: Record<string, any>, actor: { id: string; email: string }) {
  const data: CompanyInput = {
    legalName: text(input.legalName), tradeName: text(input.tradeName), cnpj: text(input.cnpj), stateRegistration: text(input.stateRegistration), municipalRegistration: text(input.municipalRegistration), taxRegime: text(input.taxRegime),
    cnae: text(input.cnae), zipCode: text(input.zipCode), street: text(input.street), number: text(input.number), district: text(input.district), city: text(input.city), state: text(input.state).toUpperCase(), phone: text(input.phone),
    email: text(input.email), fiscalEnvironment: text(input.fiscalEnvironment) || "Homologação", nfeSeries: text(input.nfeSeries), nfeNextNumber: Math.round(num(input.nfeNextNumber)), nfseSeries: text(input.nfseSeries),
    nfseNextNumber: Math.round(num(input.nfseNextNumber)), certificateExpiresAt: text(input.certificateExpiresAt), active: input.active !== false,
  }
  const invalid = validateCompany(data)
  if (invalid) fail(invalid)
  if (input.id && data.active === false) {
    const { data: current } = await root.from("system_companies").select("is_default").eq("id", input.id).maybeSingle()
    if (current?.is_default) fail("A empresa principal não pode ser desativada.")
  }
  if (input.isDefault) await root.from("system_companies").update({ is_default: false }).neq("id", input.id || "00000000-0000-0000-0000-000000000000")
  const row = {
    ...(input.id ? { id: input.id } : {}), name: data.tradeName || data.legalName, legal_name: data.legalName, trade_name: data.tradeName || data.legalName, cnpj: formatCnpj(data.cnpj), state_registration: data.stateRegistration || null,
    municipal_registration: data.municipalRegistration || null, tax_regime: data.taxRegime, cnae: data.cnae.replace(/\D/g, "") || null, zip_code: data.zipCode.replace(/\D/g, ""), street: data.street, number: data.number,
    complement: text(input.complement) || null, district: data.district, city: data.city, state: data.state, address: `${data.street}, ${data.number} - ${data.district}, ${data.city}/${data.state}`, phone: data.phone || null, email: data.email,
    fiscal_environment: data.fiscalEnvironment, nfe_series: data.nfeSeries || null, nfe_next_number: data.nfeSeries ? data.nfeNextNumber : null, nfse_series: data.nfseSeries || null, nfse_next_number: data.nfseSeries ? data.nfseNextNumber : null,
    fiscal_notes: text(input.fiscalNotes) || null, certificate_expires_at: data.certificateExpiresAt || null, active: data.active, is_default: Boolean(input.isDefault), updated_at: new Date().toISOString(),
  }
  const { data: saved, error } = await root.from("system_companies").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  await audit({ module: "configuracoes", action: input.id ? "Alteração de configuração" : "Criação", description: `${input.id ? "Atualizou" : "Cadastrou"} a empresa ${row.trade_name} (${row.cnpj}).`, recordId: saved.id, tableName: "system_companies", actorId: actor.id, actorEmail: actor.email, companyId: saved.id })
  return companyView(saved)
}

/** Guarda o certificado digital (arquivo em bucket privado) e a senha cifrada; a senha nunca volta para a tela. */
export async function saveCertificate(root: Admin, companyId: string, input: { file: File; password: string; expiresAt: string }, actor: { id: string; email: string }) {
  if (!/\.(pfx|p12)$/i.test(input.file.name)) fail("O certificado deve ser um arquivo .pfx ou .p12.")
  if (input.file.size > 2 * 1024 * 1024) fail("Arquivo de certificado acima de 2 MB.")
  if (!text(input.password)) fail("Informe a senha do certificado.")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt) || input.expiresAt < today()) fail("Informe a validade do certificado (data futura).")
  if (!secretsConfigured()) fail("Defina CONFIG_ENCRYPTION_KEY no servidor para guardar a senha do certificado com segurança.")
  const path = `certificados/${companyId}-${Date.now()}.pfx`
  const { error: uploadError } = await root.storage.from("company-files").upload(path, Buffer.from(await input.file.arrayBuffer()), { contentType: "application/x-pkcs12", upsert: false })
  if (uploadError) fail(/bucket/i.test(uploadError.message) ? "Rode scripts/214_configuracoes.sql para criar o armazenamento das empresas." : uploadError.message)
  const { error } = await root.from("system_companies").update({ certificate_path: path, certificate_name: input.file.name, certificate_expires_at: input.expiresAt, certificate_password_enc: encryptSecret(input.password), updated_at: new Date().toISOString() }).eq("id", companyId)
  if (error) throw error
  await audit({ module: "fiscal", action: "Alteração fiscal", description: `Certificado digital da empresa atualizado (${input.file.name}, válido até ${input.expiresAt}).`, recordId: companyId, tableName: "system_companies", actorId: actor.id, actorEmail: actor.email, companyId })
}

export async function removeCertificate(root: Admin, companyId: string, actor: { id: string; email: string }) {
  const { error } = await root.from("system_companies").update({ certificate_path: null, certificate_name: null, certificate_expires_at: null, certificate_password_enc: null, updated_at: new Date().toISOString() }).eq("id", companyId)
  if (error) throw error
  await audit({ module: "fiscal", action: "Alteração fiscal", description: "Certificado digital removido da empresa.", recordId: companyId, tableName: "system_companies", actorId: actor.id, actorEmail: actor.email, companyId })
}

export async function saveLogo(root: Admin, companyId: string, file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type)) fail("O logotipo deve ser JPG ou PNG.")
  if (file.size > 5 * 1024 * 1024) fail("Logotipo acima de 5 MB.")
  const path = `logo/${companyId}-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`
  const { error: uploadError } = await root.storage.from("quote-files").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (uploadError) fail(/bucket/i.test(uploadError.message) ? "Rode scripts/210_orcamentos.sql para criar o armazenamento de logotipos." : uploadError.message)
  const { error } = await root.from("system_companies").update({ logo_path: path }).eq("id", companyId)
  if (error) throw error
}

// ---------------- Filiais, naturezas e modelos (cadastros simples)

export async function listBranches(root: Admin) {
  const [branches, companies] = await Promise.all([root.from("branches").select("*").order("name"), root.from("system_companies").select("id,name,trade_name")])
  if (branches.error) throw branches.error
  const names = new Map<string, string>((companies.data || []).map((row: any) => [row.id as string, (row.trade_name || row.name) as string]))
  return (branches.data || []).map((row) => ({ id: row.id, companyId: row.company_id, companyName: names.get(row.company_id) || "-", code: row.code || "", name: row.name, zipCode: row.zip_code || "", street: row.street || "", number: row.number || "", complement: row.complement || "", district: row.district || "", city: row.city || "", state: row.state || "", phone: row.phone || "", managerName: row.manager_name || "", active: row.active !== false }))
}

export async function saveBranch(root: Admin, input: Record<string, any>) {
  const invalid = validateBranch({ name: text(input.name), zipCode: text(input.zipCode), state: text(input.state), phone: text(input.phone) })
  if (invalid) fail(invalid)
  if (!text(input.companyId)) fail("Informe a empresa da filial.")
  const row = {
    ...(input.id ? { id: input.id } : {}), company_id: input.companyId, code: text(input.code) || null, name: text(input.name), zip_code: text(input.zipCode).replace(/\D/g, "") || null, street: text(input.street) || null, number: text(input.number) || null,
    complement: text(input.complement) || null, district: text(input.district) || null, city: text(input.city) || null, state: text(input.state).toUpperCase() || null, phone: text(input.phone) || null, manager_name: text(input.managerName) || null, active: input.active !== false,
  }
  const { error } = await root.from("branches").upsert(row, { onConflict: "id" })
  if (error) throw error
}

export async function listNatures(admin: Admin) {
  const { data, error } = await admin.from("fiscal_operation_natures").select("*").order("name")
  if (error) throw error
  return (data || []).map((row) => ({ id: row.id, name: row.name, kind: row.kind, defaultCfop: row.default_cfop || "", notes: row.notes || "", active: row.active !== false }))
}

export async function saveNature(admin: Admin, input: Record<string, any>) {
  const invalid = validateNature({ name: text(input.name), kind: text(input.kind), defaultCfop: text(input.defaultCfop) })
  if (invalid) fail(invalid)
  const row = { ...(input.id ? { id: input.id } : {}), name: text(input.name), kind: text(input.kind), default_cfop: text(input.defaultCfop) || null, notes: text(input.notes) || null, active: input.active !== false }
  const { error } = await admin.from("fiscal_operation_natures").upsert(row, { onConflict: "id" })
  if (error) throw error
}

export async function listTemplates(admin: Admin) {
  const { data, error } = await admin.from("quote_templates").select("*").order("name")
  if (error) throw error
  return (data || []).map((row) => ({ id: row.id, name: row.name, quoteType: row.quote_type || "", validityDays: Number(row.validity_days), paymentConditionId: row.payment_condition_id || "", deliveryText: row.delivery_text || "", warrantyDays: Number(row.warranty_days || 0), notes: row.notes || "", active: row.active !== false }))
}

export async function saveTemplate(admin: Admin, input: Record<string, any>) {
  const invalid = validateQuoteTemplate({ name: text(input.name), validityDays: num(input.validityDays), warrantyDays: num(input.warrantyDays) })
  if (invalid) fail(invalid)
  const row = { ...(input.id ? { id: input.id } : {}), name: text(input.name), quote_type: text(input.quoteType) || null, validity_days: Math.round(num(input.validityDays)), payment_condition_id: text(input.paymentConditionId) || null, delivery_text: text(input.deliveryText) || null, warranty_days: Math.round(num(input.warrantyDays)), notes: text(input.notes) || null, active: input.active !== false }
  const { error } = await admin.from("quote_templates").upsert(row, { onConflict: "id" })
  if (error) throw error
}

// ---------------- Tabelas de preço

export async function listPriceTables(admin: Admin) {
  const [tables, items, clients, materials, services] = await Promise.all([
    admin.from("price_tables").select("*").order("name"), admin.from("price_table_items").select("*"),
    readAllPages<any>((from, to) => admin.from("clients").select("id,name").order("id").range(from, to)), readAllPages<any>((from, to) => admin.from("materials").select("id,name,internal_code").order("id").range(from, to)), admin.from("service_types").select("id,name"),
  ])
  if (tables.error) throw tables.error
  const clientName = new Map<string, string>(clients.map((row) => [row.id as string, row.name as string]))
  const materialName = new Map<string, string>(materials.map((row) => [row.id as string, `${row.internal_code ? `${row.internal_code} · ` : ""}${row.name}`]))
  const serviceName = new Map<string, string>((services.data || []).map((row: any) => [row.id as string, row.name as string]))
  return (tables.data || []).map((row) => ({
    id: row.id, name: row.name, clientId: row.client_id || "", clientName: row.client_id ? clientName.get(row.client_id) || "-" : "Todos os clientes", validFrom: row.valid_from, validUntil: row.valid_until || "", notes: row.notes || "", active: row.active !== false,
    items: (items.data || []).filter((item) => item.price_table_id === row.id).map((item) => ({ id: item.id, materialId: item.material_id || "", serviceTypeId: item.service_type_id || "", name: item.material_id ? materialName.get(item.material_id) || "-" : serviceName.get(item.service_type_id) || "-", price: Number(item.price) })),
  }))
}

export async function savePriceTable(admin: Admin, input: Record<string, any>) {
  const items = (Array.isArray(input.items) ? input.items : []).map((item: any) => ({ materialId: text(item.materialId), serviceTypeId: text(item.serviceTypeId), price: num(item.price) }))
  const invalid = validatePriceTable({ name: text(input.name), validFrom: text(input.validFrom), validUntil: text(input.validUntil), items })
  if (invalid) fail(invalid)
  const row = { ...(input.id ? { id: input.id } : {}), name: text(input.name), client_id: text(input.clientId) || null, valid_from: text(input.validFrom), valid_until: text(input.validUntil) || null, notes: text(input.notes) || null, active: input.active !== false }
  const { data: saved, error } = await admin.from("price_tables").upsert(row, { onConflict: "id" }).select("id").single()
  if (error) throw error
  await admin.from("price_table_items").delete().eq("price_table_id", saved.id)
  const { error: itemsError } = await admin.from("price_table_items").insert(items.map((item) => ({ price_table_id: saved.id, material_id: item.materialId || null, service_type_id: item.serviceTypeId || null, price: item.price })))
  if (itemsError) throw itemsError
}

// ---------------- Parâmetros por área

export async function getSettings(admin: Admin) {
  const { data, error } = await admin.from("app_settings").select("key,value")
  if (error) throw error
  const stored = new Map<string, Record<string, any>>((data || []).map((row: any) => [row.key as string, row.value as Record<string, any>]))
  return Object.fromEntries(settingSections.map((section) => [section.key, { ...defaultsFor(section.key), ...(stored.get(section.key) || {}) }])) as Record<string, Record<string, any>>
}

/** Seção de parâmetros já com padrões; se a tabela ainda não existe, devolve os padrões (os outros módulos continuam funcionando). */
export async function loadSection(admin: Admin, key: string): Promise<Record<string, any>> {
  try {
    const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle()
    return { ...defaultsFor(key), ...((data?.value as Record<string, any>) || {}) }
  } catch {
    return defaultsFor(key)
  }
}

export async function saveSection(admin: Admin, key: string, input: Record<string, any>, actor: string) {
  const result = normalizeSection(key, input)
  if (result.error) fail(result.error)
  const { error } = await admin.from("app_settings").upsert({ key, value: result.value, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: "system_company_id,key" })
  if (error) throw error
  return result.value
}

// ---------------- Usuários (campos adicionais e empresas autorizadas)

export async function listUsersAccess(root: Admin) {
  const [profiles, links, branches, authUsers] = await Promise.all([
    root.from("profiles").select("*").order("full_name"), root.from("profile_companies").select("profile_id,company_id"), root.from("branches").select("id,name,company_id"), root.auth.admin.listUsers({ perPage: 1000 }),
  ])
  if (profiles.error) throw profiles.error
  const auth = new Map<string, any>((authUsers.data?.users || []).map((user: any) => [user.id as string, user]))
  const branchName = new Map<string, string>((branches.data || []).map((row: any) => [row.id as string, row.name as string]))
  return (profiles.data || []).map((row) => ({
    id: row.id, name: row.full_name || row.email, email: row.email, phone: row.phone || "", role: row.role, permissions: Array.isArray(row.page_permissions) ? row.page_permissions : [], active: row.active !== false, clientId: row.client_id || "",
    department: row.department || "", jobTitle: row.job_title || "", branchId: row.branch_id || "", branchName: row.branch_id ? branchName.get(row.branch_id) || "" : "", mfaRequired: Boolean(row.mfa_required),
    mfaEnabled: Array.isArray(auth.get(row.id)?.factors) && auth.get(row.id).factors.some((factor: any) => factor.status === "verified"), lastSignInAt: auth.get(row.id)?.last_sign_in_at || "",
    companyIds: (links.data || []).filter((link) => link.profile_id === row.id).map((link) => link.company_id as string),
  }))
}

export async function saveUserAccess(root: Admin, userId: string, input: Record<string, any>) {
  const { data: profile } = await root.from("profiles").select("id,role").eq("id", userId).maybeSingle()
  if (!profile) fail("Usuário não encontrado.")
  const companyIds: string[] = [...new Set<string>((Array.isArray(input.companyIds) ? input.companyIds : []).map(String).filter(Boolean))]
  let branchCompanyId = ""
  if (text(input.branchId)) {
    const { data: branch } = await root.from("branches").select("company_id").eq("id", input.branchId).maybeSingle()
    if (!branch) fail("Filial não encontrada.")
    branchCompanyId = branch!.company_id
  }
  const invalid = validateUserAccess({ role: profile!.role, companyIds, branchId: text(input.branchId), branchCompanyId })
  if (invalid) fail(invalid)
  const { error } = await root.from("profiles").update({ department: text(input.department) || null, job_title: text(input.jobTitle) || null, branch_id: text(input.branchId) || null, mfa_required: Boolean(input.mfaRequired) }).eq("id", userId)
  if (error) throw error
  await root.from("profile_companies").delete().eq("profile_id", userId)
  if (companyIds.length) {
    const { error: linkError } = await root.from("profile_companies").insert(companyIds.map((companyId) => ({ profile_id: userId, company_id: companyId })))
    if (linkError) throw linkError
  }
}

// ---------------- Documentos centrais

const BUCKET = "company-files"

export async function listDocuments(admin: Admin, user: { id: string; role: string }) {
  const { data, error } = await admin.from("documents").select("*").order("created_at", { ascending: false }).limit(500)
  if (error) throw error
  return (data || []).filter((row) => canSeeDocument({ visibility: row.visibility, responsibleId: row.responsible_id || "" }, user)).map((row) => ({ id: row.id, docType: row.doc_type, title: row.title, entityType: row.entity_type || "", entityRef: row.entity_ref || "", version: Number(row.version), fileName: row.file_name, visibility: row.visibility, responsibleName: row.responsible_name || "", docDate: row.doc_date, notes: row.notes || "", createdBy: row.created_by || "", createdAt: row.created_at }))
}

/** Cada envio é uma nova versão do mesmo título/vínculo; nada é sobrescrito. */
export async function createDocument(admin: Admin, root: Admin, user: { id: string; email: string; name: string }, input: { docType: string; title: string; entityType: string; entityRef: string; visibility: string; docDate: string; notes: string; file: File }) {
  if (!text(input.title)) fail("Informe o título do documento.")
  if (!text(input.docType)) fail("Informe o tipo do documento.")
  if (!["Todos", "Administradores", "Responsável"].includes(input.visibility)) fail("Visibilidade inválida.")
  if (input.file.size > 25 * 1024 * 1024) fail("Arquivo acima de 25 MB.")
  const safe = input.file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) || "arquivo"
  const { data: previous } = await admin.from("documents").select("version").ilike("title", text(input.title)).eq("entity_type", text(input.entityType) || "").eq("entity_ref", text(input.entityRef) || "").order("version", { ascending: false }).limit(1)
  const version = Number(previous?.[0]?.version || 0) + 1
  const path = `documentos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safe}`
  const { error: uploadError } = await root.storage.from(BUCKET).upload(path, Buffer.from(await input.file.arrayBuffer()), { contentType: input.file.type || "application/octet-stream", upsert: false })
  if (uploadError) fail(/bucket/i.test(uploadError.message) ? "Rode scripts/214_configuracoes.sql para criar o armazenamento de documentos." : uploadError.message)
  const { error } = await admin.from("documents").insert({ doc_type: text(input.docType), title: text(input.title), entity_type: text(input.entityType) || "", entity_ref: text(input.entityRef) || "", version, file_path: path, file_name: input.file.name, visibility: input.visibility, responsible_id: user.id, responsible_name: user.name, doc_date: text(input.docDate) || today(), notes: text(input.notes) || null, created_by: user.email })
  if (error) throw error
  return version
}

export async function documentLink(admin: Admin, root: Admin, id: string, user: { id: string; role: string }) {
  const { data } = await admin.from("documents").select("file_path,visibility,responsible_id").eq("id", id).maybeSingle()
  if (!data || !canSeeDocument({ visibility: data.visibility, responsibleId: data.responsible_id || "" }, user)) fail("Documento não encontrado.")
  const { data: signed, error } = await root.storage.from(BUCKET).createSignedUrl(data!.file_path, 300)
  if (error || !signed) fail("Arquivo não encontrado.")
  return signed!.signedUrl
}

// ---------------- Integrações

export async function integrationsOverview(admin: Admin) {
  const [accounts, failedEvents, history] = await Promise.all([
    admin.from("asaas_accounts").select("id,code,name,environment,enabled,last_statement_sync_at,last_webhook_at"),
    admin.from("asaas_webhook_events").select("id,account_id,event_type,processing_error,received_at,reprocess_attempts").is("processed_at", null).not("processing_error", "is", null).order("received_at", { ascending: false }).limit(30),
    makeAdmin({ bypassCompanyScope: true }).from("audit_events").select("id,occurred_at,action,description,result,actor_email,origin").eq("module", "integracoes").order("seq", { ascending: false }).limit(40),
  ])
  const rows = new Map<string, any>((accounts.data || []).map((row: any) => [row.code as string, row]))
  const codeById = new Map<string, string>((accounts.data || []).map((row: any) => [row.id as string, row.code as string]))
  const asaas = (["services", "materials"] as const).map((code) => {
    const status = asaasConfigurationStatus(code)
    const row = rows.get(code)
    return {
      key: `asaas-${code}`, provider: "Asaas", name: `Asaas — ${status.label}`, environment: row?.environment || status.environment, status: !status.apiConfigured ? "Não configurada" : row?.enabled === false ? "Desativada" : status.configurationError ? "Com erro de configuração" : "Ativa",
      scopes: ["Cobranças", "Transferências", "Pagamento de contas", "Notas fiscais", "Webhooks"], authentication: status.apiConfigured ? "Chave de API guardada no servidor (variável de ambiente)" : "Chave de API pendente", webhook: status.webhookConfigured ? "Token de webhook configurado" : "Webhook sem token",
      lastSyncAt: row?.last_statement_sync_at || "", lastWebhookAt: row?.last_webhook_at || "", error: status.configurationError || "",
    }
  })
  const notaas = (["service", "materials"] as const).map((kind) => {
    const configured = Boolean(String(process.env[kind === "service" ? "NOTAAS_SERVICES_API_KEY" : "NOTAAS_MATERIALS_API_KEY"] || "").trim())
    return { key: `notaas-${kind}`, provider: "NotaAS", name: `NotaAS — ${kind === "service" ? "NFS-e (serviços)" : "NF-e (materiais)"}`, environment: "Conforme a chave", status: configured ? "Ativa" : "Não configurada", scopes: ["Emissão de notas", "Consulta de status", "Download de XML/PDF"], authentication: configured ? "Chave de API guardada no servidor" : "Chave de API pendente", webhook: "-", lastSyncAt: "", lastWebhookAt: "", error: "" }
  })
  const email = [{ key: "resend", provider: "Resend", name: "E-mail transacional", environment: "Produção", status: process.env.RESEND_API_KEY ? "Ativa" : "Não configurada", scopes: ["Alertas", "Orçamentos", "Relatórios agendados", "Resumo diário"], authentication: process.env.RESEND_API_KEY ? "Chave de API guardada no servidor" : "Chave de API pendente", webhook: "-", lastSyncAt: "", lastWebhookAt: "", error: "" }]
  return {
    integrations: [...asaas, ...notaas, ...email],
    failedEvents: (failedEvents.data || []).map((row: any) => ({ id: row.id, account: codeById.get(row.account_id) || "-", eventType: row.event_type, error: row.processing_error, receivedAt: row.received_at, attempts: Number(row.reprocess_attempts || 0) })),
    history: (history.data || []).map((row: any) => ({ id: row.id, at: row.occurred_at, action: row.action, description: row.description, result: row.result, actor: row.actor_email || "", origin: row.origin })),
    secretsConfigured: secretsConfigured(),
  }
}

// ---------------- Resumo diário por e-mail

/** Envia o resumo (orçamentos vencendo, estoque baixo, títulos vencidos) aos destinatários configurados da empresa. */
export async function runNotificationDigest(admin: Admin, companyName: string) {
  const settings = await loadSection(admin, "notifications")
  if (!settings.digestEnabled || !settings.digestRecipients.length) return { sent: false, reason: "Resumo diário desligado." }
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY não configurada." }
  const now = today()
  const limit = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const sections: Array<{ title: string; lines: string[] }> = []
  const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  if (settings.digestQuotes) {
    const { data } = await admin.from("quotes").select("quote_number,version,valid_until,total_amount,client_id,status").in("status", ["Rascunho", "Enviado"]).gte("valid_until", now).lte("valid_until", limit).order("valid_until").limit(20)
    sections.push({ title: "Orçamentos que vencem em 7 dias", lines: (data || []).map((row) => `${row.quote_number}${row.version > 1 ? ` v${row.version}` : ""} — ${brl(Number(row.total_amount))} — vence em ${row.valid_until.split("-").reverse().join("/")}`) })
  }
  if (settings.digestStock) {
    const materials = await readAllPages<any>((from, to) => admin.from("materials").select("name,internal_code,current_stock,reserved_stock,minimum_stock,status").order("id").range(from, to))
    sections.push({ title: "Produtos abaixo do estoque mínimo", lines: materials.filter((row) => row.status !== "Inativo" && Number(row.minimum_stock) > 0 && Number(row.current_stock) - Number(row.reserved_stock || 0) <= Number(row.minimum_stock)).slice(0, 20).map((row) => `${row.internal_code ? `${row.internal_code} · ` : ""}${row.name} — disponível ${Number(row.current_stock) - Number(row.reserved_stock || 0)} (mínimo ${row.minimum_stock})`) })
  }
  if (settings.digestReceivables) {
    const { data } = await admin.from("accounts_receivable").select("description,due_date,expected_amount,received_amount,status").neq("status", "Cancelada").lt("due_date", now).order("due_date").limit(200)
    const overdue = (data || []).filter((row) => Number(row.received_amount || 0) < Number(row.expected_amount || 0) - 0.005)
    sections.push({ title: "Contas a receber vencidas", lines: overdue.slice(0, 20).map((row) => `${row.due_date.split("-").reverse().join("/")} — ${row.description} — ${brl(Number(row.expected_amount) - Number(row.received_amount || 0))}`) })
  }
  const filled = sections.filter((section) => section.lines.length)
  if (!filled.length) return { sent: false, reason: "Nada a avisar hoje." }
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
  const html = `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h2>Resumo diário — ${escape(companyName)}</h2>${filled.map((section) => `<h3>${escape(section.title)} (${section.lines.length})</h3><ul>${section.lines.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>`).join("")}</div>`
  const from = String(process.env.REPORT_FROM_EMAIL || process.env.SYSTEM_ALERT_FROM_EMAIL || "ERP Carretas <onboarding@resend.dev>").trim()
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: settings.digestRecipients, subject: `[${companyName}] Resumo diário: ${filled.reduce((sum, section) => sum + section.lines.length, 0)} item(ns) pedem atenção`, html }) })
  if (!response.ok) return { sent: false, reason: `Falha no envio (HTTP ${response.status}).` }
  return { sent: true, reason: "", items: filled.reduce((sum, section) => sum + section.lines.length, 0) }
}
