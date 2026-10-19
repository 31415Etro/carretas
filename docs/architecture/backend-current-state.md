# Backend: estado atual (Fase 0)

> Diagnóstico por leitura do código e medições somente leitura em 19/10/2026. Onde algo é inferência, está marcado como **hipótese** ou **a verificar**.
> Complementos: [inventário de endpoints](../performance/endpoint-inventory.md) · [baseline de performance](../performance/performance-baseline.md).

## 1. Visão geral

| Camada | Tecnologia (confirmada no repositório) |
|---|---|
| Aplicação | Next.js 16.0.10 (App Router, Turbopack no dev), React 19.1, TypeScript, Tailwind 4 |
| API | **104 rotas** `app/api/**/route.ts` (Route Handlers), sem camada separada de serviços |
| Banco/Auth/Storage | Supabase (Postgres, Auth, Storage) via `@supabase/supabase-js` 2.75 e `@supabase/ssr` 0.7 |
| Validação | `zod` está instalado, mas **não é usado em nenhum arquivo** (0 imports) |
| Gráficos / OCR / planilhas / PDF | recharts, tesseract.js + sharp, xlsx, pdfjs-dist, jspdf |
| Agendador | 4 crons da Vercel (`vercel.json`): contratos, relatórios, auditoria, notificações |
| Testes | `node --test`: 27 arquivos / 113 casos, **apenas bibliotecas puras**. Não há testes de API, integração, RLS nem e2e |
| Build | `typescript.ignoreBuildErrors: true` em `next.config.mjs` (erros de tipo não bloqueiam o build) |

```
Navegador (React, 52 componentes "use client")
   │  fetch /api/...
   ▼
proxy.ts  → lib/supabase/middleware.ts (updateSession)
   │  getUser + getSession + profiles + profile_companies  (≈4 idas ao Supabase)
   ▼
Route Handler (app/api/**)
   │  stockContext/currentUserRole: getUser + profiles (de novo)
   │  createClient (RLS do usuário)  ou  createAdminClient (service role, 47 arquivos)
   ▼
companyAwareFetch (lib/supabase/server.ts): injeta system_company_id nas consultas
   ▼
Supabase PostgREST → Postgres (RLS + triggers de auditoria)
```

## 2. Multiempresa (tenancy)

- Empresas em `system_companies` (3 hoje). A empresa ativa vem do cookie `system_company_id`.
- `companyAwareFetch` (em `lib/supabase/server.ts`) reescreve as requisições do cliente Supabase para filtrar/gravar `system_company_id` nas tabelas de `tenantScopedTables` (`lib/system-company.ts`). Tabelas em `sharedMasterTables` são compartilhadas.
- O proxy valida que a empresa do cookie está entre as de `profile_companies` do usuário (admin vê todas).
- **Ponto de atenção:** o isolamento depende desse *wrapper* na aplicação. As políticas RLS têm uma política permissiva `using (true)` somada a uma restritiva de tenant, e **47 arquivos usam a chave de serviço** (que ignora RLS). Um endpoint novo que use o cliente admin sem o wrapper vaza dados entre empresas. **A verificar** com leitura das políticas diretamente no banco.

## 3. Autenticação e autorização

- Sessão por cookies do Supabase Auth, renovada no `proxy.ts`.
- Caminhos públicos (`publicPaths`): `/login`, `/api/auth/*` (login, logout, user, companies) e os 4 crons (autenticados por `CRON_SECRET` dentro da rota).
- Papéis e permissões de página em `profiles` (`role`, `page_permissions`, `active`), checados no proxy e em `lib/server-authorization.ts`.
- 14 rotas não têm marca de autenticação no próprio arquivo (principalmente `/api/auditoria/*`, `/api/configuracoes/*`, `/api/dashboard/erp*`, `/api/financeiro/parse-invoice`). Elas dependem do proxy (verificado: chamadas sem login → 401). **Risco de defesa em profundidade:** se o proxy for contornado ou o matcher mudar, essas rotas ficam abertas.

### Achado a verificar: webhook do Asaas bloqueado pelo proxy

`/api/integrations/asaas/webhooks/services` **não está** em `publicPaths`. Uma chamada `POST` sem sessão (com ou sem cabeçalho `asaas-access-token`) respondeu `{"error":"Nao autenticado"}` (401) **antes** de a rota executar `verifyAsaasWebhookToken`. O código de `updateSession` confirma: usuário ausente + caminho não público + `/api/` → 401.

Se isso também ocorre em produção, **o Asaas nunca consegue entregar eventos de webhook** (pagamento confirmado, etc.) e a conciliação automática de cobranças dependeria de consulta manual. É necessário confirmar em produção (sem alterar nada: ver o painel de entregas de webhook do Asaas e/ou os logs). Correção, se confirmada, é pequena (liberar esse caminho no proxy mantendo a validação do token na rota), mas **altera política de segurança e só será feita com autorização**.

## 4. Padrão de persistência atual

### 4.1 Estado em "blob" (Financeiro e Operacional)

- `GET /api/financial-state` carrega as tabelas inteiras (`readAllPages`, 1.000 linhas por página) e devolve **~5,1 MB**; `PUT` grava o estado completo (upsert de tudo). `DELETE` está desativado.
- `GET/PUT /api/operational-state` segue o mesmo padrão (93 KB hoje).
- O navegador mantém o estado inteiro em memória e filtra/ordena localmente.
- **Consequências:** custo cresce linearmente com o histórico; cada alteração pequena regrava o conjunto; risco de **sobrescrita entre usuários simultâneos** (último a gravar vence); exclusões podem **não persistir** (**a verificar**: o upsert não apaga linhas ausentes e o `DELETE` está desligado).

### 4.2 Agregação em JavaScript

- `lib/dashboard-erp-server.ts` lê tabelas inteiras e `lib/dashboard-erp.ts` agrega em JS. Resposta final: ~7–10 KB; tempo ~3,4 s.

### 4.3 Listas completas

- 37 rotas carregam tabelas inteiras; 74 das 104 usam `select(*)`. Cadastros e comercial devolvem 100–154 KB por chamada, filtrados no navegador.

### 4.4 Regras de negócio atômicas já no banco (ponto positivo)

8 funções RPC (`apply_stock_movement`, `receive_purchase_order`, `produce_composition`, `create_asaas_receivable`, `next_service_order_number`, `verify_audit_chain`, `purge_audit_events`…) concentram operações que precisam de atomicidade. É o padrão a estender.

## 5. Auditoria

- `audit_events` com cadeia de hash (`verify_audit_chain`), 41.755 eventos, gatilhos de linha em várias tabelas (`scripts/213_auditoria.sql`).
- **Custo em escritas em massa:** cada linha gravada dispara o gatilho (o PUT do estado financeiro e a importação de planilha multiplicam isso). **Hipótese**, não medida.
- Listagem já usa cursor (`before` = `seq`). A exportação CSV percorre a trilha em lotes de 500 **dentro da requisição**: 49–55 s medidos, 5,3 MB.

## 6. Custos fixos por requisição

Cada chamada à API faz, antes da consulta de negócio: no proxy `getUser` (rede ao Supabase Auth), `getSession`, `profiles`, e (não admin) `profile_companies`; na rota, de novo `getUser` + `profiles`. Com piso de rede de ~0,4–0,7 s, isso explica o ~1 s de rotas vazias. Não há cache de contexto de usuário entre requisições. **Hipótese forte, não instrumentada.**

## 7. Banco de dados (visão limitada)

Só há acesso via PostgREST; **não** foi possível listar índices, planos de execução, tamanho de tabelas nem estatísticas.
Pelos scripts SQL (`scripts/2xx_*.sql`), existem índices em parte das tabelas, mas falta verificação sistemática de: índice por `(system_company_id, data/status)` nas tabelas de maior crescimento (`accounts_payable`, `financial_transactions`, `audit_events`), índices para as chaves estrangeiras e custo das políticas RLS. **A verificar** no passo M4 do plano de medição.

## 8. Operação, observabilidade e qualidade

- Logs: `system_logs`/`/api/system-logs` (erros da aplicação) e trilha de auditoria. Não há métricas de latência, contagem de consultas, nem rastreamento por requisição.
- Sem testes de API/integração/RLS; `ignoreBuildErrors` esconde erros de tipo.
- OCR: roda no navegador (tesseract.js); o servidor mantém OCR como contingência com limite de 40 s (`maxDuration` 60 s em 3 rotas).
- Migrações: scripts SQL numerados em `scripts/`, aplicados manualmente no Supabase (sem ferramenta de migração/versionamento automático).

## 9. Resumo dos gargalos preliminares (ordenados por impacto estimado)

| # | Gargalo | Evidência | Confiança |
|---|---|---|---|
| G1 | Estado financeiro de 5 MB lido/gravado por inteiro | 5.162 KB, 2,4–2,5 s; `PUT` do estado completo | Alta (medido + código) |
| G2 | Custo fixo de autenticação/contexto por requisição (~4–6 idas ao Supabase) | Rotas vazias ≈ 1 s com piso de 0,7 s | Média-alta (inferido, não instrumentado) |
| G3 | Dashboard agrega em JS sobre tabelas inteiras | 3,4 s para 10 KB | Alta |
| G4 | Exportação de auditoria síncrona | 49–55 s | Alta (medido) |
| G5 | Gatilhos de auditoria em escritas em massa | Código; não medido | Média (hipótese) |
| G6 | Listas completas sem paginação no servidor | 100–154 KB por lista | Alta |
| G7 | Índices/RLS possivelmente insuficientes | Não verificável sem acesso ao banco | A verificar |
| G8 | Webhook do Asaas possivelmente bloqueado pelo proxy | Teste local 401 | A verificar em produção |
| G9 | Sobrescrita entre usuários e exclusões não persistidas | Código | A verificar |
| G10 | Defesa em profundidade: 14 rotas sem checagem própria; sem testes de API; `ignoreBuildErrors` | Código | Alta |
