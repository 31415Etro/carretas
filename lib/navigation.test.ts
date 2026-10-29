import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"
import { allLeaves, isActive, isParent, legacyRoutes, navGroups, visibleNav, type NavEntry } from "./navigation.ts"

const labels = (entries: NavEntry[]) => entries.map((entry) => entry.label)
const flat = (user: Parameters<typeof visibleNav>[0]) => visibleNav(user).flatMap((group) => group.items)

test("administrador vê Estoque e Produção (cada uma uma página com abas), sem Serviços nem Ordens de Serviço", () => {
  const items = flat({ role: "admin" })
  const estoque = items.find((entry) => entry.label === "Estoque")
  const producao = items.find((entry) => entry.label === "Produção")
  assert.ok(estoque && !isParent(estoque) && estoque.href === "/estoque-interno" && producao && !isParent(producao) && producao.href === "/producao")
  assert.equal(items.some((entry) => entry.label === "Estoque interno"), false)
  const all = allLeaves().map((leaf) => leaf.label)
  for (const removed of ["Serviços", "Ordens de Serviço", "Matérias-primas", "Kits e composições", "Produtos finais", "Produção e MRP", "Esteira da fábrica", "Tablet da fábrica"]) assert.equal(all.includes(removed), false, removed)
  for (const kept of ["Dashboard", "Comercial / CRM", "Financeiro", "Compras", "Frota", "Máquinas e Equipamentos"]) assert.ok(all.includes(kept), kept)
})

test("toda entrada do menu aponta para uma página que existe, sem rotas repetidas, e as rotas antigas continuam existindo", () => {
  const hrefs = allLeaves().map((leaf) => leaf.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
  for (const href of [...hrefs, ...legacyRoutes]) assert.ok(existsSync(`app${href}/page.tsx`), `sem página para ${href}`)
  for (const legacy of legacyRoutes) assert.equal(hrefs.includes(legacy), false)
})

test("permissões: cada perfil só vê o que pode; grupo sem item visível some", () => {
  assert.deepEqual(flat({ role: "user", permissions: ["chao_fabrica"] }).map((entry) => (isParent(entry) ? entry.children.map((c) => c.label) : [entry.label])).flat(), ["Produção"])
  const fabrica = visibleNav({ role: "user", permissions: ["produtos_servicos"] })
  assert.deepEqual(fabrica.flatMap((group) => group.items).map((entry) => entry.label), ["Estoque"])
  assert.equal(visibleNav({ role: "user", permissions: [] }).length, 0)
  assert.equal(visibleNav(null).length, 0)
  const naoAdmin = flat({ role: "manager", permissions: ["configuracoes"] }).map((entry) => entry.label)
  assert.equal(naoAdmin.includes("Logs do Sistema"), false)       // item só de administrador
  assert.ok(naoAdmin.includes("Configurações"))
  const producao = flat({ role: "user", permissions: ["estoque"] }).find((entry) => entry.label === "Produção")
  assert.ok(producao && !isParent(producao) && producao.href === "/producao")
  // só o tablet: o item Produção leva direto ao tablet (a página com abas exige a permissão de produção)
  const soTablet = flat({ role: "user", permissions: ["chao_fabrica"] }).find((entry) => entry.label === "Produção")
  assert.ok(soTablet && !isParent(soTablet) && soTablet.href === "/producao/tablet" && isActive(soTablet, "/producao/tablet"))
})

test("item ativo: Produção acende em todas as abas, nas ordens, nos detalhes e no tablet; Estoque acende nos detalhes dos cadastros", () => {
  const leaf = (href: string) => allLeaves(navGroups).find((item) => item.href === href)!
  assert.equal(isActive(leaf("/producao"), "/producao"), true)
  const estoque = leaf("/estoque-interno")
  for (const path of ["/estoque-interno", "/materias-primas/abc", "/kits/abc", "/produtos/abc"]) assert.equal(isActive(estoque, path), true, path)
  assert.equal(isActive(estoque, "/estoque"), false)
  for (const path of ["/producao/77777777-7777-4777-8777-777777777777", "/producao/esteira", "/producao/tablet", "/producao/tablet/unidade/abc"]) assert.equal(isActive(leaf("/producao"), path), true, path)
})
