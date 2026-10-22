// Endereços das telas de cada entidade do fluxo industrial. Uma tela só vira link depois que existe (cada etapa liga a sua);
// enquanto o destino não existe, a interface mostra o nome sem link em vez de levar a uma página inexistente.
export type EntityKind = "rawMaterial" | "kit" | "product" | "productionOrder" | "purchaseOrder" | "salesOrder" | "supplier"

const available: Record<EntityKind, (id: string) => string | null> = {
  rawMaterial: (id) => `/materias-primas/${id}`,
  kit: (id) => `/kits/${id}`,
  product: () => null,          // Etapa 5
  productionOrder: () => null,  // Etapa 8
  purchaseOrder: () => "/compras",
  salesOrder: () => null,       // Etapa 7
  supplier: () => "/clientes",
}

export const entityHref = (kind: EntityKind, id: string) => available[kind](id)
