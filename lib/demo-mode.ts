// Modo de demonstração (SOMENTE desenvolvimento local): com DEMO_MODE=1 o sistema abre sem login e sem
// Supabase, só para ver o visual das telas. As APIs devolvem listas vazias. Nunca defina em produção.

import { defaultSystemCompany } from "@/lib/system-company"
import { systemPagePermissions } from "@/lib/types"
import { defaultsFor, settingSections } from "@/lib/config"

export const isDemoMode = () => process.env.DEMO_MODE === "1" && process.env.NODE_ENV !== "production"

export const demoSession = () => ({
  user: { id: "demo", name: "Demonstração", email: "demo@local", role: "admin", permissions: systemPagePermissions, clientId: null, company: defaultSystemCompany },
  companies: [defaultSystemCompany],
})

const emptyLists = ["items", "clients", "suppliers", "products", "services", "parties", "opportunities", "salespeople", "quotes", "contracts", "alerts", "saved", "runs", "events", "orders", "users", "providers", "warehouses", "materials", "vehicles", "movements", "technicians", "assets", "templates", "priceTables", "paymentConditions", "categories", "costCenters", "failedEvents", "history", "integrations", "modules", "logs", "companies", "interactions", "accounts", "conditions"]

/** Resposta genérica das APIs no modo de demonstração. */
export function demoApiPayload(pathname: string) {
  const base: Record<string, unknown> = Object.fromEntries(emptyLists.map((key) => [key, []]))
  base.company = { id: "demo", name: "Carretas (demonstração)", legalName: "", cnpj: "", email: "", phone: "", address: "", hasLogo: false }
  base.paymentMethods = ["PIX", "Boleto", "Transferência", "Cartão"]
  base.settings = {}
  if (pathname.startsWith("/api/configuracoes/parametros")) return { settings: Object.fromEntries(settingSections.map((section) => [section.key, defaultsFor(section.key)])) }
  if (pathname.startsWith("/api/relatorios/meta")) return { user: { id: "demo", name: "Demonstração", isAdmin: true }, modules: ["financeiro", "estoque", "produtos", "os", "frota", "comercial", "orcamentos", "contratos"], users: [], emailConfigured: false }
  if (pathname.startsWith("/api/orcamentos/options")) return { ...base, company: { id: "demo", name: "Carretas", legalName: "", cnpj: "", email: "", phone: "", address: "", hasLogo: false }, settings: { defaultValidityDays: 15, discountApprovalPercent: 10 }, emailConfigured: false, canConfigure: true }
  if (pathname.startsWith("/api/os/options")) return { ...base, settings: { defaultChecklist: defaultsFor("os").defaultChecklist, priorityDays: { Baixa: 15, Media: 7, Alta: 3, Urgente: 1 } } }
  if (pathname.startsWith("/api/cadastros/verificar")) return { client: null, supplier: null }
  if (pathname.startsWith("/api/cadastros/cnpj/")) return { company: { document: "19.131.243/0001-97", legalName: "EMPRESA DEMONSTRACAO LTDA", tradeName: "DEMO CARRETAS", phone: "4930000000", email: "contato@demo.com.br", zipCode: "89800-000", street: "RUA EXEMPLO", number: "100", complement: "", district: "CENTRO", city: "CHAPECO", state: "SC", address: "", registrationStatus: "ATIVA", openedAt: "2015-03-10", primaryActivity: "Fabricação de carrocerias e reboques", legalNature: "Sociedade Empresária Limitada", size: "DEMAIS", statusDate: "2015-03-10", branchType: "Matriz", cnaeCode: "2930101", secondaryActivities: ["4530703 - Comércio de peças e acessórios"], partners: [{ name: "SOCIO DEMONSTRACAO", role: "Sócio-Administrador" }] }, partners: [{ name: "SOCIO DEMONSTRACAO", role: "Sócio-Administrador" }], source: "Demonstração", consultedAt: new Date().toISOString() }
  if (pathname.startsWith("/api/cadastros/opcoes")) return { salespeople: [], paymentConditions: [], priceTables: [] }
  if (pathname.startsWith("/api/dashboard/erp/preferences")) return { config: null }
  if (pathname.startsWith("/api/dashboard/erp")) { const today = new Date().toISOString().slice(0, 10); return { period: { start: today, end: today, today }, allowedSections: ["financeiro", "estoque", "os", "frota", "comercial"], sections: {}, options: { costCenters: [], providers: [] }, warnings: ["modo demonstração, sem banco de dados."], generatedAt: new Date().toISOString() } }
  if (pathname.startsWith("/api/auditoria/summary")) return { last24h: 0, denied24h: 0, failed24h: 0 }
  if (pathname.startsWith("/api/auditoria/settings")) return { retentionDays: 1825, companyId: "demo" }
  if (pathname.startsWith("/api/auditoria")) return { events: [], nextBefore: "" }
  if (pathname.startsWith("/api/configuracoes/integracoes")) return { ...base, secretsConfigured: false }
  return { ...base, demo: true }
}
