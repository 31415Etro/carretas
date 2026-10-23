import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"
import { allLeaves, isActive, isParent, legacyRoutes, navGroups, visibleNav, type NavEntry } from "./navigation.ts"

const labels = (entries: NavEntry[]) => entries.map((entry) => entry.label)
const flat = (user: Parameters<typeof visibleNav>[0]) => visibleNav(user).flatMap((group) => group.items)

test("administrador vê os dois grupos expansíveis com os submenus pedidos e nada de Estoque, Serviços ou Ordens de Serviço", () => {
  const items = flat({ role: "admin" })
  const estoque = items.find((entry) => entry.label === "Estoque interno")
  const producao = items.find((entry) => entry.label === "Produção")
  assert.ok(estoque && isParent(estoque) && producao && isParent(producao))
  assert.deepEqual(labels((estoque as { children: NavEntry[] }).children), ["Matérias-primas", "Kits e composições", "Produtos finais"])
  assert.deepEqual(labels((producao as { children: NavEntry[] }).children), ["Produção e MRP", "Esteira da fábrica", "Tablet da fábrica"])
  const all = allLeaves().map((leaf) => leaf.label)
  for (const removed of ["Estoque", "Serviços", "Ordens de Serviço"]) assert.equal(all.includes(removed), false, removed)
  for (const kept of ["Dashboard", "Comercial / CRM", "Financeiro", "Compras", "Documentação veicular", "Frota", "Máquinas e Equipamentos"]) assert.ok(all.includes(kept), kept)
})

test("toda entrada do menu aponta para uma página que existe, sem rotas repetidas, e as rotas antigas continuam existindo", () => {
  const hrefs = allLeaves().map((leaf) => leaf.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
  for (const href of [...hrefs, ...legacyRoutes]) assert.ok(existsSync(`app${href}/page.tsx`), `sem página para ${href}`)
  for (const legacy of legacyRoutes) assert.equal(hrefs.includes(legacy), false)
})

test("permissões: cada perfil só vê o que pode; grupo sem item visível some", () => {
  assert.deepEqual(flat({ role: "user", permissions: ["chao_fabrica"] }).map((entry) => (isParent(entry) ? entry.children.map((c) => c.label) : [entry.label])).flat(), ["Tablet da fábrica"])
  const fabrica = visibleNav({ role: "user", permissions: ["produtos_servicos"] })
  assert.deepEqual(fabrica.flatMap((group) => group.items).map((entry) => entry.label), ["Estoque interno"])
  assert.equal(visibleNav({ role: "user", permissions: [] }).length, 0)
  assert.equal(visibleNav(null).length, 0)
  const naoAdmin = flat({ role: "manager", permissions: ["configuracoes"] }).map((entry) => entry.label)
  assert.equal(naoAdmin.includes("Logs do Sistema"), false)       // item só de administrador
  assert.ok(naoAdmin.includes("Configurações"))
  const producao = flat({ role: "user", permissions: ["estoque"] }).find((entry) => entry.label === "Produção")
  assert.deepEqual(producao && isParent(producao) ? labels(producao.children) : [], ["Produção e MRP", "Esteira da fábrica"])
})

test("item ativo: Produção e MRP não acende na esteira nem no tablet, mas acende nas ordens e nos detalhes", () => {
  const leaf = (href: string) => allLeaves(navGroups).find((item) => item.href === href)!
  assert.equal(isActive(leaf("/producao"), "/producao"), true)
  assert.equal(isActive(leaf("/producao"), "/producao/77777777-7777-4777-8777-777777777777"), true)
  assert.equal(isActive(leaf("/producao"), "/producao/esteira"), false)
  assert.equal(isActive(leaf("/producao"), "/producao/tablet/unidade/abc"), false)
  assert.equal(isActive(leaf("/producao/esteira"), "/producao/esteira"), true)
  assert.equal(isActive(leaf("/producao/tablet"), "/producao/tablet/unidade/abc"), true)
  assert.equal(isActive(leaf("/materias-primas"), "/materias-primas/abc"), true)
  assert.equal(isActive(leaf("/kits"), "/produtos/abc"), false)
})
