# Reestruturação industrial do ERP: auditoria e plano (Etapa 1)

> Auditoria somente de leitura, em 22/10/2026. Nada foi alterado no código nem no banco. As etapas seguintes dependem das aprovações listadas no final.

## 1. Ambiente

| Item | Situação |
|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage) |
| Ambiente | **Único banco Supabase, com dados reais** (financeiro, 1.580 clientes, 175 fornecedores, 7 mil lançamentos, auditoria). Não há homologação. Tratar tudo como **produção** |
| Multiempresa | `system_company_id` injetado pelo `companyAwareFetch`; as tabelas do módulo já estão em `tenantScopedTables` (materials, stock_*, warehouses, purchase_*, quotes, service_types…) |
| Migrações | Scripts SQL numerados (`scripts/2xx`), aplicados manualmente no SQL Editor do Supabase. Próximo número livre: 217 |
| Testes | `node --test` só para funções puras; não há testes de API/RLS |

## 2. Como está hoje

### 2.1 Um cadastro único para tudo (o problema que você descreveu)
- Existe **uma só tabela `materials`** (scripts 200/205) que guarda matéria-prima, produto, kit e item de revenda, diferenciados por `item_type` ("Produto", "Materia-prima", "Kit"…).
- **Um só formulário** (`components/catalog/product-form.tsx`, 191 linhas) serve a todos, com as mesmas seções: dados, fiscal, estoque, medidas, preço de custo e venda. Matéria-prima mostra campos de venda; produto mostra depósito e estoque mínimo; serviço usa outro sheet (`service-sheet.tsx`) sobre `service_types`.
- **SKU não é único.** No banco já existem 3 registros "FZ 1E" com o **mesmo SKU** `REB-E1-0750-001`, criados em 21/10. Falta índice único por empresa.

### 2.2 O que já existe e pode ser reaproveitado
| Peça | Onde | Uso |
|---|---|---|
| Composição por versão | `product_compositions` + `product_composition_items` (produto → componentes, quantidade, unidade, % de perda, mão de obra, minutos de montagem; uma versão ativa por produto) | Base da lista de materiais (BOM) |
| Montagem/produção atômica | RPC `produce_composition` (consome componentes, calcula custo, dá entrada do produto) + tabela `production_records` | Vira o evento de consumo/entrada da ordem de produção |
| Estoque por movimento | `stock_movements` (tipos já incluem "Consumo em producao" e "Entrada por producao"), `stock_balances (material, depósito)`, `stock_reservations`, `warehouses`, RPC `apply_stock_movement` | Núcleo do estoque; já derivado de movimentos |
| Compras | `purchase_orders/items`, `purchase_receipts/items`, RPC `receive_purchase_order` | Pedido e recebimento já atualizam estoque |
| Orçamentos | `quotes`, `quote_items` (linha Produto/Serviço com `material_id`, custo e preço), eventos, `lib/quotes-server.ts` (440 linhas) | Já calcula custo/margem; converte em contrato/OS/recebível |
| NF-e | `lib/nfe-parser.ts`, importação por XML/foto, cadastro por CNPJ (`lib/cnpj-server.ts`) | Reaproveitar para entrada de compras e fornecedor |
| Regras fiscais | `product_fiscal_rules` (NCM/CFOP/CST por item) | Manter para produto final |

### 2.3 O que não existe (lacunas frente ao pedido)
| Lacuna | Situação atual |
|---|---|
| Kits como entidade própria (versões, componentes de matéria-prima, custo reativo) | `item_type = "Kit"` existe só como rótulo; composição é produto→componente sem camada de kit |
| Produto → kits (BOM em dois níveis: produto → kits → matérias-primas) | Produto → componentes diretos |
| **Pedido de venda** | Não existe. Orçamento "Aprovado" converte em contrato/OS/recebíveis |
| **Ordem de produção** (estados, reservas, consumo, custos, rastreabilidade) | Não existe; só `production_records` de montagem imediata, sem origem de venda |
| MRP (explosão de materiais, saldo projetado, faltas) | Não existe |
| Solicitação de compra a partir de falta | Não existe |
| Reserva de materiais por ordem | `stock_reservations` existe, usada só por OS |
| Sugestão de NCM com fonte oficial | Não existe |
| Capacidade de fabricação com o estoque atual | Não existe |
| Auditoria específica do módulo | A trilha de auditoria geral (`audit_events`, gatilhos) já cobre as tabelas de forma ampla |

### 2.4 Dados que existiriam em uma limpeza (contagem em 22/10/2026)
| Tabela | Registros | Observação |
|---|--:|---|
| `materials` | 6 | 3× "FZ 1E" (mesmo SKU), "CARRETA FZ 1E", "Barra de aço U 6mm" (matéria-prima), "FZ1E" (kit). Criados em 21 e 22/10 |
| `product_compositions` / `_items` | 1 / 1 | criada em 22/10 |
| `stock_movements` | 4 | saldos iniciais e uma entrada por compra |
| `purchase_orders` / `_items` | 1 / 1 | pedido cancelado |
| `warehouses` | 1 | "Depósito principal" (DEP-01): configuração, **preservar** |
| `quotes`, `quote_items`, `production_records`, `stock_reservations`, `purchase_receipts` | 0 | nada a limpar |
| `suppliers` (175), `clients` (1.580), financeiro, auditoria | — | **dados reais: não entram na limpeza** |

Esses 6 itens parecem testes seus, mas **não sei se são fictícios**. Preciso da sua confirmação antes de qualquer remoção.

## 3. Modelo proposto (aditivo, sem recriar o que funciona)

Decisão central: **manter `materials` como tabela mestre de itens** (matéria-prima, kit, produto) porque estoque, orçamentos, compras, OS e regras fiscais referenciam essa tabela por chave estrangeira. Trocar isso quebraria tudo o que funciona. A separação pedida acontece em três níveis:

1. **Telas e validações exclusivas por tipo** (matéria-prima, kit, produto, serviço), com formulários próprios que mostram só os campos de cada um. O banco ganha restrições por tipo (por exemplo, produto exige preço de venda; matéria-prima não).
2. **Tabelas novas de relacionamento** onde falta estrutura.
3. **Funções SQL transacionais** para as automações, no mesmo padrão de `produce_composition`.

| Novo/alterado | Finalidade |
|---|---|
| `materials`: índice único `(system_company_id, internal_code)`; `item_type` restrito (Matéria-prima, Kit, Produto); colunas para NCM confirmado (fonte, data, responsável) | SKU único e rastreio da classificação |
| `kit_versions` + `kit_components` | Kit com versões; componente = matéria-prima, quantidade, unidade, perda. Custo calculado por visão (usa custo vigente da matéria-prima) |
| `product_bom_versions` + `product_kits` | Produto → kits por versão, com mão de obra e custos indiretos. `product_compositions` atual é migrada como versão legada |
| `sales_orders` + `sales_order_items` | Pedido de venda criado ao confirmar o orçamento; guarda a versão da BOM e os custos usados |
| `production_orders` + `production_order_materials` + `production_consumptions` | Ordem com estados, explosão consolidada por matéria-prima (com origem no kit), reservas e consumo real |
| `purchase_requests` (+ itens) | Solicitação gerada a partir de faltas, ligada à ordem; aprovação manual |
| Funções: `explode_bom`, `plan_materials` (MRP), `create_production_from_sale` (idempotente por pedido), `reserve_materials`, `consume_materials`, `complete_production` | Automação no banco, sem depender da tela |
| Visão `product_capacity` | Quantas unidades completas dá para fabricar com o estoque atual e quais materiais limitam |

Todas as tabelas novas: `system_company_id` obrigatório, índices, FKs reais, entrada em `tenantScopedTables`, e cobertas pelos gatilhos de auditoria existentes.

## 4. Plano por etapa (arquivos e tabelas)

| Etapa | Entrega | Arquivos principais | Tabelas |
|---|---|---|---|
| 2 Banco | Scripts 217–219 aditivos e idempotentes | `scripts/217_*.sql`… | as da seção 3 |
| 3 Matérias-primas | Formulário próprio; SKU assistido; NCM com fonte oficial; fornecedores por CNPJ | `components/catalog/raw-material-form.tsx`, `lib/ncm-lookup.ts`, `app/api/catalog/ncm` | `materials`, `raw_material_suppliers` |
| 4 Kits | Tela de kit com "Materiais que compõem este kit", custo reativo, versões, ciclos bloqueados | `components/catalog/kit-page.tsx`, `lib/kits.ts`, `app/api/catalog/kits` | `kit_versions`, `kit_components` |
| 5 Produtos | Formulário próprio do produto final, vínculo de kits, custos, abas (visão geral, kits, composição, custos, estoque, produção, histórico) | `components/catalog/product-form.tsx` (reescrito), `product-detail-page.tsx` | `product_bom_versions`, `product_kits` |
| 6 Serviços e estoque | Serviço sem campos de estoque; estoque só com saldos e movimentos | `service-sheet.tsx`, `stock-erp.tsx` | `service_types`, `stock_*` |
| 7 Comercial | Orçamento por produto com BOM; pedido de venda | `quotes-page.tsx`, `lib/quotes-server.ts`, `lib/sales-orders*.ts` | `quotes`, `sales_orders` |
| 8 Produção | Ordens, explosão, reservas, apontamento de consumo, conclusão com entrada do acabado | `components/production/*`, `app/api/producao/*` | `production_*` |
| 9 Compras | MRP, solicitação de compra, vínculo com NF-e de entrada | `purchases-page.tsx`, `lib/mrp*.ts` | `purchase_requests` |
| 10 Validação | Testes automatizados das funções e do cenário ponta a ponta | `lib/*.test.ts`, script de cenário em staging | — |

Os 16 passos do critério de aceitação serão automatizados como teste de cenário, rodando em dados descartáveis.

## 5. Riscos e como tratá-los

| Risco | Tratamento |
|---|---|
| Banco único com dados reais | Migrações só aditivas; nenhuma alteração em financeiro, clientes, fornecedores ou auditoria; backup antes de cada etapa; testes de cenário em empresa de teste dedicada ou em projeto Supabase de staging |
| Índice único de SKU esbarra nos 3 "FZ 1E" repetidos | Resolver na limpeza aprovada (manter um) antes de criar o índice |
| Quebrar telas que usam `materials` | Etapas aditivas; as telas atuais continuam até a troca; `product_compositions` convertida como versão legada |
| NCM | Fonte oficial gratuita (tabela do Siscomex, por exemplo via BrasilAPI), sem IA; até 3 candidatos, confirmação humana; sem confiança, entrada manual |
| `typescript.ignoreBuildErrors` e falta de testes de API | Cobrir as novas funções com testes e tipos estritos nos arquivos novos |
| Execução de migrações | O ambiente me bloqueia gravações em dados reais; você precisará rodar os scripts SQL no Supabase, como já fez com 215 e 216 |

## 6. Aprovações de que preciso

1. **Plano de limpeza:** confirmar se os 6 itens, 1 composição, 4 movimentos e 1 pedido cancelado (seção 2.4) são fictícios e podem sair. Eu gero o script idempotente com backup em JSON e você roda.
2. **Abordagem do banco:** manter `materials` como mestre e adicionar as tabelas aditivas (recomendado), em vez de recriar o modelo.
3. **Ambiente de testes:** existe um projeto Supabase de staging, ou posso criar a empresa "TESTE" dentro do banco atual para os testes de cenário?
4. **NCM:** confirmar a fonte gratuita oficial (tabela NCM do Siscomex via BrasilAPI) e que a classificação é sempre confirmada por pessoa.
5. **Ordem:** começar pela Etapa 2 (scripts 217–219) para você rodar.
